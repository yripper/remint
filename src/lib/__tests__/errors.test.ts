import { describe, expect, it } from 'vitest'
import { contractErrorCode, describeError, isMissingTrustline } from '../errors'

describe('contractErrorCode', () => {
  it('extracts the code from a Soroban host error', () => {
    expect(contractErrorCode('HostError: Error(Contract, #13)\nEvent log...')).toBe(13)
    expect(contractErrorCode('something else')).toBeNull()
  })
})

describe('isMissingTrustline', () => {
  it('recognizes SAC error 13 and plain wording', () => {
    expect(isMissingTrustline('HostError: Error(Contract, #13)')).toBe(true)
    expect(isMissingTrustline('trustline entry is missing')).toBe(true)
    expect(isMissingTrustline('HostError: Error(Contract, #9)')).toBe(false)
  })
})

describe('describeError', () => {
  it('maps known contract codes', () => {
    expect(describeError(new Error('HostError: Error(Contract, #9)'))).toMatch(/allowance/)
    expect(describeError(new Error('HostError: Error(Contract, #7114)'))).toMatch(/fee went up/)
  })
  it('recognizes a declined wallet prompt', () => {
    expect(describeError(new Error('User rejected the request'))).toMatch(/declined/)
  })
  it('recognizes an EIP-1193 rejection code', () => {
    expect(describeError(Object.assign(new Error('whatever'), { code: 4001 }))).toMatch(/declined/)
  })
  it('prefers viem short messages', () => {
    const err = Object.assign(new Error('long dump'), { shortMessage: 'insufficient funds for gas * price + value' })
    expect(describeError(err)).toMatch(/native token/)
  })
  it('maps an already-claimed Stellar message', () => {
    expect(describeError(new Error('HostError: Error(Contract, #6908)'))).toMatch(/already claimed/)
  })
  it('falls back to the first line of unknown errors', () => {
    expect(describeError(new Error('boom\nstack'))).toBe('boom')
    expect(describeError('plain')).toBe('plain')
  })
})
