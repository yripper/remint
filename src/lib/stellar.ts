import { Buffer } from 'buffer'
import {
  Account,
  Address,
  Contract,
  MuxedAccount,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk'
import { STANDARD_FINALITY, type StellarNetworkConfig } from '../config/networks'
import { fromStellarUnits, toStellarUnits } from './amount'
import { fromHex } from './hooks'
import { isMissingTrustline } from './errors'
import { withFeeBuffer, type OftQuote, type OftTransfer } from './oft'

export type SignXdr = (xdr: string) => Promise<string>

const servers = new Map<string, rpc.Server>()

function serverFor(network: StellarNetworkConfig): rpc.Server {
  let server = servers.get(network.rpcUrl)
  if (!server) {
    server = new rpc.Server(network.rpcUrl)
    servers.set(network.rpcUrl, server)
  }
  return server
}

/** Read-only contract call via simulation; no account sequence or signature needed. */
async function simulateRead(network: StellarNetworkConfig, source: string, contractId: string, method: string, args: xdr.ScVal[]): Promise<unknown> {
  const tx = new TransactionBuilder(new Account(source, '0'), { fee: '100', networkPassphrase: network.passphrase })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(30)
    .build()
  const sim = await serverFor(network).simulateTransaction(tx)
  if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error)
  if (!sim.result) throw new Error(`No result from ${method}`)
  return scValToNative(sim.result.retval)
}

export interface UsdcBalance {
  /** Stellar's native 7-decimal units. */
  units: bigint
  /** False when the account has no USDC trustline (the SAC traps on balance). */
  hasTrustline: boolean
}

/** Balance on any Stellar Asset Contract; a missing trustline reads as an empty balance. */
export async function getSacBalance(network: StellarNetworkConfig, sac: string, owner: string): Promise<UsdcBalance> {
  try {
    const value = await simulateRead(network, owner, sac, 'balance', [new Address(owner).toScVal()])
    return { units: BigInt(value as bigint), hasTrustline: true }
  } catch (err) {
    if (isMissingTrustline(err instanceof Error ? err.message : String(err))) return { units: 0n, hasTrustline: false }
    throw err
  }
}

export async function getUsdcBalance(network: StellarNetworkConfig, owner: string): Promise<UsdcBalance> {
  return getSacBalance(network, network.usdcSac, owner)
}

export async function getUsdcAllowance(network: StellarNetworkConfig, owner: string): Promise<bigint> {
  const value = await simulateRead(network, owner, network.usdcSac, 'allowance', [
    new Address(owner).toScVal(),
    new Address(network.tokenMessengerMinter).toScVal(),
  ])
  return BigInt(value as bigint)
}

/**
 * Whether a Stellar recipient can hold USDC. Contracts always can; accounts
 * (including the base account behind a muxed M… address) need a trustline,
 * or the CctpForwarder's transfer to them fails.
 */
export async function canReceiveUsdc(network: StellarNetworkConfig, recipient: string, sac: string = network.usdcSac): Promise<boolean> {
  if (StrKey.isValidContract(recipient)) return true
  const account = StrKey.isValidMed25519PublicKey(recipient)
    ? MuxedAccount.fromAddress(recipient, '0').baseAccount().accountId()
    : recipient
  const { hasTrustline } = await getSacBalance(network, sac, account)
  return hasTrustline
}

async function invokeSigned(network: StellarNetworkConfig, source: string, contractId: string, method: string, args: xdr.ScVal[], sign: SignXdr): Promise<string> {
  const server = serverFor(network)
  const account = await server.getAccount(source)
  const tx = new TransactionBuilder(account, { fee: '10000', networkPassphrase: network.passphrase })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(180)
    .build()

  const prepared = await server.prepareTransaction(tx)
  const signedXdr = await sign(prepared.toXDR())
  const signed = TransactionBuilder.fromXDR(signedXdr, network.passphrase)

  const sent = await server.sendTransaction(signed)
  if (sent.status === 'ERROR' || sent.status === 'TRY_AGAIN_LATER') {
    throw new Error(`Stellar rejected the transaction (${sent.status})`)
  }
  const result = await server.pollTransaction(sent.hash, { attempts: 30 })
  if (result.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`Transaction ${sent.hash.slice(0, 8)}… ended as ${result.status}`)
  }
  return sent.hash
}

/** Ledgers the approval stays valid (~40 min) so a slow second signature doesn't miss it. */
const APPROVAL_LEDGER_WINDOW = 500

export async function approveUsdc(network: StellarNetworkConfig, owner: string, amount: bigint, sign: SignXdr): Promise<string> {
  const { sequence } = await serverFor(network).getLatestLedger()
  return invokeSigned(network, owner, network.usdcSac, 'approve', [
    new Address(owner).toScVal(),
    new Address(network.tokenMessengerMinter).toScVal(),
    nativeToScVal(amount, { type: 'i128' }),
    nativeToScVal(sequence + APPROVAL_LEDGER_WINDOW, { type: 'u32' }),
  ], sign)
}

export interface BurnParams {
  owner: string
  /** 7-decimal Stellar units. */
  amount: bigint
  destinationDomain: number
  mintRecipient: Uint8Array
  /** 7-decimal Stellar units. */
  maxFee: bigint
  hookData: Uint8Array
}

/**
 * Burns USDC on Stellar with the Forwarding Service hook.
 * `destination_caller` must stay 32 zero bytes, or Circle can't submit the mint.
 */
