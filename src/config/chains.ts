import {
  Arbitrum,
  Avalanche,
  Base,
  Ethereum,
  HyperEVM,
  Ink,
  Linea,
  Monad,
  Optimism,
  Polygon,
  Sei,
  Solana,
  Sonic,
  Unichain,
  WorldChain,
} from '@circle-fin/bridge-kit/chains'

export type ChainKind = 'stellar' | 'evm' | 'solana'

/** The slice of a Bridge Kit chain definition this app reads for EVM sources. */
export interface EvmChainInfo {
  chainId: number
  usdc: `0x${string}`
  tokenMessenger: `0x${string}`
  rpcUrl: string
  nativeCurrency: { name: string; symbol: string; decimals: number }
}

export interface Chain {
  id: string
  name: string
  domain: number
  kind: ChainKind
  icon: string
  /** Transaction explorer base; null when we don't know a reliable one. */
  txExplorer: string | null
  /** CCTP Fast Transfer exists as a source (Circle's table); otherwise standard is already fast. */
  fastSource: boolean
  evm?: EvmChainInfo
}

const icon = (slug: string): string => `https://icons.llamao.fi/icons/chains/rsz_${slug}.jpg`

interface BridgeKitEvmDef {
  chainId: number
  usdcAddress: string | null
  rpcEndpoints: readonly string[]
  nativeCurrency: { name: string; symbol: string; decimals: number }
  cctp: { domain: number; contracts: { v2?: { tokenMessenger?: string } } } | null
}

// Contract and token addresses come from Circle's Bridge Kit chain definitions
// rather than being typed in by hand.
function evmInfo(def: BridgeKitEvmDef): EvmChainInfo {
  const tokenMessenger = def.cctp?.contracts.v2?.tokenMessenger
  if (!def.usdcAddress || !tokenMessenger) throw new Error(`Missing CCTP v2 config for chain ${def.chainId}`)
  return {
    chainId: def.chainId,
    usdc: def.usdcAddress as `0x${string}`,
    tokenMessenger: tokenMessenger as `0x${string}`,
    rpcUrl: def.rpcEndpoints[0],
    nativeCurrency: def.nativeCurrency,
  }
}

function evmChain(id: string, name: string, slug: string, def: BridgeKitEvmDef, explorer: string | null, fastSource: boolean): Chain {
  if (!def.cctp) throw new Error(`${name} has no CCTP config`)
  return { id, name, domain: def.cctp.domain, kind: 'evm', icon: icon(slug), txExplorer: explorer, fastSource, evm: evmInfo(def) }
}

export const STELLAR: Chain = {
  id: 'stellar', name: 'Stellar', domain: 27, kind: 'stellar', icon: icon('stellar'),
  txExplorer: 'https://stellar.expert/explorer/public/tx/', fastSource: false,
}

export const SOLANA: Chain = {
  id: 'solana', name: 'Solana', domain: Solana.cctp.domain, kind: 'solana', icon: icon('solana'),
  txExplorer: 'https://solscan.io/tx/', fastSource: true,
}

export const CHAINS: Chain[] = [
  STELLAR,
  evmChain('base', 'Base', 'base', Base, 'https://basescan.org/tx/', true),
  evmChain('ethereum', 'Ethereum', 'ethereum', Ethereum, 'https://etherscan.io/tx/', true),
  SOLANA,
  evmChain('arbitrum', 'Arbitrum', 'arbitrum', Arbitrum, 'https://arbiscan.io/tx/', true),
  evmChain('optimism', 'OP Mainnet', 'optimism', Optimism, 'https://optimistic.etherscan.io/tx/', true),
  evmChain('avalanche', 'Avalanche', 'avalanche', Avalanche, 'https://snowtrace.io/tx/', false),
  evmChain('polygon', 'Polygon PoS', 'polygon', Polygon, 'https://polygonscan.com/tx/', false),
  evmChain('unichain', 'Unichain', 'unichain', Unichain, 'https://uniscan.xyz/tx/', true),
  evmChain('linea', 'Linea', 'linea', Linea, 'https://lineascan.build/tx/', true),
  evmChain('worldchain', 'World Chain', 'world-chain', WorldChain, 'https://worldscan.org/tx/', true),
  evmChain('sonic', 'Sonic', 'sonic', Sonic, 'https://sonicscan.org/tx/', false),
  evmChain('ink', 'Ink', 'ink', Ink, 'https://explorer.inkonchain.com/tx/', true),
  evmChain('monad', 'Monad', 'monad', Monad, null, false),
  evmChain('sei', 'Sei', 'sei', Sei, 'https://seitrace.com/tx/', false),
  evmChain('hyperevm', 'HyperEVM', 'hyperliquid', HyperEVM, null, false),
]

export const USDC_ICON = 'https://assets.coingecko.com/coins/images/6319/standard/usdc.png'

export function chainById(id: string): Chain {
  const chain = CHAINS.find((c) => c.id === id)
  if (!chain) throw new Error(`Unknown chain ${id}`)
  return chain
}

export function txUrl(chain: Chain, hash: string): string | null {
  return chain.txExplorer ? `${chain.txExplorer}${hash}` : null
}

/** Circle relays the mint everywhere except Stellar, where the user claims it. */
export function forwardingAvailable(destination: Chain): boolean {
  return destination.kind !== 'stellar'
}

export const KIND_LABEL: Record<ChainKind, string> = {
  stellar: 'Stellar',
  evm: 'EVM',
  solana: 'Solana',
}
