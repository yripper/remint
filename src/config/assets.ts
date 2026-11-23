import { CHAINS, type Chain } from './chains'
import { USDT0, usdt0Route } from './usdt0'

export type AssetId = 'usdc' | 'usdt'

export interface AssetInfo {
  id: AssetId
  symbol: string
  name: string
  icon: string
  /** Who moves it between chains, shown on the asset menu. */
  rail: string
}

export const ASSETS: Readonly<Record<AssetId, AssetInfo>> = {
  usdc: {
    id: 'usdc',
    symbol: 'USDC',
    name: 'USD Coin',
    icon: 'https://assets.coingecko.com/coins/images/6319/standard/usdc.png',
    rail: 'Circle CCTP',
  },
  usdt: {
    id: 'usdt',
    symbol: 'USDT',
    name: 'Tether',
    icon: 'https://assets.coingecko.com/coins/images/325/standard/Tether.png',
    rail: 'USDT0 over LayerZero',
  },
}

export const ASSET_IDS: readonly AssetId[] = ['usdc', 'usdt']

export function isAssetId(value: unknown): value is AssetId {
  return value === 'usdc' || value === 'usdt'
}

/** Chains the user can send this asset from. */
export function sourceChains(asset: AssetId): Chain[] {
  if (asset === 'usdc') return CHAINS
  return CHAINS.filter((c) => USDT0[c.id]?.canSend === true)
}

/** Chains reachable from `source` in one transfer. */
export function destinationChains(asset: AssetId, source: Chain): Chain[] {
  if (asset === 'usdc') return CHAINS.filter((c) => c.id !== source.id)
  return CHAINS.filter((c) => usdt0Route(source.id, c.id) !== null)
}

export function routeSupported(asset: AssetId, sourceId: string, destId: string): boolean {
  if (sourceId === destId) return false
  if (asset === 'usdc') return CHAINS.some((c) => c.id === sourceId) && CHAINS.some((c) => c.id === destId)
  return usdt0Route(sourceId, destId) !== null
}

export interface RouteIds {
  sourceId: string
  destId: string
}

/** Where the destination goes when the current one stops working, best first. */
const DEST_PREFERENCE: Readonly<Record<AssetId, readonly string[]>> = {
  usdc: ['base', 'ethereum', 'solana', 'stellar', 'arbitrum'],
  usdt: ['solana', 'arbitrum', 'stellar', 'ethereum', 'optimism'],
}

/**
 * Keeps as much of the route as the asset allows: an unsupported source
 * falls back to Ethereum (every asset lives there), and an unreachable
 * destination falls back to the first preferred chain the source can reach.
 */
export function fitRoute(asset: AssetId, route: RouteIds): RouteIds {
  const sources = sourceChains(asset)
  const sourceId = sources.some((c) => c.id === route.sourceId) ? route.sourceId : 'ethereum'
  if (routeSupported(asset, sourceId, route.destId)) return { sourceId, destId: route.destId }
  const reachable = new Set(destinationChains(asset, CHAINS.find((c) => c.id === sourceId) as Chain).map((c) => c.id))
  const destId = DEST_PREFERENCE[asset].find((id) => reachable.has(id)) ?? [...reachable][0]
  return { sourceId, destId }
}

/** Token name on a specific chain: USDT0 is a different contract from Tether's own USDT. */
export function tokenSymbol(asset: AssetId, chainId: string): string {
  return asset === 'usdc' ? 'USDC' : (USDT0[chainId]?.symbol ?? 'USDT')
}
