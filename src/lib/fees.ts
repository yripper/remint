import { FAST_FINALITY, STANDARD_FINALITY } from '../config/networks'

export interface FeeQuoteEntry {
  finalityThreshold: number
  /** Protocol fee in basis points. */
  minimumFee: number
  /** Forwarding fee in 6-decimal USDC units. The spec names the middle tier `medium`, the live API `med`. */
  forwardFee?: { low?: number; med?: number; medium?: number; high?: number }
}

export interface FeeQuote {
  finality: number
  protocolBps: number
  /** Forwarding fee in CCTP units (6 decimals); 0 when the user mints themselves. */
  forwardFee: bigint
}

function isFeeQuoteEntry(value: unknown): value is FeeQuoteEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return typeof entry.finalityThreshold === 'number' && typeof entry.minimumFee === 'number'
}

/** Picks the entry for the wanted finality. With `forward`, it must carry a forwarding fee. */
export function parseFeeQuote(payload: unknown, finality: number, forward: boolean): FeeQuote {
  if (!Array.isArray(payload)) {
    const message = (payload as { error?: unknown } | null)?.error
    throw new Error(typeof message === 'string' ? message : 'Unexpected fee response from Circle')
  }
  const entry = payload.filter(isFeeQuoteEntry).find((q) => q.finalityThreshold === finality)
  if (!entry) throw new Error('Circle returned no quote for this transfer speed')
  if (!forward) return { finality, protocolBps: entry.minimumFee, forwardFee: 0n }
  const med = entry.forwardFee?.med ?? entry.forwardFee?.medium
  if (typeof med !== 'number') throw new Error('Circle does not offer forwarding on this route')
  return { finality, protocolBps: entry.minimumFee, forwardFee: BigInt(Math.ceil(med)) }
}

/** Circle quotes fractional bps (e.g. 1.3), so fees are computed in millionths of the amount. */
const FEE_SCALE = 1_000_000n

function feeMillionths(protocolBps: number): bigint {
  return BigInt(Math.ceil(protocolBps * 100))
}

/** Protocol fee in CCTP units: basis points of the amount, rounded up. */
export function protocolFee(amount: bigint, protocolBps: number): bigint {
  return (amount * feeMillionths(protocolBps) + FEE_SCALE - 1n) / FEE_SCALE
}

/**
 * `maxFee` for the burn: protocol fee plus the forwarding fee.
 * Circle keeps whatever max fee covers forwarding, so no extra buffer is added.
 */
export function computeMaxFee(amount: bigint, quote: FeeQuote): bigint {
  return protocolFee(amount, quote.protocolBps) + quote.forwardFee
}

/**
 * Exact out: the smallest burn amount whose `amount - maxFee` lands at least `receive`.
 * maxFee caps what Circle takes, so the recipient never gets less than the target.
 */
export function amountForReceive(receive: bigint, quote: FeeQuote): bigint {
  if (receive <= 0n) return 0n
  const keep = FEE_SCALE - feeMillionths(quote.protocolBps)
  if (keep <= 0n) throw new Error('Circle quoted a fee that takes the whole amount')
  const lands = (amount: bigint): bigint => amount - computeMaxFee(amount, quote)
  // The closed form lands within a unit or two of the answer; the fee's rounding settles the rest.
  let amount = ((receive + quote.forwardFee) * FEE_SCALE + keep - 1n) / keep
  while (lands(amount) < receive) amount += 1n
  while (lands(amount - 1n) >= receive) amount -= 1n
  return amount
}

export interface FeeRequest {
  sourceDomain: number
  destinationDomain: number
  forward: boolean
  includeRecipientSetup: boolean
}

/** Both speeds from one response; `fast` is null where the source has no Fast Transfer entry. */
export interface FeeQuotes {
  standard: FeeQuote
  fast: FeeQuote | null
}

export function parseFeeQuotes(payload: unknown, forward: boolean): FeeQuotes {
  const standard = parseFeeQuote(payload, STANDARD_FINALITY, forward)
  let fast: FeeQuote | null = null
  try {
    fast = parseFeeQuote(payload, FAST_FINALITY, forward)
  } catch {
    fast = null
  }
  return { standard, fast }
}

export async function fetchFeeQuotes(irisUrl: string, req: FeeRequest, signal?: AbortSignal): Promise<FeeQuotes> {
  const params = new URLSearchParams()
  if (req.forward) params.set('forward', 'true')
  if (req.forward && req.includeRecipientSetup) params.set('includeRecipientSetup', 'true')
  const query = params.size ? `?${params}` : ''
  const res = await fetch(`${irisUrl}/v2/burn/USDC/fees/${req.sourceDomain}/${req.destinationDomain}${query}`, { signal })
  const body: unknown = await res.json().catch(() => null)
  if (!res.ok && !Array.isArray(body)) {
    const message = (body as { error?: unknown; message?: unknown } | null)?.error ?? (body as { message?: unknown } | null)?.message
    throw new Error(typeof message === 'string' ? message : `Fee quote failed (${res.status})`)
  }
  return parseFeeQuotes(body, req.forward)
}
