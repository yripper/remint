import {
  createPublicClient,
  createWalletClient,
  custom,
  erc20Abi,
  http,
  numberToHex,
  parseAbi,
  type EIP1193Provider,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem'
import type { Chain, EvmChainInfo } from '../config/chains'
import { USDT0 } from '../config/usdt0'
import { toHex } from './hooks'
import { withFeeBuffer, type OftQuote, type OftTransfer } from './oft'

/** TokenMessengerV2.depositForBurnWithHook, as in Circle's adapter-viem-v2 ABI. */
const TOKEN_MESSENGER_V2_ABI = [
  {
    type: 'function',
    name: 'depositForBurnWithHook',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'destinationDomain', type: 'uint32' },
      { name: 'mintRecipient', type: 'bytes32' },
      { name: 'burnToken', type: 'address' },
      { name: 'destinationCaller', type: 'bytes32' },
      { name: 'maxFee', type: 'uint256' },
      { name: 'minFinalityThreshold', type: 'uint32' },
      { name: 'hookData', type: 'bytes' },
    ],
    outputs: [],
  },
] as const

/** LayerZero IOFT, as in docs.usdt0.to's developer guide; the Legacy Mesh pools expose the same surface. */
const OFT_ABI = parseAbi([
  'struct SendParam { uint32 dstEid; bytes32 to; uint256 amountLD; uint256 minAmountLD; bytes extraOptions; bytes composeMsg; bytes oftCmd; }',
  'struct OFTLimit { uint256 minAmountLD; uint256 maxAmountLD; }',
  'struct OFTFeeDetail { int256 feeAmountLD; string description; }',
  'struct OFTReceipt { uint256 amountSentLD; uint256 amountReceivedLD; }',
  'struct MessagingFee { uint256 nativeFee; uint256 lzTokenFee; }',
  'struct MessagingReceipt { bytes32 guid; uint64 nonce; MessagingFee fee; }',
  'function quoteOFT(SendParam _sendParam) view returns (OFTLimit, OFTFeeDetail[], OFTReceipt)',
  'function quoteSend(SendParam _sendParam, bool _payInLzToken) view returns (MessagingFee)',
  'function send(SendParam _sendParam, MessagingFee _fee, address _refundAddress) payable returns (MessagingReceipt, OFTReceipt)',
  'function approvalRequired() view returns (bool)',
])

export interface EvmWalletInfo {
  /** EIP-6963 reverse-DNS id, or 'injected' for a bare window.ethereum. */
  rdns: string
  name: string
  icon: string
}

export interface EvmWallet {
  info: EvmWalletInfo
  provider: EIP1193Provider
}

interface AnnounceEvent extends Event {
  detail: { info: { rdns: string; name: string; icon: string; uuid: string }; provider: EIP1193Provider }
}

const discovered = new Map<string, EvmWallet>()
const listeners = new Set<() => void>()
let snapshot: EvmWallet[] = []
let started = false

function publish(): void {
  snapshot = [...discovered.values()]
  listeners.forEach((fn) => fn())
}

/**
 * EIP-6963 discovery: every installed wallet announces itself, so MetaMask,
 * Rabby and Coinbase can coexist without fighting over window.ethereum.
 */
function startDiscovery(): void {
  if (started || typeof window === 'undefined') return
  started = true
  window.addEventListener('eip6963:announceProvider', (event) => {
    const { info, provider } = (event as AnnounceEvent).detail
    discovered.set(info.rdns, { info: { rdns: info.rdns, name: info.name, icon: info.icon }, provider })
    publish()
  })
  window.dispatchEvent(new Event('eip6963:requestProvider'))
  // Older wallets only inject window.ethereum; offer it when nothing announced itself.
  window.setTimeout(() => {
    const legacy = (window as { ethereum?: EIP1193Provider }).ethereum
    if (discovered.size === 0 && legacy) {
      discovered.set('injected', { info: { rdns: 'injected', name: 'Browser wallet', icon: '' }, provider: legacy })
      publish()
    }
  }, 400)
}