export async function depositForBurnWithHook(network: StellarNetworkConfig, params: BurnParams, sign: SignXdr): Promise<string> {
  return invokeSigned(network, params.owner, network.tokenMessengerMinter, 'deposit_for_burn_with_hook', [
    new Address(params.owner).toScVal(),
    nativeToScVal(params.amount, { type: 'i128' }),
    nativeToScVal(params.destinationDomain, { type: 'u32' }),
    nativeToScVal(Buffer.from(params.mintRecipient), { type: 'bytes' }),
    new Address(network.usdcSac).toScVal(),
    nativeToScVal(Buffer.alloc(32), { type: 'bytes' }),
    nativeToScVal(params.maxFee, { type: 'i128' }),
    nativeToScVal(STANDARD_FINALITY, { type: 'u32' }),
    nativeToScVal(Buffer.from(params.hookData), { type: 'bytes' }),
  ], sign)
}

/**
 * Completes an inbound transfer: the CctpForwarder receives the CCTP message,
 * mints USDC to itself and forwards it to the recipient named in the hook data.
 * Anyone can submit it; the signer only pays the XLM fee.
 */
export async function mintAndForward(network: StellarNetworkConfig, signer: string, messageHex: string, attestationHex: string, sign: SignXdr): Promise<string> {
  return invokeSigned(network, signer, network.cctpForwarder, 'mint_and_forward', [
    nativeToScVal(Buffer.from(fromHex(messageHex)), { type: 'bytes' }),
    nativeToScVal(Buffer.from(fromHex(attestationHex)), { type: 'bytes' }),
  ], sign)
}

/* ---------- USDT0 OFT (LayerZero) ---------- */

const mapEntry = (key: string, val: xdr.ScVal): xdr.ScMapEntry => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val })
const bytesVal = (bytes: Uint8Array): xdr.ScVal => nativeToScVal(Buffer.from(bytes), { type: 'bytes' })
const i128 = (value: bigint): xdr.ScVal => nativeToScVal(value, { type: 'i128' })

/**
 * oft-core's SendParam. Soroban structs travel as maps whose keys must be
 * sorted, so the entries are listed alphabetically. Amounts are the token's
 * 7 decimals.
 */
export function oftSendParamScVal(transfer: OftTransfer): xdr.ScVal {
  return xdr.ScVal.scvMap([
    mapEntry('amount_ld', i128(toStellarUnits(transfer.amount))),
    mapEntry('compose_msg', bytesVal(new Uint8Array())),
    mapEntry('dst_eid', nativeToScVal(transfer.route.dstEid, { type: 'u32' })),
    mapEntry('extra_options', bytesVal(new Uint8Array())),
    mapEntry('min_amount_ld', i128(toStellarUnits(transfer.minAmount))),
    mapEntry('oft_cmd', bytesVal(new Uint8Array())),
    mapEntry('to', bytesVal(transfer.to)),
  ])
}

function messagingFeeScVal(nativeFee: bigint): xdr.ScVal {
  return xdr.ScVal.scvMap([mapEntry('native_fee', i128(nativeFee)), mapEntry('zro_fee', i128(0n))])
}

interface StellarOftQuoteResult {
  limit: { min_amount_ld: bigint; max_amount_ld: bigint }
  receipt: { amount_sent_ld: bigint; amount_received_ld: bigint }
}

/**
 * quote_oft + quote_send by simulation. `from` only has to be an existing
 * account; the quotes don't read its balance, so the asset issuer works
 * before a wallet is connected. The messaging fee comes back in stroops.
 */
export async function quoteStellarOft(network: StellarNetworkConfig, from: string, transfer: OftTransfer): Promise<OftQuote> {
  const oft = transfer.route.contract
  const param = oftSendParamScVal(transfer)
  const [oftResult, fee] = await Promise.all([
    simulateRead(network, from, oft, 'quote_oft', [new Address(from).toScVal(), param]),
    simulateRead(network, from, oft, 'quote_send', [new Address(from).toScVal(), param, xdr.ScVal.scvBool(false)]),
  ])
  const [limit, , receipt] = oftResult as [StellarOftQuoteResult['limit'], unknown, StellarOftQuoteResult['receipt']]
  return {
    amountSent: fromStellarUnits(BigInt(receipt.amount_sent_ld)),
    amountReceived: fromStellarUnits(BigInt(receipt.amount_received_ld)),
    minAmount: fromStellarUnits(BigInt(limit.min_amount_ld)),
    maxAmount: fromStellarUnits(BigInt(limit.max_amount_ld)),
    nativeFee: BigInt((fee as { native_fee: bigint }).native_fee),
  }
}

/**
 * One transaction: the OFT burns the USDT0 through its SAC manager and pays
 * the LayerZero fee in XLM, both under the sender's single authorization.
 * Excess fee goes back to the sender as refund address.
 */
export async function stellarOftSend(network: StellarNetworkConfig, owner: string, transfer: OftTransfer, nativeFee: bigint, sign: SignXdr): Promise<string> {
  return invokeSigned(network, owner, transfer.route.contract, 'send', [
    new Address(owner).toScVal(),
    oftSendParamScVal(transfer),
    messagingFeeScVal(withFeeBuffer(nativeFee)),
    new Address(owner).toScVal(),
  ], sign)
}
