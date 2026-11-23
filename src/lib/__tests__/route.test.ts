import { StrKey } from '@stellar/stellar-sdk'
import { describe, expect, it } from 'vitest'
import { chainById } from '../../config/chains'
import { NETWORK } from '../../config/networks'
import { buildForwardHook, toHex } from '../hooks'
import { evmAddressToBytes32, solanaAddressToBytes32 } from '../recipient'
import { finalityFor, planBurn } from '../route'

const EVM = '0x1234567890abcdef1234567890abcdef12345678'
const SOL_OWNER = 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr'
const SOL_ATA = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'
const G = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
const ZERO = toHex(new Uint8Array(32))

const base = chainById('base')
const solana = chainById('solana')
const stellar = chainById('stellar')
const avalanche = chainById('avalanche')

describe('finalityFor', () => {
  it('uses Fast Transfer only where the source offers it', () => {
    expect(finalityFor(base, true)).toBe(1000)
    expect(finalityFor(base, false)).toBe(2000)
    expect(finalityFor(avalanche, true)).toBe(2000)
    expect(finalityFor(stellar, true)).toBe(2000)
  })
})

describe('planBurn', () => {
  it('forwards to EVM with a zero caller and the static hook', () => {
    const plan = planBurn(NETWORK, { source: solana, destination: base, recipient: EVM, fast: false })
    expect(plan.mode).toBe('forward')
    expect(toHex(plan.mintRecipient)).toBe(toHex(evmAddressToBytes32(EVM)))
    expect(toHex(plan.destinationCaller)).toBe(ZERO)
    expect(toHex(plan.hookData)).toBe(toHex(buildForwardHook()))
  })

  it('mints to the Solana token account, asking Circle to create it when missing', () => {
    const missing = planBurn(NETWORK, { source: base, destination: solana, recipient: SOL_OWNER, fast: true, solanaAta: SOL_ATA, solanaAtaExists: false })
    expect(missing.finality).toBe(1000)
    expect(toHex(missing.mintRecipient)).toBe(toHex(solanaAddressToBytes32(SOL_ATA)))
    expect(missing.hookData.length).toBe(65)
    expect(toHex(missing.hookData.slice(33))).toBe(toHex(solanaAddressToBytes32(SOL_OWNER)))

    const existing = planBurn(NETWORK, { source: base, destination: solana, recipient: SOL_OWNER, fast: false, solanaAta: SOL_ATA, solanaAtaExists: true })
    expect(toHex(existing.hookData)).toBe(toHex(buildForwardHook()))
  })

  it('routes Stellar through the CctpForwarder as both recipient and caller', () => {
    const plan = planBurn(NETWORK, { source: base, destination: stellar, recipient: G, fast: false })
    const forwarder = toHex(StrKey.decodeContract(NETWORK.cctpForwarder))
    expect(plan.mode).toBe('stellar-claim')
    expect(toHex(plan.mintRecipient)).toBe(forwarder)
    expect(toHex(plan.destinationCaller)).toBe(forwarder)
    expect(new TextDecoder().decode(plan.hookData.slice(32))).toBe(G)
  })

  it('refuses same-chain routes and a missing Solana account', () => {
    expect(() => planBurn(NETWORK, { source: base, destination: base, recipient: EVM, fast: false })).toThrow()
    expect(() => planBurn(NETWORK, { source: base, destination: solana, recipient: SOL_OWNER, fast: false })).toThrow()
  })
})
