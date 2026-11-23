/**
 * Soroban failures surface as "Error(Contract, #N)". Codes come from the
 * contract specs: USDC SAC (9, 10, 13), TokenMessengerMinter (71xx),
 * CctpForwarder (73xx) and MessageTransmitter (69xx).
 */
const CONTRACT_ERRORS: Record<number, string> = {
  9: 'The USDC allowance is too low. Approve again and retry.',
  10: 'Not enough USDC in this account.',
  13: 'This account has no USDC trustline. Add one in your wallet first.',
  6908: 'This transfer was already claimed on Stellar.',
  7102: 'Enter an amount above zero.',
  7104: 'The amount must be larger than the fees.',
  7105: 'The fee went up while you were signing. Try again for a fresh quote.',
  7106: 'CCTP does not support this destination right now.',
  7113: 'The amount must be larger than the fees.',
  7114: 'The fee went up while you were signing. Try again for a fresh quote.',
  7118: 'The amount is too small to bridge.',
  7302: 'The Stellar recipient in this transfer is not valid.',
  7307: 'The Stellar recipient can’t receive USDC yet. Add a USDC trustline to it, then claim again.',
  7314: 'Nothing was minted for this message.',
}

/** Already-claimed: the message nonce was used, so the funds were delivered. */
export const NONCE_ALREADY_USED = 6908

const CONTRACT_ERROR = /Error\(Contract, #(\d+)\)/

export function contractErrorCode(message: string): number | null {
  const match = CONTRACT_ERROR.exec(message)
  return match ? Number(match[1]) : null
}

export function isMissingTrustline(message: string): boolean {
  return contractErrorCode(message) === 13 || /trustline/i.test(message)
}

function rawMessage(err: unknown): string {
  if (err instanceof Error) {
    // viem puts the readable part in shortMessage and a long dump in message.
    const short = (err as Error & { shortMessage?: unknown }).shortMessage
    return typeof short === 'string' ? `${short}\n${err.message}` : err.message
  }
  return String(err)
}

/** Turns wallet, EVM, Solana and Soroban errors into a sentence the user can act on. */
export function describeError(err: unknown): string {
  const message = rawMessage(err)
  if ((err as { code?: unknown } | null)?.code === 4001) return 'You declined the request in your wallet.'
  if (/reject|denied|cancel|declined|closed/i.test(message)) return 'You declined the request in your wallet.'
  const code = contractErrorCode(message)
  if (code !== null && CONTRACT_ERRORS[code]) return CONTRACT_ERRORS[code]
  if (/account not found/i.test(message)) return 'This Stellar account is not funded yet. Send it some XLM first.'
  if (/insufficient funds for (gas|intrinsic)/i.test(message)) return 'Not enough native token in your wallet to pay the network fee.'
  if (/insufficient lamports|no record of a prior credit/i.test(message)) return 'Not enough SOL in your wallet to pay the network fee.'
  if (/transfer amount exceeds balance/i.test(message)) return 'Not enough USDC in this wallet.'
  return message.split('\n')[0]
}
