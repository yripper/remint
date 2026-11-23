import type { TransferStage } from '../hooks/useTransfers'
import type { MintMode } from '../lib/iris'

type StepState = 'waiting' | 'active' | 'done' | 'failed'

interface RailStep {
  key: 'burn' | 'attest' | 'mint'
  label: string
  hint: string
  state: StepState
}

const ORDER: Record<TransferStage, number> = {
  approving: 0,
  burning: 0,
  burned: 1,
  attesting: 1,
  forwarding: 2,
  claimable: 2,
  claiming: 2,
  complete: 3,
  failed: -1,
}

function stateFor(index: number, stage: TransferStage | null, failedAt: number): StepState {
  if (stage === null) return 'waiting'
  if (stage === 'failed') {
    if (index < failedAt) return 'done'
    return index === failedAt ? 'failed' : 'waiting'
  }
  const current = ORDER[stage]
  if (index < current) return 'done'
  return index === current ? 'active' : 'waiting'
}

interface RouteRailProps {
  sourceName: string
  destinationName: string
  mode: MintMode
  stage: TransferStage | null
  /** Which step a failed transfer died on (0 burn, 1 attest, 2 mint). */
  failedAt?: number
  compact?: boolean
  /** Token the user sends on the source chain, e.g. USDC, USDT, USDT0. */
  symbol?: string
}

type StepCopy = Pick<RailStep, 'label' | 'hint'>

function copyFor(mode: MintMode, sourceName: string, destinationName: string, symbol: string, approving: boolean): [StepCopy, StepCopy, StepCopy] {
  if (mode === 'oft') {
    return [
      approving
        ? { label: `Approve ${symbol}`, hint: `Allow USDT0 to move this amount` }
        : { label: `Send on ${sourceName}`, hint: `${symbol} leaves your ${sourceName} wallet` },
      { label: 'LayerZero verifies', hint: 'Three independent verifiers confirm the message' },
      { label: `Deliver on ${destinationName}`, hint: 'LayerZero delivers it for you' },
    ]
  }
  const claim = mode === 'stellar-claim'
  return [
    approving
      ? { label: `Approve ${symbol}`, hint: 'Allow CCTP to burn this amount' }
      : { label: `Burn on ${sourceName}`, hint: `${symbol} leaves your ${sourceName} wallet` },
    { label: 'Circle attests', hint: 'Circle signs the burn message' },
    claim
      ? { label: 'Claim on Stellar', hint: 'You sign one Stellar transaction' }
      : { label: `Mint on ${destinationName}`, hint: 'Circle submits the mint for you' },
  ]
}

/**
 * The burn → attest → mint path (send → verify → deliver for USDT0). Idle it explains the route; during a transfer
 * it is the progress tracker.
 */
export function RouteRail({ sourceName, destinationName, mode, stage, failedAt = 0, compact = false, symbol = 'USDC' }: RouteRailProps) {
  const [send, verify, deliver] = copyFor(mode, sourceName, destinationName, symbol, stage === 'approving')
  const steps: RailStep[] = [
    { key: 'burn', ...send, state: stateFor(0, stage, failedAt) },
    { key: 'attest', ...verify, state: stateFor(1, stage, failedAt) },
    { key: 'mint', ...deliver, state: stateFor(2, stage, failedAt) },
  ]

  return (
    <ol className={`rail${compact ? ' rail--compact' : ''}`} aria-label="Transfer route">
      {steps.map((step) => (
        <li key={step.key} className={`rail__step rail__step--${step.key}`} data-state={step.state}>
          <span className="rail__node" aria-hidden="true">
            {step.state === 'done' && (
              <svg viewBox="0 0 12 12" width="10" height="10"><path d="M2.5 6.2 5 8.5l4.5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            )}
            {step.state === 'failed' && (
              <svg viewBox="0 0 12 12" width="10" height="10"><path d="M3.5 3.5l5 5m0-5-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            )}
          </span>
          <span className="rail__text">
            <span className="rail__label">{step.label}</span>
            {!compact && <span className="rail__hint">{step.hint}</span>}
          </span>
          <span className="visually-hidden">{step.state}</span>
        </li>
      ))}
    </ol>
  )
}
