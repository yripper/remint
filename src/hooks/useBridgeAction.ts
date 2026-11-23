import { useCallback, useState } from 'react'
import type { AssetId } from '../config/assets'
import type { Chain } from '../config/chains'
import { NETWORK } from '../config/networks'
import { USDT0 } from '../config/usdt0'
import { formatUnits, toStellarUnits } from '../lib/amount'
import { describeError, NONCE_ALREADY_USED, contractErrorCode } from '../lib/errors'
import { evmApproveAndBurn, evmOftSend } from '../lib/evm'
import type { OftTransfer } from '../lib/oft'
import { costsFor, loadRouteInfo, loadUsdtRouteInfo } from '../lib/quote'
import { bytes32ToSolanaAddress, oftRecipientBytes32 } from '../lib/recipient'
import { planBurn, type BurnPlan } from '../lib/route'
import { solanaBurn } from '../lib/solana'
import { approveUsdc, depositForBurnWithHook, getUsdcAllowance, mintAndForward, stellarOftSend } from '../lib/stellar'
import type { EvmConnection } from './useEvmWallet'
import type { SolanaConnection } from './useSolanaWallet'
import type { Transfer, TransfersStore } from './useTransfers'

export interface BridgeRequest {
  asset: AssetId
  source: Chain
  destination: Chain
  amount: bigint
  recipient: string
  fast: boolean
}

export type BridgeStep = 'idle' | 'quoting' | 'switching' | 'approve' | 'burn'

export interface Signers {
  stellar: { address: string | null; sign: (xdr: string, passphrase: string) => Promise<string> }
  evm: EvmConnection | null
  solana: SolanaConnection | null
}

interface Deps {
  store: TransfersStore
  signers: Signers
  onBurned?: () => void
}

interface BurnArgs {
  amount: bigint
  maxFee: bigint
  plan: BurnPlan
  setStep: (step: BridgeStep) => void
  markApproving: () => void
}

async function burnOnStellar(signers: Signers, destination: Chain, args: BurnArgs): Promise<string> {
  const owner = signers.stellar.address
  if (!owner) throw new Error('Connect a Stellar wallet first')
  const sign = (xdr: string) => signers.stellar.sign(xdr, NETWORK.passphrase)
  const amount = toStellarUnits(args.amount)
  // The TokenMessengerMinter pulls USDC with transfer_from, so it needs an allowance first.
  const allowance = await getUsdcAllowance(NETWORK, owner).catch(() => 0n)
  if (allowance < amount) {
    args.setStep('approve')
    args.markApproving()
    await approveUsdc(NETWORK, owner, amount, sign)
  }
  args.setStep('burn')
  return depositForBurnWithHook(
    NETWORK,
    {
      owner,
      amount,
      destinationDomain: destination.domain,
      mintRecipient: args.plan.mintRecipient,
      maxFee: toStellarUnits(args.maxFee),
      hookData: args.plan.hookData,
    },
    sign,
  )
}

async function burnOnEvm(signers: Signers, source: Chain, destination: Chain, args: BurnArgs): Promise<string> {
  const conn = signers.evm
  if (!conn) throw new Error('Connect an EVM wallet first')
  args.setStep('switching')
  return evmApproveAndBurn(
    conn.wallet.provider,
    source,
    {
      account: conn.address,
      amount: args.amount,
      destinationDomain: destination.domain,
      mintRecipient: args.plan.mintRecipient,
      destinationCaller: args.plan.destinationCaller,
      maxFee: args.maxFee,
      finality: args.plan.finality,
      hookData: args.plan.hookData,
    },
    (step) => {
      args.setStep(step)
      if (step === 'approve') args.markApproving()
    },
  )
}

async function burnOnSolana(signers: Signers, destination: Chain, args: BurnArgs): Promise<string> {
  const conn = signers.solana
  if (!conn) throw new Error('Connect a Solana wallet first')
  args.setStep('burn')
  return solanaBurn(conn.wallet, conn.account, NETWORK.solanaRpcUrl, {
    amount: args.amount,
    destination,
    mintRecipient: args.plan.mintRecipient,
    destinationCaller: bytes32ToSolanaAddress(args.plan.destinationCaller),
    maxFee: args.maxFee,
    finality: args.plan.finality,
    hookData: args.plan.hookData,
  })
}

function newTransfer(req: BridgeRequest, receive: bigint, mode: Transfer['mode'], fast: boolean): Transfer {
  return {
    id: crypto.randomUUID(),
    asset: req.asset,
    sourceChainId: req.source.id,
    destChainId: req.destination.id,
    recipient: req.recipient.trim(),
    amount: req.amount.toString(),
    receive: receive.toString(),
    createdAt: Date.now(),
    stage: 'burning',
    mode,
    fast,
  }
}

/** A transfer ready to go: the record to track, and the wallet steps that send it. */
interface Prepared {
  transfer: Transfer
  execute: (markApproving: () => void) => Promise<string>
}

