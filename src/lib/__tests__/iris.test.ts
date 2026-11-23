import { describe, expect, it } from 'vitest'
import { interpretIris } from '../iris'

const wrap = (msg: Record<string, unknown>) => ({ messages: [msg] })

describe('interpretIris', () => {
  it('treats an empty or odd payload as burned but not yet indexed', () => {
    expect(interpretIris({ messages: [] }).phase).toBe('burned')
    expect(interpretIris(null).phase).toBe('burned')
  })
  it('reports attesting until the attestation is complete', () => {
    expect(interpretIris(wrap({ status: 'pending_confirmations' })).phase).toBe('attesting')
    expect(interpretIris(wrap({ status: 'complete', attestation: 'PENDING' })).phase).toBe('attesting')
  })
  it('reports forwarding while Circle submits the mint', () => {
    expect(interpretIris(wrap({ status: 'complete', attestation: '0xa', forwardState: 'PENDING', forwardTxHash: '0xabc' }))).toEqual({
      phase: 'forwarding',
      destTxHash: '0xabc',
    })
  })
  it('reports complete with the destination mint hash', () => {
    const snap = interpretIris(
      wrap({ status: 'complete', attestation: '0xa', forwardState: 'COMPLETE', forwardTxHash: '0xf', destinationMintTxHash: '0xd' }),
    )
    expect(snap).toEqual({ phase: 'complete', destTxHash: '0xd' })
  })
  it('reports a failed forward', () => {
    expect(interpretIris(wrap({ status: 'complete', attestation: '0xa', forwardState: 'FAILED' })).phase).toBe('failed')
  })
  it('hands back message and attestation when the user claims on Stellar', () => {
    const snap = interpretIris(wrap({ status: 'complete', message: '0x01', attestation: '0x02' }), 'stellar-claim')
    expect(snap).toEqual({ phase: 'claimable', message: '0x01', attestation: '0x02' })
  })
})
