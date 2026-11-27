import type { AssetId } from '../config/assets'
import type { Chain } from '../config/chains'
import { NETWORK } from '../config/networks'
import { STELLAR_USDT0_ASSET, USDT0, usdt0Route, type Usdt0Route } from '../config/usdt0'
import { quoteEvmOft } from './evm'
import { amountForReceive, computeMaxFee, fetchFeeQuotes, type FeeQuote, type FeeQuotes } from './fees'
import { amountForOftReceive, type OftQuote, type OftTransfer } from './oft'
import { isValidRecipient, isValidRecipientFor, oftRecipientBytes32 } from './recipient'
import { accountExists, deriveUsdcAta } from './solana'
import { canReceiveUsdc, quoteStellarOft } from './stellar'

/** What the destination looks like right now, plus Circle's fees for both speeds. */
export interface RouteInfo {
  quotes: FeeQuotes
  /** Solana destination: the recipient's USDC token account. */
  solanaAta?: string
  solanaAtaExists?: boolean
  /** Stellar destination: false when the recipient can't hold USDC yet (no trustline). */
  stellarRecipientReady?: boolean
}

export async function loadRouteInfo(source: Chain, destination: Chain, recipient: string, signal?: AbortSignal): Promise<RouteInfo> {
  const owner = recipient.trim()
  const valid = isValidRecipient(destination.kind, owner)
  let solanaAta: string | undefined
  let solanaAtaExists: boolean | undefined
  let stellarRecipientReady: boolean | undefined

  if (destination.kind === 'solana' && valid) {
    solanaAta = await deriveUsdcAta(owner, NETWORK.solanaUsdcMint)
    solanaAtaExists = await accountExists(NETWORK.solanaRpcUrl, solanaAta, signal)
  }
  if (destination.kind === 'stellar' && valid) {
    stellarRecipientReady = await canReceiveUsdc(NETWORK, owner).catch(() => true)
  }

  const quotes = await fetchFeeQuotes(
    NETWORK.irisUrl,
    {
      sourceDomain: source.domain,
      destinationDomain: destination.domain,
      // Circle can't forward into Stellar; the user claims there instead.
      forward: destination.kind !== 'stellar',
      includeRecipientSetup: solanaAtaExists === false,
    },
    signal,
  )
  return { quotes, solanaAta, solanaAtaExists, stellarRecipientReady }
}

/** The quote for the chosen speed; falls back to standard where Fast isn't offered. */
export function pickQuote(info: RouteInfo, source: Chain, fast: boolean): FeeQuote {
  return fast && source.fastSource && info.quotes.fast ? info.quotes.fast : info.quotes.standard
}

export interface Costs {
  quote: FeeQuote
  maxFee: bigint
  receive: bigint
}

/**
 * Exact out: what to send so `receive` lands, from the quote of whichever rail the asset uses.
 * Null until that quote is in.
 */
export function sendForReceive(
  asset: AssetId,
  receive: bigint,
  usdc: RouteInfo | null,
  usdt: UsdtRouteInfo | null,
  source: Chain,
  fast: boolean,
): bigint | null {
  try {
    if (asset === 'usdc') return usdc ? amountForReceive(receive, pickQuote(usdc, source, fast)) : null
    if (!usdt) return null
    const amount = amountForOftReceive(usdt.quote, receive)
    // The form scales a quote taken at another size; one unit of headroom absorbs the
    // on-chain fee rounding differently, so the fresh quote at send time still clears the target.
    return amount > receive ? amount + 1n : amount
  } catch {
    return null
  }
}

export function costsFor(info: RouteInfo, source: Chain, fast: boolean, amount: bigint): Costs {
  const quote = pickQuote(info, source, fast)
  const maxFee = computeMaxFee(amount, quote)
  return { quote, maxFee, receive: amount - maxFee }
}

/* ---------- USDT (USDT0 over LayerZero) ---------- */

export interface UsdtRouteInfo {
  route: Usdt0Route
  quote: OftQuote
  /** Stellar destination: false when the recipient has no USDT0 trustline. */
  stellarRecipientReady?: boolean
}

/** Quote size when the amount field is empty: fees are linear, so 1 USDT scales to any amount. */
const PROBE_AMOUNT = 1_000_000n
/** Any 32 bytes do for quoting; the messaging fee doesn't depend on the recipient. */
const PLACEHOLDER_RECIPIENT = new Uint8Array(32).fill(1)
/** An account that always exists on Stellar, for simulating quotes before a wallet connects. */
const STELLAR_QUOTE_ACCOUNT = STELLAR_USDT0_ASSET.split(':')[1]

export async function loadUsdtRouteInfo(
  source: Chain,
  destination: Chain,
  recipient: string,
  amount: bigint | null,
  owner: string | null,
): Promise<UsdtRouteInfo> {
  const route = usdt0Route(source.id, destination.id)
  if (!route) throw new Error(`No direct USDT route from ${source.name} to ${destination.name}`)
  const to = recipient.trim()
  const valid = isValidRecipientFor('usdt', destination.kind, to)
  const transfer: OftTransfer = {
    route,
    amount: amount && amount > 0n ? amount : PROBE_AMOUNT,
    to: valid ? oftRecipientBytes32(destination.kind, to) : PLACEHOLDER_RECIPIENT,
    minAmount: 0n,
  }
  const [quote, stellarRecipientReady] = await Promise.all([
    source.kind === 'stellar' ? quoteStellarOft(NETWORK, owner ?? STELLAR_QUOTE_ACCOUNT, transfer) : quoteEvmOft(source, transfer),
    destination.kind === 'stellar' && valid ? canReceiveUsdc(NETWORK, to, USDT0.stellar.token).catch(() => true) : Promise.resolve(undefined),
  ])
  return { route, quote, stellarRecipientReady }
}
