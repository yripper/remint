import { useCallback, useEffect, useState } from 'react'
import { KitEventType } from '@creit.tech/stellar-wallets-kit/types'
import { initWalletKit, StellarWalletsKit } from '../lib/wallet'

export interface StellarWallet {
  address: string | null
  /** Resolves with the connected address. */
  connect: () => Promise<string>
  openProfile: () => Promise<void>
  sign: (xdr: string, networkPassphrase: string) => Promise<string>
}

export function useStellarWallet(): StellarWallet {
  const [address, setAddress] = useState<string | null>(null)

  useEffect(() => {
    initWalletKit()
    // The kit replays the current state on subscribe, which restores a previous session.
    const offState = StellarWalletsKit.on(KitEventType.STATE_UPDATED, (event) => {
      setAddress(event.payload.address ?? null)
    })
    const offDisconnect = StellarWalletsKit.on(KitEventType.DISCONNECT, () => setAddress(null))
    return () => {
      offState()
      offDisconnect()
    }
  }, [])

  const connect = useCallback(async () => {
    const { address: next } = await StellarWalletsKit.authModal()
    setAddress(next)
    return next
  }, [])

  const openProfile = useCallback(async () => {
    await StellarWalletsKit.profileModal()
  }, [])

  const sign = useCallback(
    async (xdr: string, networkPassphrase: string) => {
      if (!address) throw new Error('Connect a Stellar wallet first')
      const { signedTxXdr } = await StellarWalletsKit.signTransaction(xdr, { networkPassphrase, address })
      return signedTxXdr
    },
    [address],
  )

  return { address, connect, openProfile, sign }
}
