import { useEffect, useRef, useState } from 'react'
import { shortAddress } from '../lib/recipient'

export interface WalletOption {
  id: string
  name: string
  icon: string
}

interface WalletModalProps {
  title: string
  options: WalletOption[]
  /** Shown when no wallet of this family is installed. */
  emptyHint: string
  connected: { name: string; address: string } | null
  onPick: (id: string) => Promise<void>
  onDisconnect: () => void
  onClose: () => void
}

/** Native <dialog>: focus trap, Escape and the backdrop come from the browser. */
export function WalletModal({ title, options, emptyHint, connected, onPick, onDisconnect, onClose }: WalletModalProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  const pick = async (id: string) => {
    setError(null)
    setPending(id)
    try {
      await onPick(id)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(/reject|denied|cancel/i.test(message) ? 'You declined the connection in your wallet.' : message)
    } finally {
      setPending(null)
    }
  }

  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="wallet-modal-title"
      onClose={onClose}
      onClick={(e) => {
        // A click on the backdrop lands on the dialog element itself.
        if (e.target === e.currentTarget) ref.current?.close()
      }}
    >
      <div className="modal__body">
        <header className="modal__head">
          <h2 id="wallet-modal-title" className="modal__title">{title}</h2>
          <button type="button" className="modal__close" aria-label="Close" onClick={() => ref.current?.close()}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 3l8 8m0-8-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          </button>
        </header>

        {connected && (
          <div className="modal__connected">
            <span>
              <span className="modal__connected-name">{connected.name}</span>
              <span className="modal__connected-address" title={connected.address}>{shortAddress(connected.address, 6, 6)}</span>
            </span>
            <button type="button" className="chip chip--danger" onClick={onDisconnect}>Disconnect</button>
          </div>
        )}

        {options.length === 0 ? (
          <p className="modal__empty">{emptyHint}</p>
        ) : (
          <ul className="modal__list">
            {options.map((option) => (
              <li key={option.id}>
                <button type="button" className="modal__option" onClick={() => void pick(option.id)} disabled={pending !== null}>
                  {option.icon ? (
                    <img src={option.icon} alt="" width={28} height={28} />
                  ) : (
                    <span className="modal__fallback" aria-hidden="true">{option.name.charAt(0)}</span>
                  )}
                  <span>{option.name}</span>
                  {pending === option.id && <span className="spinner" aria-label="Waiting for the wallet" />}
                </button>
              </li>
            ))}
          </ul>
        )}
        {error && <p className="notice notice--error" role="alert">{error}</p>}
      </div>
    </dialog>
  )
}
