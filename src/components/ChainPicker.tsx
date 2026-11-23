import { useEffect, useMemo, useRef, useState } from 'react'
import type { Chain } from '../config/chains'
import { ChainIcon } from './ChainIcon'

interface ChainPickerProps {
  value: Chain
  chains: Chain[]
  onChange: (chain: Chain) => void
  /** Accessible name, e.g. "Source chain". */
  label: string
  disabled?: boolean
  /** Small trailing text per option (CCTP domain, LayerZero endpoint id). */
  optionDetail?: (chain: Chain) => string | null
}

export function ChainPicker({ value, chains, onChange, label, disabled = false, optionDetail }: ChainPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    searchRef.current?.focus()
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

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return chains
    return chains.filter((c) => c.name.toLowerCase().includes(q))
  }, [query, chains])

  const pick = (chain: Chain) => {
    onChange(chain)
    setOpen(false)
    setQuery('')
  }

  return (
    <div className="picker" ref={rootRef}>
      <button
        type="button"
        className="picker__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${value.name}`}
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
      >
        <ChainIcon src={value.icon} name={value.name} size={26} />
        <span className="picker__name">{value.name}</span>
        <svg className="picker__chevron" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="picker__panel">
          <input
            ref={searchRef}
            className="picker__search"
            placeholder="Search chains"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={`Search ${label.toLowerCase()}s`}
          />
          <ul className="picker__list" role="listbox" aria-label={label}>
            {results.map((chain) => (
              <li key={chain.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={chain.id === value.id}
                  className="picker__option"
                  onClick={() => pick(chain)}
                >
                  <ChainIcon src={chain.icon} name={chain.name} size={24} />
                  <span>{chain.name}</span>
                  {optionDetail?.(chain) && <span className="picker__domain">{optionDetail(chain)}</span>}
                </button>
              </li>
            ))}
            {results.length === 0 && <li className="picker__empty">No chain matches “{query}”</li>}
          </ul>
        </div>
      )}
    </div>
  )
}
