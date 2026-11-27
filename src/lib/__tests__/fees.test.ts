import { describe, expect, it } from 'vitest'
import { amountForReceive, computeMaxFee, parseFeeQuote, parseFeeQuotes, protocolFee, type FeeQuote } from '../fees'

// Live shape from GET /v2/burn/USDC/fees/6/5?forward=true (Base to Solana).
const LIVE_SHAPE = [
  { finalityThreshold: 1000, minimumFee: 1.3, forwardFee: { low: 99924, med: 101066, high: 108532 } },
  { finalityThreshold: 2000, minimumFee: 0, forwardFee: { low: 99924, med: 101066, high: 108532 } },
]

describe('parseFeeQuote', () => {
  it('picks the entry for the requested finality', () => {
    expect(parseFeeQuote(LIVE_SHAPE, 2000, true)).toEqual({ finality: 2000, protocolBps: 0, forwardFee: 101_066n })
    expect(parseFeeQuote(LIVE_SHAPE, 1000, true)).toEqual({ finality: 1000, protocolBps: 1.3, forwardFee: 101_066n })
  })
  it('ignores the forward fee when the user mints themselves', () => {
    expect(parseFeeQuote(LIVE_SHAPE, 2000, false).forwardFee).toBe(0n)
  })
  it('accepts the spec name `medium`', () => {
    const quote = parseFeeQuote([{ finalityThreshold: 2000, minimumFee: 0, forwardFee: { medium: 10 } }], 2000, true)
    expect(quote.forwardFee).toBe(10n)
  })
  it('throws when forwarding is wanted but not offered', () => {
    expect(() => parseFeeQuote([{ finalityThreshold: 2000, minimumFee: 0 }], 2000, true)).toThrow(/forwarding/)
  })
  it('surfaces the API error message', () => {
    expect(() => parseFeeQuote({ error: 'Destination domain not supported for forwarding' }, 2000, true)).toThrow(/not supported/)
  })
  it('throws when the speed has no entry', () => {
    expect(() => parseFeeQuote([{ finalityThreshold: 2000, minimumFee: 0 }], 1000, false)).toThrow(/speed/)
  })
})

describe('parseFeeQuotes', () => {
  it('returns both speeds from one payload', () => {
    const quotes = parseFeeQuotes(LIVE_SHAPE, true)
    expect(quotes.standard.protocolBps).toBe(0)
    expect(quotes.fast?.protocolBps).toBe(1.3)
  })
  it('returns a null fast quote when Circle has none', () => {
    expect(parseFeeQuotes([{ finalityThreshold: 2000, minimumFee: 0 }], false).fast).toBeNull()
  })
})

describe('protocolFee and computeMaxFee', () => {
  it('rounds the bps fee up', () => {
    // 1.3 bps of 10 USDC (10_000_000 units) = 1_300 units
    expect(protocolFee(10_000_000n, 1.3)).toBe(1_300n)
    expect(protocolFee(1n, 1)).toBe(1n)
    expect(protocolFee(10_000_000n, 0)).toBe(0n)
  })
  it('adds the forwarding fee', () => {
    expect(computeMaxFee(10_000_000n, { finality: 1000, protocolBps: 1.3, forwardFee: 101_066n })).toBe(102_366n)
  })
})

describe('amountForReceive', () => {
  const lands = (amount: bigint, quote: FeeQuote) => amount - computeMaxFee(amount, quote)
  const fast: FeeQuote = { finality: 1000, protocolBps: 1.3, forwardFee: 101_066n }
  const standard: FeeQuote = { finality: 2000, protocolBps: 0, forwardFee: 0n }

  it('adds nothing when the route is free', () => {
    expect(amountForReceive(10_000_000n, standard)).toBe(10_000_000n)
  })
  it('adds the forwarding fee on a flat-fee route', () => {
    expect(amountForReceive(10_000_000n, { ...standard, forwardFee: 101_066n })).toBe(10_101_066n)
  })
  it('returns the smallest amount that lands at least the target', () => {
    for (const target of [1n, 999_999n, 10_000_000n, 123_456_789n, 5_000_000_000_000n]) {
      const amount = amountForReceive(target, fast)
      expect(lands(amount, fast)).toBeGreaterThanOrEqual(target)
      expect(lands(amount - 1n, fast)).toBeLessThan(target)
    }
  })
  it('returns 0 for an empty target', () => {
    expect(amountForReceive(0n, fast)).toBe(0n)
  })
})
