import { useCallback, useEffect, useRef, useState } from 'react'
import type { AssetId } from '../config/assets'
import { CHAINS, type Chain } from '../config/chains'
import { NETWORK } from '../config/networks'
import { fetchIrisSnapshot, type IrisSnapshot, type MintMode, type TransferPhase } from '../lib/iris'
import { fetchLzSnapshot } from '../lib/lzscan'

export type TransferStage = 'approving' | 'burning' | 'claiming' | TransferPhase

export interface Transfer {
  id: string
  /** Missing on transfers saved before USDT existed; those are USDC. */
  asset?: AssetId
  sourceChainId: string
  destChainId: string
  recipient: string
  /** 6-decimal units for both assets, stored as strings so they survive JSON. */
  amount: string
  receive: string
  createdAt: number
  stage: TransferStage
  mode: MintMode
  fast: boolean
  burnTxHash?: string
  destTxHash?: string
  /** Stellar claims: Circle's message and attestation, kept so a claim survives a reload. */
  message?: string
  attestation?: string
  error?: string
}

const STORAGE_KEY = 'cctp.transfers.v2'
const LEGACY_KEY = 'cctp.transfers.v1'
const POLL_MS = 5_000
const MAX_STORED = 20

interface LegacyTransfer {
  id: string
  chainId: string
  recipient: string
  amount: string
  receive: string
  createdAt: number
  stage: TransferStage
  burnTxHash?: string
  forwardTxHash?: string
  error?: string
  network?: string
}

/** The Stellar-only build stored 7-decimal amounts and only ever burned on Stellar. */
function fromLegacy(t: LegacyTransfer): Transfer {
  return {
    id: t.id,
    sourceChainId: 'stellar',
    destChainId: t.chainId,
    recipient: t.recipient,
    amount: (BigInt(t.amount) / 10n).toString(),
    receive: (BigInt(t.receive) / 10n).toString(),
    createdAt: t.createdAt,
    stage: t.stage,
    mode: 'forward',
    fast: false,
    burnTxHash: t.burnTxHash,
    destTxHash: t.forwardTxHash,
    error: t.error,
  }
}

function readJsonArray(key: string): unknown[] {
  try {
    const raw = window.localStorage.getItem(key)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const KNOWN_CHAINS = new Set(CHAINS.map((c) => c.id))

function loadTransfers(): Transfer[] {
  const current = readJsonArray(STORAGE_KEY) as Transfer[]
  const legacy = (readJsonArray(LEGACY_KEY) as LegacyTransfer[])
    .filter((t) => t.network !== 'testnet' && !current.some((c) => c.id === t.id))
    .map(fromLegacy)
  return [...current, ...legacy]
    .filter((t) => KNOWN_CHAINS.has(t.sourceChainId) && KNOWN_CHAINS.has(t.destChainId))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_STORED)
}

function saveTransfers(transfers: Transfer[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(transfers.slice(0, MAX_STORED)))
    window.localStorage.removeItem(LEGACY_KEY)
  } catch {
    // Private mode or full storage: history is a convenience, the transfer itself is on-chain.
  }
}

/** A wallet prompt can't survive a reload, so put interrupted steps back where they can resume. */
function recoverStage(t: Transfer): Transfer {
  if (t.stage === 'approving' || (t.stage === 'burning' && !t.burnTxHash)) {
    return { ...t, stage: 'failed', error: 'Interrupted before the burn was submitted' }
  }
  if (t.stage === 'claiming') return { ...t, stage: 'claimable' }
  return t
}

const POLLABLE: ReadonlySet<TransferStage> = new Set(['burned', 'attesting', 'forwarding'])

export function transferAsset(t: Transfer): AssetId {
  return t.asset ?? 'usdc'
}

/** USDT transfers are tracked on LayerZero Scan; USDC on Circle's Iris. */
function fetchSnapshot(t: Transfer, source: Chain, txHash: string): Promise<IrisSnapshot> {
  if (t.mode === 'oft') return fetchLzSnapshot(txHash)
  return fetchIrisSnapshot(NETWORK.irisUrl, source.domain, txHash, t.mode)
}

export function isInFlight(stage: TransferStage): boolean {
  return stage !== 'complete' && stage !== 'failed'
}

export interface TransfersStore {
  transfers: Transfer[]
  add: (transfer: Transfer) => void
  update: (id: string, patch: Partial<Transfer>) => void
  remove: (id: string) => void
}

export function useTransfers(): TransfersStore {
  const [transfers, setTransfers] = useState<Transfer[]>(() => loadTransfers().map(recoverStage))
  const latest = useRef(transfers)

  useEffect(() => {
    latest.current = transfers
    saveTransfers(transfers)
  }, [transfers])

  const update = useCallback((id: string, patch: Partial<Transfer>) => {
    setTransfers((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  }, [])

  const add = useCallback((transfer: Transfer) => {
    setTransfers((prev) => [transfer, ...prev].slice(0, MAX_STORED))
  }, [])

  const remove = useCallback((id: string) => {
    setTransfers((prev) => prev.filter((t) => t.id !== id))
  }, [])

  // One poll loop for every burned-but-unfinished transfer.
  useEffect(() => {
    let stopped = false
    const poll = async () => {
      const pending = latest.current.filter((t) => t.burnTxHash && POLLABLE.has(t.stage))
      await Promise.all(
        pending.map(async (t) => {
          const source = CHAINS.find((c) => c.id === t.sourceChainId)
          if (!source || !t.burnTxHash) return
          try {
            const snap = await fetchSnapshot(t, source, t.burnTxHash)
            if (stopped) return
            if (snap.phase !== t.stage || snap.detail !== t.error || (snap.destTxHash && snap.destTxHash !== t.destTxHash)) {
              update(t.id, {
                stage: snap.phase,
                destTxHash: snap.destTxHash ?? t.destTxHash,
                message: snap.message ?? t.message,
                attestation: snap.attestation ?? t.attestation,
                error: snap.detail,
              })
            }
          } catch {
            // Transient API errors: keep polling.
          }
        }),
      )
    }
    void poll()
    const id = window.setInterval(() => void poll(), POLL_MS)
    return () => {
      stopped = true
      window.clearInterval(id)
    }
  }, [update])

  return { transfers, add, update, remove }
}