export function subscribeEvmWallets(listener: () => void): () => void {
  startDiscovery()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getEvmWallets(): EvmWallet[] {
  return snapshot
}

export async function requestEvmAccount(provider: EIP1193Provider, silent: boolean = false): Promise<string | null> {
  const accounts = await provider.request({ method: silent ? 'eth_accounts' : 'eth_requestAccounts' })
  return accounts[0] ?? null
}

function evmInfo(chain: Chain): EvmChainInfo {
  if (!chain.evm) throw new Error(`${chain.name} is not an EVM chain`)
  return chain.evm
}

const publicClients = new Map<string, PublicClient>()

/** Public RPC from Circle's chain definitions; used for reads before the wallet is on the right chain. */
function publicClientFor(chain: Chain): PublicClient {
  let client = publicClients.get(chain.id)
  if (!client) {
    client = createPublicClient({ transport: http(evmInfo(chain).rpcUrl) })
    publicClients.set(chain.id, client)
  }
  return client
}

export async function getEvmTokenBalance(chain: Chain, token: string, owner: string): Promise<bigint> {
  return publicClientFor(chain).readContract({
    address: token as Hex,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [owner as Hex],
  })
}

export async function getEvmUsdcBalance(chain: Chain, owner: string): Promise<bigint> {
  return getEvmTokenBalance(chain, evmInfo(chain).usdc, owner)
}

interface ProviderRpcError {
  code?: number
  data?: { originalError?: { code?: number } }
}

function errorCode(err: unknown): number | undefined {
  const e = err as ProviderRpcError
  return e.code ?? e.data?.originalError?.code
}

/** Asks the wallet to switch networks, adding the chain first if the wallet doesn't know it. */
export async function ensureEvmChain(provider: EIP1193Provider, chain: Chain): Promise<void> {
  const info = evmInfo(chain)
  const chainId = numberToHex(info.chainId)
  const current = await provider.request({ method: 'eth_chainId' })
  if (current.toLowerCase() === chainId.toLowerCase()) return
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] })
  } catch (err) {
    // 4902: the wallet has never seen this chain.
    if (errorCode(err) !== 4902) throw err
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId,
        chainName: chain.name,
        nativeCurrency: info.nativeCurrency,
        rpcUrls: [info.rpcUrl],
        blockExplorerUrls: chain.txExplorer ? [chain.txExplorer.replace(/\/tx\/$/, '')] : undefined,
      }],
    })
  }
}

export interface EvmBurnParams {
  account: string
  amount: bigint
  destinationDomain: number
  mintRecipient: Uint8Array
  destinationCaller: Uint8Array
  maxFee: bigint
  finality: number
  hookData: Uint8Array
}

const bytesToHex = (bytes: Uint8Array): Hex => `0x${toHex(bytes)}`

/** Tether's Ethereum USDT reverts on approve unless the current allowance is zero. */
const RESET_BEFORE_APPROVE = new Set([USDT0.ethereum.token.toLowerCase()])

interface AllowanceArgs {
  wallet: WalletClient
  reader: PublicClient
  token: Hex
  owner: Hex
  spender: Hex
  amount: bigint
  onApprove: () => void
}

/** Approves exactly what this transfer needs, only when the current allowance falls short. */
async function ensureAllowance({ wallet, reader, token, owner, spender, amount, onApprove }: AllowanceArgs): Promise<void> {
  const allowance = await reader.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [owner, spender] })
  if (allowance >= amount) return
  onApprove()
  const approve = async (value: bigint) => {
    const hash = await wallet.writeContract({ account: owner, chain: null, address: token, abi: erc20Abi, functionName: 'approve', args: [spender, value] })
    const receipt = await reader.waitForTransactionReceipt({ hash })
    if (receipt.status !== 'success') throw new Error('The token approval reverted')
  }
  if (allowance > 0n && RESET_BEFORE_APPROVE.has(token.toLowerCase())) await approve(0n)
  await approve(amount)
}

/**
 * Approve (when needed) and burn on an EVM chain through the user's wallet.
 * Receipts are read through the wallet's own RPC, which is already on the right chain.
 */
