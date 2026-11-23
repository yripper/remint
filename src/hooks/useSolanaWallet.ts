import { useCallback, useEffect, useState } from 'react'
import type { WalletAccount } from '@wallet-standard/base'
import { readPref, writePref } from '../lib/prefs'
import {
  connectSolanaWallet,
  disconnectSolanaWallet,
  listSolanaWallets,
  onSolanaAccountChange,
  subscribeSolanaWallets,
  type SolanaWallet,
} from '../lib/solana'

const PREF_KEY = 'cctp.wallet.solana'

export interface SolanaConnection {
  wallet: SolanaWallet
  account: WalletAccount
  address: string
}

export interface SolanaWalletState {
  wallets: SolanaWallet[]
  connection: SolanaConnection | null
  /** Resolves with the connected address. */
  connect: (wallet: SolanaWallet) => Promise<string>
  disconnect: () => void
}

export function useSolanaWallet(): SolanaWalletState {
  const [wallets, setWallets] = useState<SolanaWallet[]>(listSolanaWallets)
  const [connection, setConnection] = useState<SolanaConnection | null>(null)

  useEffect(() => subscribeSolanaWallets(() => setWallets(listSolanaWallets())), [])

  // Silent reconnect: wallets that already trust this site return the account without a prompt.
  useEffect(() => {
    if (connection) return
    const remembered = wallets.find((w) => w.name === readPref(PREF_KEY))
    if (!remembered) return
    let cancelled = false
    connectSolanaWallet(remembered, true)
      .then((account) => {
        if (!cancelled && account) setConnection({ wallet: remembered, account, address: account.address })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [wallets, connection])

  useEffect(() => {
    if (!connection) return
    return onSolanaAccountChange(connection.wallet, (accounts) => {
      const next = accounts[0]
      setConnection((prev) => (prev && next ? { ...prev, account: next, address: next.address } : null))
      if (!next) writePref(PREF_KEY, null)
    })
  }, [connection])

  const connect = useCallback(async (wallet: SolanaWallet) => {
    const account = await connectSolanaWallet(wallet)
    if (!account) throw new Error(`${wallet.name} returned no account`)
    setConnection({ wallet, account, address: account.address })
    writePref(PREF_KEY, wallet.name)
    return account.address
  }, [])

  const disconnect = useCallback(() => {
    setConnection((prev) => {
      if (prev) disconnectSolanaWallet(prev.wallet).catch(() => {})
      return null
    })
    writePref(PREF_KEY, null)
  }, [])

  return { wallets, connection, connect, disconnect }
}
