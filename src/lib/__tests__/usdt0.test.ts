import { StrKey, scValToNative, xdr } from '@stellar/stellar-sdk'
import { describe, expect, it } from 'vitest'
import { destinationChains, fitRoute, routeSupported, sourceChains, tokenSymbol } from '../../config/assets'
import { chainById } from '../../config/chains'
import { USDT0, usdt0Route } from '../../config/usdt0'
import { formatSignificant } from '../amount'
import { interpretLzScan } from '../lzscan'
import { amountForOftReceive, feeBps, scaleReceived, withFeeBuffer, type OftQuote } from '../oft'
import { isValidRecipientFor, oftRecipientBytes32 } from '../recipient'
import { oftSendParamScVal } from '../stellar'

const G = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
const C = 'CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T'
const M = 'MA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUAAAAAAAAAAAACJUQ'
const EVM = '0x1234567890abcdef1234567890abcdef12345678'

describe('usdt0Route', () => {
  it('sends Ethereum → Solana through the Ethereum Legacy Mesh pool', () => {
    expect(usdt0Route('ethereum', 'solana')).toEqual({ kind: 'legacy', contract: USDT0.ethereum.legacyOft, dstEid: 30168 })
  })

  it('sends Arbitrum → Solana through the Arbitrum Legacy Mesh pool', () => {
    expect(usdt0Route('arbitrum', 'solana')?.contract).toBe(USDT0.arbitrum.legacyOft)
  })

  it('uses the OFT Adapter, not the Legacy Mesh, between Ethereum and USDT0 chains', () => {
    expect(usdt0Route('ethereum', 'arbitrum')).toEqual({ kind: 'oft', contract: USDT0.ethereum.oft, dstEid: 30110 })
    expect(usdt0Route('ethereum', 'stellar')).toEqual({ kind: 'oft', contract: USDT0.ethereum.oft, dstEid: 30600 })
  })

  it('sends from Stellar through its Soroban OFT', () => {
    expect(usdt0Route('stellar', 'ethereum')).toEqual({ kind: 'oft', contract: USDT0.stellar.oft, dstEid: 30101 })
  })

  it('has no direct route from other USDT0 chains to Solana (that needs a two-hop compose)', () => {
    expect(usdt0Route('optimism', 'solana')).toBeNull()
    expect(usdt0Route('stellar', 'solana')).toBeNull()
  })

  it('does not send from Solana or to chains without USDT0', () => {
    expect(usdt0Route('solana', 'ethereum')).toBeNull()
    expect(usdt0Route('ethereum', 'base')).toBeNull()
    expect(usdt0Route('ethereum', 'ethereum')).toBeNull()
  })
})

describe('asset route fitting', () => {
  it('lists USDT sources without Solana and USDC sources with it', () => {
    expect(sourceChains('usdt').map((c) => c.id)).not.toContain('solana')
    expect(sourceChains('usdc').map((c) => c.id)).toContain('solana')
  })

  it('only offers reachable USDT destinations', () => {
    const fromOptimism = destinationChains('usdt', chainById('optimism')).map((c) => c.id)
    expect(fromOptimism).toContain('stellar')
    expect(fromOptimism).not.toContain('solana')
    expect(fromOptimism).not.toContain('optimism')
  })

  it('moves an unsupported source to Ethereum and keeps a destination it can reach', () => {
    expect(fitRoute('usdt', { sourceId: 'base', destId: 'solana' })).toEqual({ sourceId: 'ethereum', destId: 'solana' })
  })

  it('swaps an unreachable destination for the first preferred reachable one', () => {
    expect(fitRoute('usdt', { sourceId: 'solana', destId: 'base' })).toEqual({ sourceId: 'ethereum', destId: 'solana' })
    expect(fitRoute('usdt', { sourceId: 'optimism', destId: 'solana' })).toEqual({ sourceId: 'optimism', destId: 'arbitrum' })
  })

  it('leaves a route that works for the asset alone', () => {
    expect(fitRoute('usdc', { sourceId: 'stellar', destId: 'arbitrum' })).toEqual({ sourceId: 'stellar', destId: 'arbitrum' })
    expect(fitRoute('usdt', { sourceId: 'stellar', destId: 'arbitrum' })).toEqual({ sourceId: 'stellar', destId: 'arbitrum' })
  })

  it('knows a swap is impossible when the reverse route is missing', () => {
    expect(routeSupported('usdt', 'solana', 'ethereum')).toBe(false)
    expect(routeSupported('usdc', 'solana', 'ethereum')).toBe(true)
  })

  it('names Tether USDT and USDT0 per chain', () => {
    expect(tokenSymbol('usdt', 'ethereum')).toBe('USDT')
    expect(tokenSymbol('usdt', 'solana')).toBe('USDT')
    expect(tokenSymbol('usdt', 'arbitrum')).toBe('USDT0')
    expect(tokenSymbol('usdc', 'arbitrum')).toBe('USDC')
  })
})

