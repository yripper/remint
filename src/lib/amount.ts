/**
 * Every amount in the app is in CCTP units: 6 decimals, like USDC on EVM and
 * Solana and like the CCTP message itself. Stellar USDC has 7 decimals, so it is
 * converted only at the Stellar boundary.
 */
export const CCTP_DECIMALS = 6

const INPUT_PATTERN = /^\d*\.?\d*$/

/** Keeps the amount input to digits plus one dot, capped at 6 decimals. */
export function sanitizeAmountInput(raw: string): string | null {
  const value = raw.replace(',', '.')
  if (!INPUT_PATTERN.test(value)) return null
  const [, fraction = ''] = value.split('.')
  if (fraction.length > CCTP_DECIMALS) return null
  return value
}

/** Parses a decimal string into 6-decimal units. Returns null for empty or invalid input. */
export function parseUnits(value: string): bigint | null {
  if (!value || value === '.') return null
  if (!INPUT_PATTERN.test(value)) return null
  const [whole = '0', fraction = ''] = value.split('.')
  if (fraction.length > CCTP_DECIMALS) return null
  const padded = fraction.padEnd(CCTP_DECIMALS, '0')
  return BigInt(whole || '0') * 10n ** BigInt(CCTP_DECIMALS) + BigInt(padded || '0')
}

/** Formats units with the given decimals, trimming trailing zeros but keeping at least `minFraction`. */
export function formatUnits(units: bigint, decimals: number = CCTP_DECIMALS, minFraction: number = 2): string {
  const negative = units < 0n
  const abs = negative ? -units : units
  const base = 10n ** BigInt(decimals)
  const whole = abs / base
  let fraction = (abs % base).toString().padStart(decimals, '0').replace(/0+$/, '')
  if (fraction.length < minFraction) fraction = fraction.padEnd(minFraction, '0')
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${negative ? '-' : ''}${wholeStr}${fraction ? `.${fraction}` : ''}`
}

/** 6-decimal CCTP units to Stellar's 7-decimal units. */
export function toStellarUnits(units: bigint): bigint {
  return units * 10n
}

/** Stellar 7-decimal units to CCTP units, dropping the 7th decimal a burn would leave behind. */
export function fromStellarUnits(stellarUnits: bigint): bigint {
  return stellarUnits / 10n
}

/** Plain decimal string for an input field (no grouping). */
export function unitsToInput(units: bigint): string {
  return formatUnits(units, CCTP_DECIMALS, 0).replace(/,/g, '')
}

/**
 * Short display for gas-sized values (e.g. 0.0004834 ETH). Display only: it
 * goes through a float, which is fine at 4 significant digits.
 */
export function formatSignificant(units: bigint, decimals: number, digits: number = 4): string {
  if (units === 0n) return '0'
  const value = Number(units) / 10 ** decimals
  return value.toLocaleString('en-US', { maximumSignificantDigits: digits })
}
