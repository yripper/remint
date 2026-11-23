import type { Chain } from '../config/chains'
import { FAST_FINALITY, STANDARD_FINALITY, type StellarNetworkConfig } from '../config/networks'
import { buildForwardHook, buildSolanaAtaForwardHook, buildStellarForwarderHook } from './hooks'
import type { MintMode } from './iris'
import { evmAddressToBytes32, solanaAddressToBytes32, stellarContractToBytes32 } from './recipient'

/** Everything the source-chain burn needs, independent of which chain burns. */
export interface BurnPlan {
  mode: MintMode
  finality: number
  mintRecipient: Uint8Array
  destinationCaller: Uint8Array
  hookData: Uint8Array
}

export interface PlanInput {
  source: Chain
  destination: Chain
  recipient: string
  fast: boolean
  /** Solana destinations only: the recipient's USDC token account and whether it exists. */
  solanaAta?: string
  solanaAtaExists?: boolean
}

const ZERO_BYTES32 = new Uint8Array(32)

/** Fast Transfer only where Circle offers it for the source; everywhere else standard is already quick. */
export function finalityFor(source: Chain, fast: boolean): number {
  return fast && source.fastSource ? FAST_FINALITY : STANDARD_FINALITY
}

/**
 * Picks recipient, caller and hook for a route.
 *
 * - EVM and Solana destinations use Circle's Forwarding Service: caller stays
 *   zero so Circle can submit the mint.
 * - Stellar can't be forwarded to. The mint goes to the CctpForwarder, which is
 *   both mintRecipient and destinationCaller, and the hook names the real
 *   recipient. A wrong recipient or caller here makes funds unrecoverable.
 */
export function planBurn(network: StellarNetworkConfig, input: PlanInput): BurnPlan {
  const { source, destination, fast } = input
  const recipient = input.recipient.trim()
  if (source.id === destination.id) throw new Error('Pick two different chains')
  const finality = finalityFor(source, fast)

  if (destination.kind === 'stellar') {
    const forwarder = stellarContractToBytes32(network.cctpForwarder)
    return {
      mode: 'stellar-claim',
      finality,
      mintRecipient: forwarder,
      destinationCaller: forwarder,
      hookData: buildStellarForwarderHook(recipient),
    }
  }

  if (destination.kind === 'solana') {
    if (!input.solanaAta) throw new Error('Missing the Solana USDC account')
    return {
      mode: 'forward',
      finality,
      mintRecipient: solanaAddressToBytes32(input.solanaAta),
      destinationCaller: ZERO_BYTES32,
      hookData: input.solanaAtaExists ? buildForwardHook() : buildSolanaAtaForwardHook(solanaAddressToBytes32(recipient)),
    }
  }

  return {
    mode: 'forward',
    finality,
    mintRecipient: evmAddressToBytes32(recipient),
    destinationCaller: ZERO_BYTES32,
    hookData: buildForwardHook(),
  }
}
