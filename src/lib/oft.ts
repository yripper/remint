import type { Usdt0Route } from '../config/usdt0'

/** What an OFT route does with an amount, in 6-decimal units like the rest of the app. */
export interface OftQuote {
  amountSent: bigint
  amountReceived: bigint
  /** Route limits from quoteOFT; the Legacy Mesh caps sends at the destination pool's liquidity. */
  minAmount: bigint
  maxAmount: bigint
  /** LayerZero messaging fee in the source chain's native token, smallest unit. */
  nativeFee: bigint
}

export interface OftTransfer {
  route: Usdt0Route
  /** 6-decimal units. */
  amount: bigint
  /** Recipient as the 32 raw bytes the destination OFT resolves. */
  to: Uint8Array
  /** Floor for what arrives; the send reverts below it. 6-decimal units. */
  minAmount: bigint
}

/**
 * Headroom on the quoted messaging fee. EVM OFTs require msg.value to equal
 * the fee we pass, and the endpoint refunds whatever the executor didn't
 * need to the refund address, so overpaying a little costs nothing and
 * survives a gas tick between quote and send.
 */
const FEE_BUFFER_BPS = 500n

export function withFeeBuffer(fee: bigint): bigint {
  return fee + (fee * FEE_BUFFER_BPS) / 10_000n
}

/** The amount that lands for `amount`, scaled from a quote taken at another amount (fees are linear). */
export function scaleReceived(quote: OftQuote, amount: bigint): bigint {
  if (quote.amountSent === 0n) return amount
  return (amount * quote.amountReceived) / quote.amountSent
}

/** Exact out: the smallest amount that `scaleReceived` lands at `receive` or more. */
export function amountForOftReceive(quote: OftQuote, receive: bigint): bigint {
  if (receive <= 0n) return 0n
  if (quote.amountSent === 0n) return receive
  if (quote.amountReceived <= 0n) throw new Error('Nothing would arrive on this route')
  let amount = (receive * quote.amountSent + quote.amountReceived - 1n) / quote.amountReceived
  while (scaleReceived(quote, amount) < receive) amount += 1n
  while (amount > 1n && scaleReceived(quote, amount - 1n) >= receive) amount -= 1n
  return amount
}

/** USDT0 charges nothing on OFT routes and 3 bps on the Legacy Mesh; read it off the quote. */
export function feeBps(quote: OftQuote): number {
  if (quote.amountSent === 0n) return 0
  return Number(((quote.amountSent - quote.amountReceived) * 10_000n) / quote.amountSent)
}
