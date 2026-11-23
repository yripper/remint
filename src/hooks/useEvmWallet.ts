import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { getEvmWallets, requestEvmAccount, subscribeEvmWallets, type EvmWallet } from '../lib/evm'
import { readPref, writePref } from '../lib/prefs'

const PREF_KEY = 'cctp.wallet.evm'

export interface EvmConnection {
  wallet: EvmWallet
  address: string
}

export interface EvmWalletState {
  wallets: EvmWallet[]
  connection: EvmConnection | null
  /** Resolves with the connected address. */
  connect: (wallet: EvmWallet) => Promise<string>
  disconnect: () => void
}

export function useEvmWallet(): EvmWalletState {
  const wallets = useSyncExternalStore(subscribeEvmWallets, getEvmWallets)
  const [connection, setConnection] = useState<EvmConnection | null>(null)

  // Reconnect silently to the wallet used last time, once it announces itself.
  useEffect(() => {
    if (connection) return
    const remembered = wallets.find((w) => w.info.rdns === readPref(PREF_KEY))
    if (!remembered) return
    let cancelled = false
    requestEvmAccount(remembered.provider, true)
      .then((address) => {
        if (!cancelled && address) setConnection({ wallet: remembered, address })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [wallets, connection])

  // Follow account switches inside the wallet.
  useEffect(() => {
    if (!connection) return
    const { provider } = connection.wallet
    const onAccounts = (accounts: readonly string[]) => {
      const next = accounts[0]
      setConnection((prev) => (prev && next ? { ...prev, address: next } : null))
      if (!next) writePref(PREF_KEY, null)
    }
    provider.on('accountsChanged', onAccounts)
    return () => provider.removeListener('accountsChanged', onAccounts)
  }, [connection])

  const connect = useCallback(async (wallet: EvmWallet) => {
    const address = await requestEvmAccount(wallet.provider)
    if (!address) throw new Error(`${wallet.info.name} returned no account`)
    setConnection({ wallet, address })
    writePref(PREF_KEY, wallet.info.rdns)
    return address
  }, [])

  const disconnect = useCallback(() => {
    setConnection((prev) => {
      // Best effort: not every wallet supports revoking, and forgetting locally is enough.
      prev?.wallet.provider
        .request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] })
        .catch(() => {})
      return null
    })
    writePref(PREF_KEY, null)
  }, [])

  return { wallets, connection, connect, disconnect }
}
