import { tokenSymbol } from '../config/assets'
import { chainById } from '../config/chains'
import { transferAsset, type Transfer, type TransferStage } from '../hooks/useTransfers'
import { formatUnits } from '../lib/amount'
import { ChainIcon } from './ChainIcon'

const STAGE_LABEL: Record<TransferStage, string> = {
  approving: 'Approving',
  burning: 'Burning',
  burned: 'Burned',
  attesting: 'Attesting',
  forwarding: 'Minting',
  claimable: 'Claim now',
  claiming: 'Claiming',
  complete: 'Delivered',
  failed: 'Stopped',
}

/** USDT0 doesn't burn-and-attest from the user's point of view: it sends, verifies and delivers. */
const OFT_STAGE_LABEL: Partial<Record<TransferStage, string>> = {
  burning: 'Sending',
  burned: 'Sent',
  attesting: 'Verifying',
  forwarding: 'Delivering',
}

function stageLabel(t: Transfer): string {
  return (t.mode === 'oft' ? OFT_STAGE_LABEL[t.stage] : undefined) ?? STAGE_LABEL[t.stage]
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} h ago`
  return new Date(ts).toLocaleDateString()
}

interface TransferListProps {
  transfers: Transfer[]
  activeId: string | null
  onSelect: (id: string) => void
}

export function TransferList({ transfers, activeId, onSelect }: TransferListProps) {
  return (
    <aside className="history" aria-labelledby="history-title">
      <h2 id="history-title" className="history__title">Your transfers</h2>
      {transfers.length === 0 ? (
        <p className="history__empty">Transfers you send from this browser show up here, with live status until the funds land.</p>
      ) : (
        <ul className="history__list">
          {transfers.map((t) => {
            const source = chainById(t.sourceChainId)
            const destination = chainById(t.destChainId)
            return (
              <li key={t.id}>
                <button
                  type="button"
                  className="history__item"
                  aria-current={t.id === activeId}
                  onClick={() => onSelect(t.id)}
                >
                  <ChainIcon src={destination.icon} name={destination.name} size={30} badge={source.icon} />
                  <span className="history__main">
                    <span className="history__amount">{formatUnits(BigInt(t.amount), 6, 2)} {tokenSymbol(transferAsset(t), source.id)}</span>
                    <span className="history__to">{source.name} to {destination.name}</span>
                  </span>
                  <span className="history__side">
                    <span className="stage" data-stage={t.stage}>{stageLabel(t)}</span>
                    <span className="history__time">{timeAgo(t.createdAt)}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </aside>
  )
}