describe('OFT recipients', () => {
  it('encodes a Stellar G… account as its raw Ed25519 key, not the strkey text', () => {
    const bytes = oftRecipientBytes32('stellar', G)
    expect(bytes).toHaveLength(32)
    expect(Array.from(bytes)).toEqual(Array.from(StrKey.decodeEd25519PublicKey(G)))
  })

  it('left-pads EVM addresses', () => {
    const bytes = oftRecipientBytes32('evm', EVM)
    expect(Array.from(bytes.slice(0, 12))).toEqual(new Array(12).fill(0))
    expect(bytes[12]).toBe(0x12)
  })

  it('refuses Stellar contracts and muxed accounts for USDT0', () => {
    expect(isValidRecipientFor('usdt', 'stellar', C)).toBe(false)
    expect(isValidRecipientFor('usdt', 'stellar', M)).toBe(false)
    expect(isValidRecipientFor('usdt', 'stellar', G)).toBe(true)
    expect(isValidRecipientFor('usdc', 'stellar', C)).toBe(true)
    expect(() => oftRecipientBytes32('stellar', C)).toThrow()
  })
})

describe('Stellar SendParam', () => {
  it('sorts the struct keys and converts amounts to 7 decimals', () => {
    const val = oftSendParamScVal({
      route: { kind: 'oft', contract: USDT0.stellar.oft as string, dstEid: 30101 },
      amount: 10_000_000n,
      to: new Uint8Array(32).fill(2),
      minAmount: 9_000_000n,
    })
    const keys = (val.value as xdr.ScMapEntry[]).map((e: xdr.ScMapEntry) => String(scValToNative(e.key)))
    expect(keys).toEqual([...keys].sort())
    const native = scValToNative(val) as Record<string, unknown>
    expect(native.amount_ld).toBe(100_000_000n)
    expect(native.min_amount_ld).toBe(90_000_000n)
    expect(native.dst_eid).toBe(30101)
  })
})

describe('OFT quote math', () => {
  const legacy: OftQuote = { amountSent: 10_000_000n, amountReceived: 9_997_000n, minAmount: 0n, maxAmount: 1n << 60n, nativeFee: 1000n }

  it('reads the Legacy Mesh 3 bps off a quote', () => {
    expect(feeBps(legacy)).toBe(3)
    expect(feeBps({ ...legacy, amountReceived: legacy.amountSent })).toBe(0)
  })

  it('scales a quote to another amount', () => {
    expect(scaleReceived(legacy, 20_000_000n)).toBe(19_994_000n)
  })

  it('sends exactly the target on a fee-free OFT route', () => {
    expect(amountForOftReceive({ ...legacy, amountReceived: legacy.amountSent }, 12_345_678n)).toBe(12_345_678n)
  })

  it('grosses up a Legacy Mesh target to the smallest amount that lands it', () => {
    for (const target of [1n, 9_997_000n, 19_994_000n, 123_456_789n]) {
      const amount = amountForOftReceive(legacy, target)
      expect(scaleReceived(legacy, amount)).toBeGreaterThanOrEqual(target)
      expect(scaleReceived(legacy, amount - 1n)).toBeLessThan(target)
    }
    expect(amountForOftReceive(legacy, 9_997_000n)).toBe(10_000_000n)
  })

  it('throws when nothing would land', () => {
    expect(() => amountForOftReceive({ ...legacy, amountReceived: 0n }, 1n)).toThrow()
  })

  it('adds 5% headroom to the messaging fee', () => {
    expect(withFeeBuffer(1000n)).toBe(1050n)
  })

  it('formats gas-sized fees to 4 significant digits', () => {
    expect(formatSignificant(483412698315543n, 18)).toBe('0.0004834')
    expect(formatSignificant(53688787n, 7)).toBe('5.369')
  })
})

describe('interpretLzScan', () => {
  it('waits while Scan has not indexed the transaction', () => {
    expect(interpretLzScan({ data: [] }).phase).toBe('burned')
  })

  it('is attesting until the source tx is final, then delivering', () => {
    expect(interpretLzScan({ data: [{ status: { name: 'INFLIGHT' }, source: { status: 'VALIDATING_TX' } }] }).phase).toBe('attesting')
    expect(interpretLzScan({ data: [{ status: { name: 'INFLIGHT' }, source: { status: 'SUCCEEDED' } }] }).phase).toBe('forwarding')
  })

  it('completes with the destination hash once delivered', () => {
    const snap = interpretLzScan({ data: [{ status: { name: 'DELIVERED' }, destination: { tx: { txHash: '0xabc' } } }] })
    expect(snap).toEqual({ phase: 'complete', destTxHash: '0xabc' })
  })

  it('stops on failure and keeps polling a stored payload', () => {
    expect(interpretLzScan({ data: [{ status: { name: 'FAILED', message: 'boom' } }] })).toMatchObject({ phase: 'failed', detail: 'boom' })
    expect(interpretLzScan({ data: [{ status: { name: 'PAYLOAD_STORED' } }] }).phase).toBe('forwarding')
  })
})