async function prepareUsdc(req: BridgeRequest, signers: Signers, setStep: (step: BridgeStep) => void): Promise<Prepared> {
  // Quote again right before burning: forwarding fees follow destination gas,
  // and the Solana account or Stellar trustline may have changed.
  const info = await loadRouteInfo(req.source, req.destination, req.recipient)
  if (info.stellarRecipientReady === false) {
    throw new Error('The Stellar recipient has no USDC trustline. Add one before sending, or the claim will fail.')
  }
  const { maxFee, receive } = costsFor(info, req.source, req.fast, req.amount)
  if (receive <= 0n) throw new Error('The amount must be larger than the fees')
  const plan = planBurn(NETWORK, {
    source: req.source,
    destination: req.destination,
    recipient: req.recipient,
    fast: req.fast,
    solanaAta: info.solanaAta,
    solanaAtaExists: info.solanaAtaExists,
  })
  return {
    transfer: newTransfer(req, receive, plan.mode, plan.finality === 1000),
    execute: (markApproving) => {
      const args: BurnArgs = { amount: req.amount, maxFee, plan, setStep, markApproving }
      if (req.source.kind === 'stellar') return burnOnStellar(signers, req.destination, args)
      if (req.source.kind === 'evm') return burnOnEvm(signers, req.source, req.destination, args)
      return burnOnSolana(signers, req.destination, args)
    },
  }
}

async function prepareUsdt(req: BridgeRequest, signers: Signers, setStep: (step: BridgeStep) => void): Promise<Prepared> {
  const owner = req.source.kind === 'stellar' ? signers.stellar.address : signers.evm?.address ?? null
  if (!owner) throw new Error(`Connect a ${req.source.name} wallet first`)
  const deployment = USDT0[req.source.id]
  if (!deployment || req.source.kind === 'solana') throw new Error(`Sending USDT from ${req.source.name} isn't supported yet`)

  // Fresh on-chain quote: Legacy Mesh limits follow pool liquidity, and the Stellar trustline may have changed.
  const info = await loadUsdtRouteInfo(req.source, req.destination, req.recipient, req.amount, owner)
  if (info.stellarRecipientReady === false) {
    throw new Error('The Stellar recipient has no USDT0 trustline. Add one before sending, or the delivery will fail.')
  }
  const { quote, route } = info
  if (req.amount > quote.maxAmount) throw new Error(`This route takes at most ${formatUnits(quote.maxAmount)} USDT right now`)
  if (req.amount < quote.minAmount) throw new Error(`This route needs at least ${formatUnits(quote.minAmount)} USDT`)
  if (quote.amountReceived <= 0n) throw new Error('The amount must be larger than the fees')

  const transfer: OftTransfer = {
    route,
    amount: req.amount,
    to: oftRecipientBytes32(req.destination.kind, req.recipient),
    // The quote is exact (no AMM in the path), so the floor is what we showed.
    minAmount: quote.amountReceived,
  }
  return {
    transfer: newTransfer(req, quote.amountReceived, 'oft', false),
    execute: (markApproving) => {
      if (req.source.kind === 'stellar') {
        setStep('burn')
        return stellarOftSend(NETWORK, owner, transfer, quote.nativeFee, (xdr) => signers.stellar.sign(xdr, NETWORK.passphrase))
      }
      const conn = signers.evm
      if (!conn) throw new Error('Connect an EVM wallet first')
      setStep('switching')
      return evmOftSend(conn.wallet.provider, req.source, conn.address, deployment.token, transfer, (step) => {
        setStep(step)
        if (step === 'approve') markApproving()
      })
    },
  }
}

export function useBridgeAction({ store, signers, onBurned }: Deps) {
  const [step, setStep] = useState<BridgeStep>('idle')
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(
    async (req: BridgeRequest): Promise<string | null> => {
      setError(null)
      setStep('quoting')
      let transferId: string | null = null
      try {
        const prepared = req.asset === 'usdt' ? await prepareUsdt(req, signers, setStep) : await prepareUsdc(req, signers, setStep)
        const { transfer } = prepared
        transferId = transfer.id
        store.add(transfer)
        const burnTxHash = await prepared.execute(() => store.update(transfer.id, { stage: 'approving' }))
        store.update(transfer.id, { stage: 'burned', burnTxHash })
        onBurned?.()
        return transfer.id
      } catch (err) {
        // Nothing burned yet, so nothing to track: the error shows on the form instead.
        setError(describeError(err))
        if (transferId) store.remove(transferId)
        return null
      } finally {
        setStep('idle')
      }
    },
    [signers, store, onBurned],
  )

  return { run, step, error }
}

/** Signs the Stellar `mint_and_forward` that finishes an inbound transfer. */
export function useStellarClaim(store: TransfersStore, stellar: Signers['stellar']) {
  const [error, setError] = useState<{ id: string; message: string } | null>(null)

  const claim = useCallback(
    async (transfer: Transfer) => {
      if (!stellar.address) throw new Error('Connect a Stellar wallet first')
      if (!transfer.message || !transfer.attestation) throw new Error('Circle has not attested this transfer yet')
      setError(null)
      store.update(transfer.id, { stage: 'claiming', error: undefined })
      try {
        const hash = await mintAndForward(NETWORK, stellar.address, transfer.message, transfer.attestation, (xdr) =>
          stellar.sign(xdr, NETWORK.passphrase),
        )
        store.update(transfer.id, { stage: 'complete', destTxHash: hash })
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err)
        if (contractErrorCode(raw) === NONCE_ALREADY_USED) {
          // Someone (maybe this user in another tab) already claimed it: the USDC is delivered.
          store.update(transfer.id, { stage: 'complete' })
          return
        }
        store.update(transfer.id, { stage: 'claimable' })
        setError({ id: transfer.id, message: describeError(err) })
      }
    },
    [store, stellar],
  )

  return { claim, error }
}
