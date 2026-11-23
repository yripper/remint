import type { ChainKind } from '../config/chains'
import { shortAddress } from '../lib/recipient'

export interface WalletPill {
  family: ChainKind
  /** Wallet brand, e.g. "MetaMask". */
  name: string
  icon?: string
  address: string
}

interface HeaderProps {
  pills: WalletPill[]
  onPill: (family: ChainKind) => void
  onConnect: () => void
}

export function Header({ pills, onPill, onConnect }: HeaderProps) {
  return (
    <header className="topbar">
      <a className="wordmark" href="/" aria-label="Remint home">Remint</a>

      <div className="wallets">
        {pills.map((pill) => (
          <button
            key={pill.family}
            type="button"
            className="wallet wallet--connected"
            onClick={() => onPill(pill.family)}
            title={`${pill.name}: ${pill.address}`}
          >
            {pill.icon ? <img className="wallet__icon" src={pill.icon} alt="" width={18} height={18} /> : <span className="wallet__dot" aria-hidden="true" />}
            <span className="visually-hidden">{pill.name}</span>
            {shortAddress(pill.address, 4, 4)}
          </button>
        ))}
        {pills.length === 0 && (
          <button type="button" className="wallet" onClick={onConnect}>
            <span>Connect<span className="wallet__extra"> wallet</span></span>
          </button>
        )}
      </div>
    </header>
  )
}
