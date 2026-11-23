import { useEffect, useState } from 'react'
import type { Chain } from '../config/chains'
import { loadUsdtRouteInfo, type UsdtRouteInfo } from '../lib/quote'
import { isValidRecipientFor } from '../lib/recipient'

export interface UsdtQuoteState {
  data: UsdtRouteInfo | null
  loading: boolean
  error: string | null
}

interface Result {
  key: string
  routeKey: string
  data: UsdtRouteInfo | null
  error: string | null
}

const REFRESH_MS = 30_000
const DEBOUNCE_MS = 400

interface UsdtQuoteArgs {
  enabled: boolean
  source: Chain
  destination: Chain
  recipient: string
  amount: bigint | null
  /** Connected source address; Stellar quotes simulate from it when present. */
  owner: string | null
}

/** On-chain quoteOFT + quoteSend, refreshed while the form is open; the messaging fee tracks gas. */
export function useUsdtQuote({ enabled, source, destination, recipient, amount, owner }: UsdtQuoteArgs): UsdtQuoteState {
  const [tick, setTick] = useState(0)
  const [result, setResult] = useState<Result | null>(null)
  const [debouncedAmount, setDebouncedAmount] = useState(amount)

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedAmount(amount), DEBOUNCE_MS)
    return () => window.clearTimeout(id)
  }, [amount])

  useEffect(() => {
    if (!enabled) return
    const id = window.setInterval(() => setTick((t) => t + 1), REFRESH_MS)
    return () => window.clearInterval(id)
  }, [enabled])

  // Only a Stellar recipient changes the answer (its trustline); elsewhere it would just refetch.
  const trimmed = recipient.trim()
  const recipientMatters = destination.kind === 'stellar' && isValidRecipientFor('usdt', 'stellar', trimmed)
  const routeKey = enabled && source.id !== destination.id ? `${source.id}|${destination.id}|${recipientMatters ? trimmed : ''}` : null
  const key = routeKey ? `${routeKey}|${debouncedAmount ?? ''}|${owner ?? ''}|${tick}` : null

  useEffect(() => {
    if (!key || !routeKey) return
    let cancelled = false
    loadUsdtRouteInfo(source, destination, recipientMatters ? trimmed : '', debouncedAmount, owner)
      .then((data) => {
        if (!cancelled) setResult({ key, routeKey, data, error: null })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setResult({ key, routeKey, data: null, error: err instanceof Error ? err.message : 'Could not quote this route' })
      })
    return () => {
      cancelled = true
    }
  }, [source, destination, trimmed, recipientMatters, debouncedAmount, owner, key, routeKey])

  if (!key) return { data: null, loading: false, error: null }
  const sameRoute = result?.routeKey === routeKey
  return {
    data: sameRoute ? (result?.data ?? null) : null,
    loading: result?.key !== key,
    error: sameRoute ? (result?.error ?? null) : null,
  }
}
