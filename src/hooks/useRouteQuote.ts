import { useEffect, useState } from 'react'
import type { Chain } from '../config/chains'
import { loadRouteInfo, type RouteInfo } from '../lib/quote'
import { isValidRecipient } from '../lib/recipient'

export interface RouteQuoteState {
  data: RouteInfo | null
  loading: boolean
  error: string | null
}

interface Result {
  key: string
  /** Same route, ignoring the refresh tick: lets a refresh keep showing the last quote. */
  routeKey: string
  data: RouteInfo | null
  error: string | null
}

const REFRESH_MS = 30_000

export function useRouteQuote(source: Chain, destination: Chain, recipient: string, enabled: boolean = true): RouteQuoteState {
  const [tick, setTick] = useState(0)
  const [result, setResult] = useState<Result | null>(null)

  // Forwarding fees track destination gas, so keep the quote fresh while the form is open.
  useEffect(() => {
    if (!enabled) return
    const id = window.setInterval(() => setTick((t) => t + 1), REFRESH_MS)
    return () => window.clearInterval(id)
  }, [enabled])

  // The recipient only changes the quote where it decides extra setup (Solana ATA, Stellar trustline).
  const trimmed = recipient.trim()
  const recipientMatters = destination.kind !== 'evm' && isValidRecipient(destination.kind, trimmed)
  const routeKey = !enabled || source.id === destination.id ? null : `${source.id}|${destination.id}|${recipientMatters ? trimmed : ''}`
  const key = routeKey ? `${routeKey}|${tick}` : null

  useEffect(() => {
    if (!key || !routeKey) return
    const controller = new AbortController()
    loadRouteInfo(source, destination, recipientMatters ? trimmed : '', controller.signal)
      .then((data) => setResult({ key, routeKey, data, error: null }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setResult({ key, routeKey, data: null, error: err instanceof Error ? err.message : 'Could not get a fee quote' })
      })
    return () => controller.abort()
  }, [source, destination, trimmed, recipientMatters, key, routeKey])

  if (!key) return { data: null, loading: false, error: null }
  const sameRoute = result?.routeKey === routeKey
  return {
    data: sameRoute ? (result?.data ?? null) : null,
    loading: result?.key !== key,
    error: sameRoute ? (result?.error ?? null) : null,
  }
}
