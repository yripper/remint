import { Solana } from '@circle-fin/bridge-kit/chains'
import { address, createSolanaRpc } from '@solana/kit'
import { TOKEN_PROGRAM_ADDRESS, findAssociatedTokenPda } from '@solana-program/token'
import { getWallets } from '@wallet-standard/app'
import type { Wallet, WalletAccount } from '@wallet-standard/base'
import {
  StandardConnect,
  StandardDisconnect,
  StandardEvents,
  type StandardConnectFeature,
  type StandardDisconnectFeature,
  type StandardEventsFeature,
} from '@wallet-standard/features'
import { SolanaSignTransaction, type SolanaSignTransactionFeature } from '@solana/wallet-standard-features'
import type { Chain } from '../config/chains'
import { toHex } from './hooks'

const SOLANA_MAINNET = 'solana:mainnet'

/** Solana CCTP mints to the recipient's USDC token account, not the wallet itself. */
export async function deriveUsdcAta(owner: string, usdcMint: string): Promise<string> {
  const [ata] = await findAssociatedTokenPda({
    owner: address(owner),
    mint: address(usdcMint),
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  })
  return ata
}

async function rpcCall(rpcUrl: string, method: string, params: unknown[], signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal,
  })
  if (!res.ok) throw new Error(`Solana RPC ${method} failed (${res.status})`)
  const body = (await res.json()) as { result?: unknown; error?: { message?: string } }
  if (body.error) throw new Error(body.error.message ?? `Solana RPC ${method} failed`)
  return body.result
}

/**
 * Whether the ATA already exists. If the RPC can't answer we report `false`,
 * which asks Circle to create it: costs a bit more rent but can't strand funds.
 */
export async function accountExists(rpcUrl: string, account: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const result = await rpcCall(rpcUrl, 'getAccountInfo', [account, { encoding: 'base64' }], signal)
    const value = (result as { value?: unknown } | null)?.value
    return value !== null && value !== undefined
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    return false
  }
}

/**
 * USDC balance in 6-decimal units; a missing token account is an empty balance.
 * Reads the parsed token account via getAccountInfo, which free public RPCs
 * serve (some gate getTokenAccountBalance behind an API key).
 */
export async function getSolanaUsdcBalance(rpcUrl: string, owner: string, usdcMint: string): Promise<bigint> {
  const ata = await deriveUsdcAta(owner, usdcMint)
  const result = await rpcCall(rpcUrl, 'getAccountInfo', [ata, { encoding: 'jsonParsed' }])
  const value = (result as { value?: { data?: { parsed?: { info?: { tokenAmount?: { amount?: string } } } } } | null }).value
  return BigInt(value?.data?.parsed?.info?.tokenAmount?.amount ?? '0')
}

/* ---------- Wallet Standard connectors (Phantom, Solflare, Backpack, …) ---------- */

type ConnectableWallet = Wallet & {
  features: StandardConnectFeature & SolanaSignTransactionFeature & Partial<StandardDisconnectFeature & StandardEventsFeature>
}

function isSolanaWallet(wallet: Wallet): wallet is ConnectableWallet {
  return (
    StandardConnect in wallet.features &&
    SolanaSignTransaction in wallet.features &&
    wallet.chains.some((c) => c.startsWith('solana:'))
  )
}

export function listSolanaWallets(): ConnectableWallet[] {
  return getWallets().get().filter(isSolanaWallet)
}

export function subscribeSolanaWallets(listener: () => void): () => void {
  const registry = getWallets()
  const offRegister = registry.on('register', listener)
  const offUnregister = registry.on('unregister', listener)
  return () => {
    offRegister()
    offUnregister()
  }
}

export async function connectSolanaWallet(wallet: ConnectableWallet, silent: boolean = false): Promise<WalletAccount | null> {
  const { accounts } = await wallet.features[StandardConnect].connect(silent ? { silent: true } : undefined)
  return accounts.find((a) => a.chains.some((c) => c.startsWith('solana:'))) ?? accounts[0] ?? null
}

export async function disconnectSolanaWallet(wallet: ConnectableWallet): Promise<void> {
  await wallet.features[StandardDisconnect]?.disconnect()
}

