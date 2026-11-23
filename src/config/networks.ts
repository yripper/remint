import { Networks } from '@stellar/stellar-sdk'

export interface StellarNetworkConfig {
  passphrase: string
  rpcUrl: string
  /** Circle attestation + fee API (Iris). */
  irisUrl: string
  explorerUrl: string
  /** USDC Stellar Asset Contract. */
  usdcSac: string
  tokenMessengerMinter: string
  /** Receives CCTP mints into Stellar and forwards them to the recipient in hook data. */
  cctpForwarder: string
  solanaRpcUrl: string
  solanaUsdcMint: string
}

// Mainnet only. Addresses from developers.circle.com/cctp/references/stellar-contracts
// and developers.stellar.org/docs/tokens/cross-chain-transfers (USDC SAC table).
export const NETWORK: StellarNetworkConfig = {
  passphrase: Networks.PUBLIC,
  // A browser app ships its RPC URL to every visitor, so this key is public by design.
  rpcUrl: import.meta.env.VITE_STELLAR_RPC ?? 'https://mainnet.stellar.validationcloud.io/v1/7_wSqIiprDq9JKolRe5hiyGoOAu4Ap-9twh6uES6bJQ',
  irisUrl: 'https://iris-api.circle.com',
  explorerUrl: 'https://stellar.expert/explorer/public',
  usdcSac: 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75',
  tokenMessengerMinter: 'CAE2G5Z77UP7GYPYGFOWFGW7C7J6I4YP2AFGSADRKQY62SYUFLPNFTXL',
  cctpForwarder: 'CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T',
  solanaRpcUrl: import.meta.env.VITE_SOLANA_RPC ?? 'https://solana-rpc.publicnode.com',
  solanaUsdcMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
}

/** Finality thresholds: 1000 = Fast Transfer, 2000 = standard (finalized). */
export const FAST_FINALITY = 1000
export const STANDARD_FINALITY = 2000