export async function evmApproveAndBurn(
  provider: EIP1193Provider,
  chain: Chain,
  params: EvmBurnParams,
  onStep: (step: 'approve' | 'burn') => void,
): Promise<string> {
  const info = evmInfo(chain)
  await ensureEvmChain(provider, chain)
  const account = params.account as Hex
  const wallet = createWalletClient({ account, transport: custom(provider) })
  const reader = createPublicClient({ transport: custom(provider) })

  await ensureAllowance({
    wallet,
    reader,
    token: info.usdc,
    owner: account,
    spender: info.tokenMessenger,
    amount: params.amount,
    onApprove: () => onStep('approve'),
  })

  onStep('burn')
  const burnHash = await wallet.writeContract({
    chain: null,
    address: info.tokenMessenger,
    abi: TOKEN_MESSENGER_V2_ABI,
    functionName: 'depositForBurnWithHook',
    args: [
      params.amount,
      params.destinationDomain,
      bytesToHex(params.mintRecipient),
      info.usdc,
      bytesToHex(params.destinationCaller),
      params.maxFee,
      params.finality,
      bytesToHex(params.hookData),
    ],
  })
  const receipt = await reader.waitForTransactionReceipt({ hash: burnHash })
  if (receipt.status !== 'success') throw new Error('The burn transaction reverted')
  return burnHash
}

function oftSendParam(transfer: OftTransfer) {
  return {
    dstEid: transfer.route.dstEid,
    to: bytesToHex(transfer.to),
    amountLD: transfer.amount,
    minAmountLD: transfer.minAmount,
    // Empty: USDT0 sets enforced options per pathway, including the Solana token-account rent.
    extraOptions: '0x' as Hex,
    composeMsg: '0x' as Hex,
    oftCmd: '0x' as Hex,
  }
}

async function readOftQuote(client: PublicClient, transfer: OftTransfer): Promise<OftQuote> {
  const address = transfer.route.contract as Hex
  const param = oftSendParam(transfer)
  const [[limit, , receipt], fee] = await Promise.all([
    client.readContract({ address, abi: OFT_ABI, functionName: 'quoteOFT', args: [param] }),
    client.readContract({ address, abi: OFT_ABI, functionName: 'quoteSend', args: [param, false] }),
  ])
  return {
    amountSent: receipt.amountSentLD,
    amountReceived: receipt.amountReceivedLD,
    minAmount: limit.minAmountLD,
    maxAmount: limit.maxAmountLD,
    nativeFee: fee.nativeFee,
  }
}

/** Read-only quote over the chain's public RPC, so it works before a wallet is connected. */
export async function quoteEvmOft(chain: Chain, transfer: OftTransfer): Promise<OftQuote> {
  return readOftQuote(publicClientFor(chain), transfer)
}

/**
 * Sends USDT through a USDT0 OFT (or Legacy Mesh pool) from the user's wallet:
 * approve if the contract pulls tokens, re-quote the messaging fee on the
 * wallet's RPC, then `send` with that fee as msg.value.
 */
export async function evmOftSend(
  provider: EIP1193Provider,
  chain: Chain,
  account: string,
  token: string,
  transfer: OftTransfer,
  onStep: (step: 'approve' | 'burn') => void,
): Promise<string> {
  await ensureEvmChain(provider, chain)
  const owner = account as Hex
  const address = transfer.route.contract as Hex
  const wallet = createWalletClient({ account: owner, transport: custom(provider) })
  const reader = createPublicClient({ transport: custom(provider) })

  // Ethereum's adapter and the Legacy Mesh pools pull tokens with transferFrom; USDT0 OFTs burn directly.
  const needsApproval = await reader.readContract({ address, abi: OFT_ABI, functionName: 'approvalRequired' })
  if (needsApproval) {
    await ensureAllowance({ wallet, reader, token: token as Hex, owner, spender: address, amount: transfer.amount, onApprove: () => onStep('approve') })
  }

  const quote = await readOftQuote(reader, transfer)
  if (quote.amountReceived < transfer.minAmount) throw new Error('The route now delivers less than quoted. Review the new amount and try again.')
  const nativeFee = withFeeBuffer(quote.nativeFee)

  onStep('burn')
  const hash = await wallet.writeContract({
    account: owner,
    chain: null,
    address,
    abi: OFT_ABI,
    functionName: 'send',
    args: [oftSendParam(transfer), { nativeFee, lzTokenFee: 0n }, owner],
    value: nativeFee,
  })
  const receipt = await reader.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error('The send transaction reverted')
  return hash
}
