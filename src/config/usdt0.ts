/**
 * USDT0 deployments the app routes through, keyed by our chain id.
 * Source: docs.usdt0.to/technical-documentation/deployments (API at
 * docs.usdt0.to/api/deployments). Each EVM entry was checked on-chain:
 * the OFT's token() matches, decimals are 6, and peers(30600) is set.
 */
export interface Usdt0Deployment {
  /** LayerZero endpoint id. */
  eid: number
  /** EVM token, Stellar SAC or Solana mint. */
  token: string
  /** USDT0 OFT (Ethereum: the OFT Adapter that locks USDT). Absent on Legacy Mesh-only chains. */
  oft?: string
  /** Legacy Mesh pool, the only direct way to reach native USDT chains such as Solana. */
  legacyOft?: string
  /** The token users see: Tether's own USDT on Ethereum and Solana, USDT0 elsewhere. */
  symbol: 'USDT' | 'USDT0'
  /** Whether this app can send from here. Solana sends need LayerZero's Solana SDK, not wired in yet. */
  canSend: boolean
}

export const USDT0: Readonly<Record<string, Usdt0Deployment>> = {
  ethereum: {
    eid: 30101,
    token: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    oft: '0x6C96dE32CEa08842dcc4058c14d3aaAD7Fa41dee',
    legacyOft: '0x1F748c76dE468e9D11bd340fA9D5CBADf315dFB0',
    symbol: 'USDT',
    canSend: true,
  },
  arbitrum: {
    eid: 30110,
    token: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    oft: '0x14E4A1B13bf7F943c8ff7C51fb60FA964A298D92',
    legacyOft: '0x77652D5aba086137b595875263FC200182919B92',
    symbol: 'USDT0',
    canSend: true,
  },
  optimism: { eid: 30111, token: '0x01bFF41798a0BcF287b996046Ca68b395DbC1071', oft: '0xF03b4d9AC1D5d1E7c4cEf54C2A313b9fe051A0aD', symbol: 'USDT0', canSend: true },
  polygon: { eid: 30109, token: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', oft: '0x6BA10300f0DC58B7a1e4c0e41f5daBb7D7829e13', symbol: 'USDT0', canSend: true },
  unichain: { eid: 30320, token: '0x9151434b16b9763660705744891fA906F660EcC5', oft: '0xc07bE8994D035631c36fb4a89C918CeFB2f03EC3', symbol: 'USDT0', canSend: true },
  ink: { eid: 30339, token: '0x0200C29006150606B650577BBE7B6248F58470c1', oft: '0x1cB6De532588fCA4a21B7209DE7C456AF8434A65', symbol: 'USDT0', canSend: true },
  monad: { eid: 30390, token: '0xe7cd86e13AC4309349F30B3435a9d337750fC82D', oft: '0x9151434b16b9763660705744891fA906F660EcC5', symbol: 'USDT0', canSend: true },
  sei: { eid: 30280, token: '0x9151434b16b9763660705744891fA906F660EcC5', oft: '0x56Fe74A2e3b484b921c447357203431a3485CC60', symbol: 'USDT0', canSend: true },
  hyperevm: { eid: 30367, token: '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb', oft: '0x904861a24F30EC96ea7CFC3bE9EA4B476d237e98', symbol: 'USDT0', canSend: true },
  stellar: {
    eid: 30600,
    token: 'CBSJZEIO5C7KC2SF3MKSNXXJSW5G3VTNBX4ATMKUI3B2MR4JKM4R26YF',
    oft: 'CBOWOLFSDM5PZXNFIVDMP5NZ7U2GSIHED6H6R446QOHF266XINKUMMF6',
    symbol: 'USDT0',
    canSend: true,
  },
  solana: {
    eid: 30168,
    token: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    symbol: 'USDT',
    canSend: false,
  },
}

/** Classic asset behind the Stellar SAC; recipients need a trustline to it. */
export const STELLAR_USDT0_ASSET = 'USDT0:GATISXX6BZ6NC7IKQBY37CJD4SOZL3CYZJWXEDG6JVIY4WBS6KXJHN6Q'

export type Usdt0RouteKind = 'oft' | 'legacy'

export interface Usdt0Route {
  kind: Usdt0RouteKind
  /** Contract the user calls on the source chain. */
  contract: string
  dstEid: number
}

/**
 * The direct path between two chains, or null when there is none.
 * OFT chains reach each other through their OFTs. Native USDT chains
 * (Solana) are only reachable through a Legacy Mesh pool, which only
 * Ethereum and Arbitrum have. Everything else would need a two-hop
 * compose through Arbitrum, which this app doesn't do.
 */
export function usdt0Route(sourceId: string, destId: string): Usdt0Route | null {
  const src = USDT0[sourceId]
  const dst = USDT0[destId]
  if (!src || !dst || sourceId === destId || !src.canSend) return null
  if (src.oft && dst.oft) return { kind: 'oft', contract: src.oft, dstEid: dst.eid }
  if (!dst.oft && src.legacyOft) return { kind: 'legacy', contract: src.legacyOft, dstEid: dst.eid }
  return null
}
