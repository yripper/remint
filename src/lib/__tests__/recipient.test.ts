import { describe, expect, it } from 'vitest'
import { toHex } from '../hooks'
import { StrKey } from '@stellar/stellar-sdk'
import { bytes32ToSolanaAddress, evmAddressToBytes32, isValidRecipient, shortAddress, solanaAddressToBytes32, stellarContractToBytes32 } from '../recipient'

const EVM = '0x1234567890abcdef1234567890ABCDEF12345678'
const SOL = 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr'
const G = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
const FORWARDER = 'CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T'

describe('isValidRecipient', () => {
  it('validates EVM addresses', () => {
    expect(isValidRecipient('evm', EVM)).toBe(true)
    expect(isValidRecipient('evm', `  ${EVM} `)).toBe(true)
    expect(isValidRecipient('evm', '0x123')).toBe(false)
    expect(isValidRecipient('evm', SOL)).toBe(false)
  })
  it('validates Solana addresses', () => {
    expect(isValidRecipient('solana', SOL)).toBe(true)
    expect(isValidRecipient('solana', EVM)).toBe(false)
    expect(isValidRecipient('solana', '')).toBe(false)
  })
  it('validates Stellar accounts and contracts', () => {
    expect(isValidRecipient('stellar', G)).toBe(true)
    expect(isValidRecipient('stellar', FORWARDER)).toBe(true)
    expect(isValidRecipient('stellar', SOL)).toBe(false)
    expect(isValidRecipient('stellar', `${G.slice(0, -1)}A`)).toBe(false)
  })
})

describe('stellarContractToBytes32', () => {
  it('decodes a contract strkey to its 32-byte id', () => {
    const bytes = stellarContractToBytes32(FORWARDER)
    expect(bytes.length).toBe(32)
    expect(StrKey.encodeContract(Buffer.from(bytes))).toBe(FORWARDER)
  })
  it('rejects account keys', () => {
    expect(() => stellarContractToBytes32(G)).toThrow()
  })
})

describe('bytes32ToSolanaAddress', () => {
  it('round-trips with solanaAddressToBytes32', () => {
    expect(bytes32ToSolanaAddress(solanaAddressToBytes32(SOL))).toBe(SOL)
  })
})

describe('evmAddressToBytes32', () => {
  it('left-pads to 32 bytes', () => {
    expect(toHex(evmAddressToBytes32(EVM))).toBe(`000000000000000000000000${EVM.slice(2).toLowerCase()}`)
  })
  it('throws on an invalid address', () => {
    expect(() => evmAddressToBytes32('nope')).toThrow()
  })
})

describe('solanaAddressToBytes32', () => {
  it('decodes base58 into 32 bytes', () => {
    expect(solanaAddressToBytes32(SOL).length).toBe(32)
  })
  it('throws on an invalid address', () => {
    expect(() => solanaAddressToBytes32(EVM)).toThrow()
  })
})

describe('shortAddress', () => {
  it('abbreviates long values and leaves short ones', () => {
    expect(shortAddress('GABCDEFGHIJKLMNOP')).toBe('GABC…MNOP')
    expect(shortAddress('abc')).toBe('abc')
  })
})
