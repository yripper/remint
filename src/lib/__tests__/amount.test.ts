import { describe, expect, it } from 'vitest'
import { formatUnits, fromStellarUnits, parseUnits, sanitizeAmountInput, toStellarUnits, unitsToInput } from '../amount'

describe('sanitizeAmountInput', () => {
  it('accepts digits with up to 6 decimals', () => {
    expect(sanitizeAmountInput('12.345678')).toBe('12.345678')
  })
  it('rejects a 7th decimal because CCTP would not burn it', () => {
    expect(sanitizeAmountInput('1.1234567')).toBeNull()
  })
  it('normalizes a comma decimal separator', () => {
    expect(sanitizeAmountInput('3,5')).toBe('3.5')
  })
  it('rejects letters and a second dot', () => {
    expect(sanitizeAmountInput('1a')).toBeNull()
    expect(sanitizeAmountInput('1.2.3')).toBeNull()
  })
  it('allows empty input so the field can be cleared', () => {
    expect(sanitizeAmountInput('')).toBe('')
  })
})

describe('parseUnits', () => {
  it('converts to 6-decimal CCTP units', () => {
    expect(parseUnits('5')).toBe(5_000_000n)
    expect(parseUnits('0.123456')).toBe(123_456n)
    expect(parseUnits('.5')).toBe(500_000n)
  })
  it('returns null for empty or invalid input', () => {
    expect(parseUnits('')).toBeNull()
    expect(parseUnits('.')).toBeNull()
    expect(parseUnits('abc')).toBeNull()
    expect(parseUnits('1.1234567')).toBeNull()
  })
  it('handles amounts beyond Number precision', () => {
    expect(parseUnits('9007199254740.993')).toBe(9_007_199_254_740_993_000n)
  })
})

describe('formatUnits', () => {
  it('groups thousands and trims trailing zeros', () => {
    expect(formatUnits(1_234_567_000n)).toBe('1,234.567')
  })
  it('keeps the minimum fraction digits', () => {
    expect(formatUnits(5_000_000n)).toBe('5.00')
    expect(formatUnits(5_000_000n, 6, 0)).toBe('5')
  })
  it('formats zero and negatives', () => {
    expect(formatUnits(0n)).toBe('0.00')
    expect(formatUnits(-500_000n)).toBe('-0.50')
  })
})

describe('Stellar unit conversion', () => {
  it('adds the 7th decimal going to Stellar', () => {
    expect(toStellarUnits(1_234_567n)).toBe(12_345_670n)
  })
  it('drops the 7th decimal coming from Stellar', () => {
    expect(fromStellarUnits(12_345_679n)).toBe(1_234_567n)
  })
})

describe('unitsToInput', () => {
  it('prints a plain decimal for the input field', () => {
    expect(unitsToInput(1_234_500_000n)).toBe('1234.5')
    expect(unitsToInput(0n)).toBe('0')
  })
})
