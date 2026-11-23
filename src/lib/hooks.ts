/**
 * CCTP hook data. Both formats share a 32-byte header:
 * bytes 0-23 magic, 24-27 version (u32 BE), 28-31 payload length (u32 BE), then the payload.
 */
const HEADER_BYTES = 32

function header(magic: string, payloadLength: number): Uint8Array {
  const out = new Uint8Array(HEADER_BYTES)
  out.set(new TextEncoder().encode(magic), 0)
  const view = new DataView(out.buffer)
  view.setUint32(24, 0, false) // hook version 0
  view.setUint32(28, payloadLength, false)
  return out
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

/**
 * Circle Forwarding Service hook ("cctp-forward"): Circle submits the destination mint.
 * See developers.circle.com/cctp/concepts/forwarding-service#hook-format
 */
export function buildForwardHook(): Uint8Array {
  return header('cctp-forward', 0)
}

/**
 * Forwarding hook that also asks Circle to create the recipient's USDC ATA on Solana.
 * Payload: 1 byte flag (1) + 32-byte owner public key.
 */
export function buildSolanaAtaForwardHook(ownerPublicKey: Uint8Array): Uint8Array {
  if (ownerPublicKey.length !== 32) throw new Error('Solana owner public key must be 32 bytes')
  const payload = new Uint8Array(33)
  payload[0] = 1
  payload.set(ownerPublicKey, 1)
  return concat(header('cctp-forward', payload.length), payload)
}

/**
 * Stellar CctpForwarder hook: magic is 24 zero bytes and the payload is the
 * recipient strkey (G…, M… or C…) as UTF-8.
 * See developers.circle.com/cctp/references/stellar#hook-format
 */
export function buildStellarForwarderHook(recipientStrkey: string): Uint8Array {
  const recipient = new TextEncoder().encode(recipientStrkey)
  return concat(header('', recipient.length), recipient)
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, '')
  if (clean.length % 2 !== 0 || /[^0-9a-f]/i.test(clean)) throw new Error('Invalid hex string')
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return out
}
