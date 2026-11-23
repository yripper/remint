export type TransferPhase = 'burned' | 'attesting' | 'forwarding' | 'claimable' | 'complete' | 'failed'

/**
 * How the destination side happens: Circle relays the mint, the user claims
 * it on Stellar, or (USDT) LayerZero's executor delivers it.
 */
export type MintMode = 'forward' | 'stellar-claim' | 'oft'

export interface IrisSnapshot {
  phase: TransferPhase
  destTxHash?: string
  /** Raw message and attestation, present once attested; needed to claim on Stellar. */
  message?: string
  attestation?: string
  detail?: string
}

interface IrisMessage {
  status?: string
  message?: string
  attestation?: string
  forwardState?: string
  forwardTxHash?: string
  destinationMintTxHash?: string
}

function firstMessage(payload: unknown): IrisMessage | null {
  if (typeof payload !== 'object' || payload === null) return null
  const messages = (payload as { messages?: unknown }).messages
  if (!Array.isArray(messages) || messages.length === 0) return null
  const msg = messages[0]
  return typeof msg === 'object' && msg !== null ? (msg as IrisMessage) : null
}

/** Maps an Iris `/v2/messages` payload to where the transfer is in its journey. */
export function interpretIris(payload: unknown, mode: MintMode = 'forward'): IrisSnapshot {
  const msg = firstMessage(payload)
  if (!msg) return { phase: 'burned' }
  if (msg.status !== 'complete' || !msg.attestation || msg.attestation === 'PENDING') return { phase: 'attesting' }

  if (mode === 'stellar-claim') {
    return { phase: 'claimable', message: msg.message, attestation: msg.attestation }
  }

  const state = msg.forwardState?.toUpperCase()
  const hash = msg.destinationMintTxHash ?? msg.forwardTxHash
  if (state === 'COMPLETE' || (!state && msg.destinationMintTxHash)) return { phase: 'complete', destTxHash: hash }
  if (state === 'FAILED' || state === 'ERROR') {
    return { phase: 'failed', destTxHash: hash, detail: `Circle reported the mint as ${state}` }
  }
  return { phase: 'forwarding', destTxHash: hash }
}

export async function fetchIrisSnapshot(
  irisUrl: string,
  sourceDomain: number,
  txHash: string,
  mode: MintMode,
  signal?: AbortSignal,
): Promise<IrisSnapshot> {
  const res = await fetch(`${irisUrl}/v2/messages/${sourceDomain}?transactionHash=${encodeURIComponent(txHash)}`, { signal })
  // Iris answers 404 until it has indexed the burn.
  if (res.status === 404) return { phase: 'burned' }
  if (!res.ok) throw new Error(`Attestation lookup failed (${res.status})`)
  return interpretIris(await res.json(), mode)
}
