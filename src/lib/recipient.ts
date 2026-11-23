import { getAddressDecoder, getAddressEncoder, isAddress, type Address } from '@solana/kit'
import { StrKey } from '@stellar/stellar-sdk'
import type { AssetId } from '../config/assets'
import type { ChainKind } from '../config/chains'

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/

/** Stellar accepts accounts (G), muxed accounts (M) and contracts (C) via the CctpForwarder. */
export function isValidStellarRecipient(value: string): boolean {
  return StrKey.isValidEd25519PublicKey(value) || StrKey.isValidMed25519PublicKey(value) || StrKey.isValidContract(value)
}

export function isValidRecipient(kind: ChainKind, value: string): boolean {
  const trimmed = value.trim()
  if (kind === 'evm') return EVM_ADDRESS.test(trimmed)
  if (kind === 'solana') return isAddress(trimmed)
  return isValidStellarRecipient(trimmed)
}

/**
 * USDT0 into Stellar takes only G… accounts. The OFT reads 32 raw bytes, so a
 * muxed id would be dropped, and a C… contract that isn't deployed at delivery
 * time gets read as an account nobody holds the key to.
 */
export function isValidRecipientFor(asset: AssetId, kind: ChainKind, value: string): boolean {
  if (asset === 'usdt' && kind === 'stellar') return StrKey.isValidEd25519PublicKey(value.trim())
  return isValidRecipient(kind, value)
}

/**
 * The 32 bytes a LayerZero OFT resolves on the destination: a left-padded
 * EVM address, the Solana wallet (the OFT derives the token account), or the
 * raw Ed25519 key behind a Stellar G… address. Never the strkey text, which is
 * what CCTP's Stellar hook wants instead.
 */
export function oftRecipientBytes32(kind: ChainKind, value: string): Uint8Array {
  const trimmed = value.trim()
  if (kind === 'evm') return evmAddressToBytes32(trimmed)
  if (kind === 'solana') return solanaAddressToBytes32(trimmed)
  if (!StrKey.isValidEd25519PublicKey(trimmed)) throw new Error(`USDT0 needs a Stellar G… account, got ${value}`)
  return new Uint8Array(StrKey.decodeEd25519PublicKey(trimmed))
}

/** Left-pads a 20-byte EVM address to the 32 bytes CCTP uses for addresses. */
export function evmAddressToBytes32(address: string): Uint8Array {
  const trimmed = address.trim()
  if (!EVM_ADDRESS.test(trimmed)) throw new Error(`Invalid EVM address: ${address}`)
  const out = new Uint8Array(32)
  const hex = trimmed.slice(2)
  for (let i = 0; i < 20; i++) out[12 + i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

export function solanaAddressToBytes32(value: string): Uint8Array {
  const trimmed = value.trim()
  if (!isAddress(trimmed)) throw new Error(`Invalid Solana address: ${value}`)
  return new Uint8Array(getAddressEncoder().encode(trimmed as Address))
}

/** Base58 form of 32 raw bytes, which the Solana CCTP program takes for `destinationCaller`. */
export function bytes32ToSolanaAddress(bytes: Uint8Array): string {
  if (bytes.length !== 32) throw new Error('Expected 32 bytes')
  return getAddressDecoder().decode(bytes)
}

export function stellarContractToBytes32(contractId: string): Uint8Array {
  if (!StrKey.isValidContract(contractId)) throw new Error(`Invalid Stellar contract: ${contractId}`)
  return new Uint8Array(StrKey.decodeContract(contractId))
}

export function shortAddress(value: string, head: number = 4, tail: number = 4): string {
  if (value.length <= head + tail + 1) return value
  return `${value.slice(0, head)}…${value.slice(-tail)}`
}
