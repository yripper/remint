import { describe, expect, it } from 'vitest'
import { buildForwardHook, buildSolanaAtaForwardHook, buildStellarForwarderHook, fromHex, toHex } from '../hooks'

describe('buildForwardHook', () => {
  it('matches the static hook Circle documents', () => {
    expect(toHex(buildForwardHook())).toBe('636374702d666f72776172640000000000000000000000000000000000000000')
  })
})

describe('buildSolanaAtaForwardHook', () => {
  it('adds the ATA flag and owner after a length of 33', () => {
    const owner = new Uint8Array(32).fill(7)
    const hook = buildSolanaAtaForwardHook(owner)
    expect(hook.length).toBe(65)
    expect(toHex(hook.slice(0, 24))).toBe(toHex(buildForwardHook().slice(0, 24)))
    expect(new DataView(hook.buffer).getUint32(24, false)).toBe(0)
    expect(new DataView(hook.buffer).getUint32(28, false)).toBe(33)
    expect(hook[32]).toBe(1)
    expect(Array.from(hook.slice(33))).toEqual(Array.from(owner))
  })
  it('rejects owners that are not 32 bytes', () => {
    expect(() => buildSolanaAtaForwardHook(new Uint8Array(31))).toThrow()
  })
})

describe('buildStellarForwarderHook', () => {
  it('uses 24 zero bytes, version 0, the length, then the strkey', () => {
    const recipient = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
    const hook = buildStellarForwarderHook(recipient)
    expect(hook.length).toBe(32 + 56)
    expect(Array.from(hook.slice(0, 24)).every((b) => b === 0)).toBe(true)
    expect(new DataView(hook.buffer).getUint32(24, false)).toBe(0)
    expect(new DataView(hook.buffer).getUint32(28, false)).toBe(56)
    expect(new TextDecoder().decode(hook.slice(32))).toBe(recipient)
  })
})

describe('fromHex', () => {
  it('round-trips with toHex and accepts a 0x prefix', () => {
    expect(toHex(fromHex('0x00ff10'))).toBe('00ff10')
  })
  it('rejects odd or non-hex input', () => {
    expect(() => fromHex('abc')).toThrow()
    expect(() => fromHex('zz')).toThrow()
  })
})
