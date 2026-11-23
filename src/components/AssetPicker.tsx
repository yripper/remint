import { useEffect, useRef, useState } from 'react'
import { ASSETS, ASSET_IDS, tokenSymbol, type AssetId } from '../config/assets'
import type { Chain } from '../config/chains'
import { ChainIcon } from './ChainIcon'

interface AssetPickerProps {
  value: AssetId
  /** Source chain, shown as the badge and used for the on-chain token name. */
  chain: Chain
  onChange: (asset: AssetId) => void
  disabled?: boolean
}

/** The token chip next to the amount, which doubles as the USDC / USDT switch. */
export function AssetPicker({ value, chain, onChange, disabled = false }: AssetPickerProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const asset = ASSETS[value]

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const pick = (id: AssetId) => {
    onChange(id)
    setOpen(false)
  }

  return (
    <div className="picker" ref={rootRef}>
      <button
        type="button"
        className="asset asset--button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Token: ${asset.symbol}. Change token`}
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
      >
        <ChainIcon src={asset.icon} name={asset.symbol} size={30} badge={chain.icon} />
        <span className="asset__text">
          <span className="asset__symbol">{tokenSymbol(value, chain.id)}</span>
          <span className="asset__chain">{chain.name}</span>
        </span>
        <svg className="picker__chevron" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="picker__panel picker__panel--assets">
          <ul className="picker__list" role="listbox" aria-label="Token">
            {ASSET_IDS.map((id) => (
              <li key={id}>
                <button type="button" role="option" aria-selected={id === value} className="picker__option" onClick={() => pick(id)}>
                  <ChainIcon src={ASSETS[id].icon} name={ASSETS[id].symbol} size={28} />
                  <span className="asset-option__text">
                    <span>{ASSETS[id].symbol}</span>
                    <span className="asset-option__rail">{ASSETS[id].rail}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