export function onSolanaAccountChange(wallet: ConnectableWallet, listener: (accounts: readonly WalletAccount[]) => void): () => void {
  const events = wallet.features[StandardEvents]
  if (!events) return () => {}
  return events.on('change', ({ accounts }) => {
    if (accounts) listener(accounts)
  })
}

export type SolanaWallet = ConnectableWallet

interface SerializableTransaction {
  serialize(): Uint8Array
}

/**
 * Adapts a Wallet Standard wallet to the provider shape Circle's Solana adapter
 * expects. The adapter hands us a web3.js VersionedTransaction; the wallet
 * signs its bytes and we return the signed bytes, which the adapter deserializes.
 */
function circleProvider(wallet: ConnectableWallet, account: WalletAccount) {
  const sign = wallet.features[SolanaSignTransaction].signTransaction
  return {
    isConnected: true,
    address: account.address,
    connect: async () => ({ address: account.address }),
    disconnect: async () => {},
    signTransaction: async (transaction: unknown): Promise<unknown> => {
      const bytes = (transaction as SerializableTransaction).serialize()
      const [output] = await sign({ account, transaction: bytes, chain: SOLANA_MAINNET })
      return output.signedTransaction
    },
  }
}

interface AnchorProviderLike {
  connection: object
  wallet: unknown
  opts: unknown
}

type ProviderCtor = new (connection: object, wallet: unknown, opts: unknown) => AnchorProviderLike
type ConnectionCtor = new (endpoint: string, config: { commitment: string }) => object

interface AnchorCapable {
  getAnchorProvider: (ctx: never) => Promise<unknown>
}

/**
 * Circle's adapter builds its Anchor connection on the hardcoded public
 * mainnet endpoint, which answers 403 to browser requests. Rebuild the
 * provider with the same classes on our RPC, so program lookups and
 * account reads work from the page.
 */
function pointAnchorAt(adapter: AnchorCapable, rpcUrl: string): void {
  const original = adapter.getAnchorProvider.bind(adapter)
  adapter.getAnchorProvider = async (ctx: never) => {
    const provider = (await original(ctx)) as AnchorProviderLike
    const Connection = provider.connection.constructor as ConnectionCtor
    const Provider = provider.constructor as ProviderCtor
    return new Provider(new Connection(rpcUrl, { commitment: 'confirmed' }), provider.wallet, provider.opts)
  }
}

export interface SolanaBurnParams {
  amount: bigint
  destination: Chain
  mintRecipient: Uint8Array
  /** Base58: the Solana program reads destinationCaller as a public key. */
  destinationCaller: string
  maxFee: bigint
  finality: number
  hookData: Uint8Array
}

/**
 * Burns USDC on Solana with Circle's Solana Kit adapter, which builds the CCTP
 * program instruction. Loaded on demand: it pulls in Anchor and web3.js.
 */
export async function solanaBurn(wallet: ConnectableWallet, account: WalletAccount, rpcUrl: string, params: SolanaBurnParams): Promise<string> {
  const { createSolanaKitAdapterFromProvider } = await import('@circle-fin/adapter-solana-kit')
  const adapter = await createSolanaKitAdapterFromProvider({
    provider: circleProvider(wallet, account),
    getRpc: () => createSolanaRpc(rpcUrl),
  })
  pointAnchorAt(adapter, rpcUrl)
  // The adapter reads only `cctp.domain` from the destination, so a minimal
  // definition also covers Stellar, which Bridge Kit doesn't route to.
  const toChain = { cctp: { domain: params.destination.domain, contracts: {} } }
  type BurnPayload = Parameters<typeof adapter.prepareAction<'cctp.v2.depositForBurnWithHook'>>[1]
  const payload = {
    fromChain: Solana,
    toChain,
    amount: params.amount,
    mintRecipient: `0x${toHex(params.mintRecipient)}`,
    destinationCaller: params.destinationCaller,
    maxFee: params.maxFee,
    minFinalityThreshold: params.finality,
    hookData: `0x${toHex(params.hookData)}`,
  } as unknown as BurnPayload
  const request = await adapter.prepareAction('cctp.v2.depositForBurnWithHook', payload, { chain: Solana })
  return request.execute()
}
