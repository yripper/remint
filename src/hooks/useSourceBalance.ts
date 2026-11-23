import { useCallback, useEffect, useState } from 'react'
import type { AssetId } from '../config/assets'
import type { Chain } from '../config/chains'
import { NETWORK } from '../config/networks'
import { USDT0 } from '../config/usdt0'
import { fromStellarUnits } from '../lib/amount'
import { getEvmTokenBalance, getEvmUsdcBalance } from '../lib/evm'
import { getSolanaUsdcBalance } from '../lib/solana'
import { getSacBalance, getUsdcBalance } from '../lib/stellar'

export interface SourceBalance {
  /** 6-decimal units: what can actually be sent. */
  units: bigint
  /** Stellar only: false when the account has no trustline for the asset. */
  hasTrustline: boolean
}

export interface SourceBalanceState {
  balance: SourceBalance | null
  loading: boolean
  error: string | null
  refresh: () => void
}

async function readUsdtBalance(chain: Chain, owner: string): Promise<SourceBalance> {
  const deployment = USDT0[chain.id]
  if (!deployment || chain.kind === 'solana') throw new Error(`Sending USDT from ${chain.name} isn't supported`)
  if (chain.kind === 'stellar') {
    const { units, hasTrustline } = await getSacBalance(NETWORK, deployment.token, owner)
    return { units: fromStellarUnits(units), hasTrustline }
  }
  return { units: await getEvmTokenBalance(chain, deployment.token, owner), hasTrustline: true }
}

async function readBalance(asset: AssetId, chain: Chain, owner: string): Promise<SourceBalance> {
  if (asset === 'usdt') return readUsdtBalance(chain, owner)
  if (chain.kind === 'stellar') {
    const { units, hasTrustline } = await getUsdcBalance(NETWORK, owner)
    return { units: fromStellarUnits(units), hasTrustline }
  }
  if (chain.kind === 'solana') {
    return { units: await getSolanaUsdcBalance(NETWORK.solanaRpcUrl, owner, NETWORK.solanaUsdcMint), hasTrustline: true }
  }
  return { units: await getEvmUsdcBalance(chain, owner), hasTrustline: true }
}

interface Result {
  key: string
  balance: SourceBalance | null
  error: string | null
}

export function useSourceBalance(asset: AssetId, chain: Chain, owner: string | null): SourceBalanceState {
  const [tick, setTick] = useState(0)
  const [result, setResult] = useState<Result | null>(null)
  const account = owner ? `${asset}|${chain.id}|${owner}` : null
  const key = account ? `${account}|${tick}` : null

  useEffect(() => {
    if (!owner || !key) return
    let cancelled = false
    readBalance(asset, chain, owner)
      .then((balance) => {
        if (!cancelled) setResult({ key, balance, error: null })
      })
      .catch((err: unknown) => {
        if (!cancelled) setResult({ key, balance: null, error: err instanceof Error ? err.message : 'Could not read balance' })
      })
    return () => {
      cancelled = true
    }
  }, [asset, chain, owner, key])

  const refresh = useCallback(() => setTick((t) => t + 1), [])

  if (!key) return { balance: null, loading: false, error: null, refresh }
  // Keep showing the previous balance for the same account while a refresh is in flight.
  const sameAccount = result?.key.startsWith(`${account}|`) ?? false
  return {
    balance: sameAccount ? (result?.balance ?? null) : null,
    loading: result?.key !== key,
    error: result?.key === key ? result.error : null,
    refresh,
  }
}
