import type { TransferPhase } from './iris'

/** LayerZero Scan, public and CORS-open: GET /messages/tx/{hash} with no API key. */
export const LZ_SCAN_API = 'https://scan.layerzero-api.com/v1'

export function lzScanUrl(txHash: string): string {
  return `https://layerzeroscan.com/tx/${txHash}`
}

export interface LzSnapshot {
  phase: TransferPhase
  destTxHash?: string
  detail?: string
}

interface ScanMessage {
  status?: { name?: string; message?: string }
  source?: { status?: string }
  destination?: { status?: string; tx?: { txHash?: string } }
}

function firstMessage(payload: unknown): ScanMessage | null {
  if (typeof payload !== 'object' || payload === null) return null
  const data = (payload as { data?: unknown }).data
  if (!Array.isArray(data) || data.length === 0) return null
  const msg: unknown = data[0]
  return typeof msg === 'object' && msg !== null ? (msg as ScanMessage) : null
}

const STOPPED = new Set(['FAILED', 'BLOCKED', 'APPLICATION_BURNED', 'APPLICATION_SKIPPED'])

/**
 * Maps a Scan message to the same phases the CCTP tracker uses:
 * burned (not indexed yet) → attesting (source finality + DVNs) →
 * forwarding (executor delivering) → complete.
 */
export function interpretLzScan(payload: unknown): LzSnapshot {
  const msg = firstMessage(payload)
  if (!msg) return { phase: 'burned' }
  const status = msg.status?.name?.toUpperCase()
  const destTxHash = msg.destination?.tx?.txHash || undefined

  if (status === 'DELIVERED') return { phase: 'complete', destTxHash }
  if (status && STOPPED.has(status)) {
    return { phase: 'failed', destTxHash, detail: msg.status?.message || `LayerZero reported the message as ${status}` }
  }
  if (status === 'PAYLOAD_STORED') {
    // Not lost: the payload waits on the destination for a retry. Keep polling, but say why it's slow.
    return { phase: 'forwarding', destTxHash, detail: 'Delivery is waiting on the destination chain. LayerZero Scan shows why.' }
  }
  // INFLIGHT / CONFIRMING: verification starts once the source tx is final.
  const sourceFinal = msg.source?.status?.toUpperCase() === 'SUCCEEDED'
  return { phase: sourceFinal || status === 'CONFIRMING' ? 'forwarding' : 'attesting', destTxHash }
}

export async function fetchLzSnapshot(txHash: string, signal?: AbortSignal): Promise<LzSnapshot> {
  const res = await fetch(`${LZ_SCAN_API}/messages/tx/${encodeURIComponent(txHash)}`, { signal })
  // Scan answers 404 until it has indexed the source transaction.
  if (res.status === 404) return { phase: 'burned' }
  if (!res.ok) throw new Error(`LayerZero Scan responded ${res.status}`)
  return interpretLzScan(await res.json())
}
