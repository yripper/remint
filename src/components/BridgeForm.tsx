import { tokenSymbol, type AssetId } from '../config/assets'
import type { Chain } from '../config/chains'
import { USDT0 } from '../config/usdt0'
import type { BridgeStep } from '../hooks/useBridgeAction'
import type { RouteQuoteState } from '../hooks/useRouteQuote'
import type { SourceBalanceState } from '../hooks/useSourceBalance'
import type { UsdtQuoteState } from '../hooks/useUsdtQuote'
import { formatSignificant, formatUnits, sanitizeAmountInput, unitsToInput } from '../lib/amount'
import { protocolFee } from '../lib/fees'
import { feeBps, scaleReceived } from '../lib/oft'
import { costsFor, type Costs, type UsdtRouteInfo } from '../lib/quote'
import { isValidRecipientFor, shortAddress } from '../lib/recipient'
import { AssetPicker } from './AssetPicker'
import { ChainPicker } from './ChainPicker'
import { RouteRail } from './RouteRail'

interface BridgeFormProps {
  asset: AssetId
  onAsset: (asset: AssetId) => void
  source: Chain
  destination: Chain
  /** Chains this asset can be sent from, and reached from `source`. */
  sources: Chain[]
  destinations: Chain[]
  onSource: (chain: Chain) => void
  onDestination: (chain: Chain) => void
  onSwap: () => void
  /** False when the reverse route doesn't exist for this asset (e.g. USDT out of Solana). */
  canSwap: boolean
  /** Connected address for the source chain's wallet family. */
  owner: string | null
  balance: SourceBalanceState
  /** Which field the user typed in; the other one is computed from the quote. */
  side: 'send' | 'receive'
  amountInput: string
  onAmountInput: (value: string) => void
  /** Exact out: the amount that must land. */
  receiveInput: string
  onReceiveInput: (value: string) => void
  /** What gets sent: typed, or worked back from `receiveInput`. */
  amount: bigint | null
  recipient: string
  onRecipient: (value: string) => void
  /** Fills the recipient from the user's own wallet on the destination family, connecting it if needed. */
  onRecipientFromWallet: () => void
  fast: boolean
  onFast: (fast: boolean) => void
  quote: RouteQuoteState
  usdtQuote: UsdtQuoteState
  step: BridgeStep
  error: string | null
  onConnectSource: () => void
  onSubmit: () => void
}

interface Cta {
  label: string
  disabled: boolean
  action: 'connect' | 'submit' | 'none'
}

/** What the form needs from whichever rail the asset uses. */
interface Summary {
  receive: bigint | null
  loading: boolean
  error: string | null
  ready: boolean
  stellarRecipientReady?: boolean
  /** USDT only: route limits from quoteOFT. */
  minAmount?: bigint
  maxAmount?: bigint
}

const RECIPIENT_PLACEHOLDER: Record<Chain['kind'], string> = {
  evm: '0x…',
  solana: 'Solana wallet address',
  stellar: 'G… or C… address',
}

function recipientError(asset: AssetId, kind: Chain['kind']): string {
  if (kind === 'evm') return 'Enter a 0x address with 40 hex characters'
  if (kind === 'solana') return 'Enter a valid Solana address'
  if (asset === 'usdt') return "Enter a Stellar account (G…). USDT0 can't deliver to M… or C… addresses"
  return 'Enter a valid Stellar account (G…, M…) or contract (C…)'
}

/** Route limits read better as whole tokens; rounding down keeps the shown cap honest. */
function wholeUnits(units: bigint): string {
  return formatUnits(units - (units % 1_000_000n), 6, 0)
}

/** A computed amount shown in an editable field: no grouping, so editing it parses cleanly. */
function fieldUnits(units: bigint | null): string {
  return units !== null && units > 0n ? formatUnits(units, 6, 2).replace(/,/g, '') : ''
}

function nativeCurrency(chain: Chain): { symbol: string; decimals: number } {
  if (chain.kind === 'stellar') return { symbol: 'XLM', decimals: 7 }
  if (chain.kind === 'solana') return { symbol: 'SOL', decimals: 9 }
  return chain.evm?.nativeCurrency ?? { symbol: 'ETH', decimals: 18 }
}

function summarize(props: BridgeFormProps, costs: Costs | null): Summary {
  const { asset, amount, quote, usdtQuote } = props
  if (asset === 'usdc') {
    return {
      receive: costs?.receive ?? null,
      loading: quote.loading,
      error: quote.error,
      ready: quote.data !== null && costs !== null,
      stellarRecipientReady: quote.data?.stellarRecipientReady,
    }
  }
  const data = usdtQuote.data
  return {
    receive: data && amount && amount > 0n ? scaleReceived(data.quote, amount) : null,
    loading: usdtQuote.loading,
    error: usdtQuote.error,
    ready: data !== null,
    stellarRecipientReady: data?.stellarRecipientReady,
    minAmount: data?.quote.minAmount,
    maxAmount: data?.quote.maxAmount,
  }
}

function ctaFor(props: BridgeFormProps, recipientValid: boolean, summary: Summary): Cta {
  const { owner, balance, amount, step, source, destination, asset } = props
  const symbol = tokenSymbol(asset, source.id)
  if (step === 'quoting') return { label: 'Getting a fresh quote…', disabled: true, action: 'none' }
  if (step === 'switching') return { label: `Switch to ${source.name} in your wallet`, disabled: true, action: 'none' }
  if (step === 'approve') return { label: `Approve ${symbol} in your wallet (1 of 2)`, disabled: true, action: 'none' }
  if (step === 'burn') return { label: asset === 'usdt' ? 'Confirm the transfer in your wallet' : 'Confirm the burn in your wallet', disabled: true, action: 'none' }
  if (!owner) return { label: `Connect your ${source.name} wallet`, disabled: false, action: 'connect' }
  if (balance.balance && !balance.balance.hasTrustline) return { label: `Add a ${symbol} trustline to this account first`, disabled: true, action: 'none' }
  if (amount === null || amount <= 0n) return { label: 'Enter an amount', disabled: true, action: 'none' }
  if (balance.balance && amount > balance.balance.units) return { label: `Not enough ${symbol} on ${source.name}`, disabled: true, action: 'none' }
  if (!recipientValid) return { label: `Enter a ${destination.name} address`, disabled: true, action: 'none' }
  if (summary.error) return { label: 'Route unavailable right now', disabled: true, action: 'none' }
  if (!summary.ready || summary.receive === null) return { label: 'Getting quote…', disabled: true, action: 'none' }
  if (summary.stellarRecipientReady === false) {
    return { label: `Recipient needs a ${tokenSymbol(asset, 'stellar')} trustline`, disabled: true, action: 'none' }
  }
  if (summary.maxAmount !== undefined && amount > summary.maxAmount) {
    return { label: `This route takes up to ${wholeUnits(summary.maxAmount)} right now`, disabled: true, action: 'none' }
  }
  if (summary.minAmount !== undefined && amount < summary.minAmount) {
    return { label: `This route needs at least ${formatUnits(summary.minAmount)}`, disabled: true, action: 'none' }
  }
  if (summary.receive <= 0n) return { label: 'Amount must cover the fees', disabled: true, action: 'none' }
  return { label: `Bridge to ${destination.name}`, disabled: false, action: 'submit' }
}

function protocolFeeLabel(costs: Costs, amount: bigint): string {
  if (costs.quote.protocolBps === 0) return 'Free'
  return `${formatUnits(protocolFee(amount, costs.quote.protocolBps), 6, 2)} USDC (${costs.quote.protocolBps} bps)`
}

function UsdcCosts({ props, costs }: { props: BridgeFormProps; costs: Costs | null }) {
  const { source, destination, amount, quote } = props
  const claim = destination.kind === 'stellar'
  return (
    <dl className="costs">
      {!claim && (
        <div>
          <dt>Circle mint fee</dt>
          <dd>{costs ? `${formatUnits(costs.quote.forwardFee, 6, 2)} USDC` : '—'}</dd>
        </div>
      )}
      <div>
        <dt>Protocol fee</dt>
        <dd>{costs && amount ? protocolFeeLabel(costs, amount) : '—'}</dd>
      </div>
      <div>
        <dt>Network fee on {source.name}</dt>
        <dd>Paid in {nativeCurrency(source).symbol} by your wallet</dd>
      </div>
      <div>
        <dt>{claim ? 'Claim on Stellar' : `Gas on ${destination.name}`}</dt>
        <dd>{claim ? 'You sign it, a small XLM fee' : 'None, Circle submits the mint'}</dd>
      </div>
      {quote.data?.solanaAta && (
        <div>
          <dt>USDC account</dt>
          <dd title={quote.data.solanaAta}>
            {shortAddress(quote.data.solanaAta, 5, 5)}
            {quote.data.solanaAtaExists === false ? ' (Circle creates it)' : ''}
          </dd>
        </div>
      )}
    </dl>
  )
}

function UsdtCosts({ props, data }: { props: BridgeFormProps; data: UsdtRouteInfo | null }) {
  const { source, destination, amount } = props
  const native = nativeCurrency(source)
  const bps = data ? feeBps(data.quote) : null
  const fee = data && amount && amount > 0n ? amount - scaleReceived(data.quote, amount) : null
  const legacy = data?.route.kind === 'legacy'
  return (
    <dl className="costs">
      <div>
        <dt>USDT0 fee</dt>
        <dd>{bps === null ? '—' : bps === 0 ? 'None' : fee !== null ? `${formatUnits(fee)} USDT (${bps / 100}%)` : `${bps / 100}%`}</dd>
      </div>
      <div>
        <dt>LayerZero fee</dt>
        <dd>{data ? `~${formatSignificant(data.quote.nativeFee, native.decimals)} ${native.symbol}, from your wallet` : '—'}</dd>
      </div>
      <div>
        <dt>Network fee on {source.name}</dt>
        <dd>Paid in {native.symbol} by your wallet</dd>
      </div>
      <div>
        <dt>Gas on {destination.name}</dt>
        <dd>None, LayerZero delivers it</dd>
      </div>
      <div>
        <dt>Arrives as</dt>
        <dd>{tokenSymbol('usdt', destination.id)}{legacy ? ' via the Legacy Mesh' : ''}</dd>
      </div>
      {legacy && data && (
        <div>
          <dt>Route limit</dt>
          <dd>{wholeUnits(data.quote.maxAmount)} USDT right now</dd>
        </div>
      )}
    </dl>
  )
}

export function BridgeForm(props: BridgeFormProps) {
  const { asset, source, destination, owner, balance, side, amountInput, receiveInput, amount, recipient, quote, step, error, fast } = props
  const recipientValid = isValidRecipientFor(asset, destination.kind, recipient)
  const recipientTouched = recipient.trim().length > 0
  const busy = step !== 'idle'
  const claim = asset === 'usdc' && destination.kind === 'stellar'
  const data = quote.data
  const costs = asset === 'usdc' && data && amount !== null && amount > 0n ? costsFor(data, source, fast, amount) : null
  const summary = summarize(props, costs)
  const cta = ctaFor(props, recipientValid, summary)
  const fastOffered = asset === 'usdc' && source.fastSource && data?.quotes.fast !== null && data?.quotes.fast !== undefined
  const symbol = tokenSymbol(asset, source.id)
  const destSymbol = tokenSymbol(asset, destination.id)

  const onAmountChange = (raw: string) => {
    const next = sanitizeAmountInput(raw)
    if (next !== null) props.onAmountInput(next)
  }

  const onReceiveChange = (raw: string) => {
    const next = sanitizeAmountInput(raw)
    if (next !== null) props.onReceiveInput(next)
  }

  const quoting = summary.loading || !summary.ready
  const sendValue = side === 'send' ? amountInput : fieldUnits(amount)
  const receiveValue = side === 'receive' ? receiveInput : fieldUnits(summary.receive)

  const onCta = () => {
    if (cta.action === 'connect') props.onConnectSource()
    if (cta.action === 'submit') props.onSubmit()
  }

  const optionDetail =
    asset === 'usdc'
      ? (c: Chain) => `domain ${c.domain}`
      : (c: Chain) => (USDT0[c.id] && !USDT0[c.id].oft ? 'Legacy Mesh' : null)

  return (
    <form
      className="bridge"
      onSubmit={(e) => {
        e.preventDefault()
        onCta()
      }}
    >
      <section className="leg leg--from" aria-labelledby="from-title">
        <header className="leg__head">
          <h2 id="from-title" className="leg__title">From</h2>
          <ChainPicker value={source} chains={props.sources} onChange={props.onSource} label="Source chain" disabled={busy} optionDetail={optionDetail} />
        </header>
        <div className="leg__row">
          <input
            className="amount"
            inputMode="decimal"
            autoComplete="off"
            placeholder={side === 'receive' && receiveInput && quoting ? '…' : '0.00'}
            aria-label={`Amount of ${symbol} to send`}
            value={sendValue}
            onChange={(e) => onAmountChange(e.target.value)}
            disabled={busy}
          />
          <AssetPicker value={asset} chain={source} onChange={props.onAsset} disabled={busy} />
        </div>
        <div className="leg__foot">
          {owner ? (
            <span className="leg__meta">
              {balance.loading && !balance.balance ? 'Reading balance…' : balance.balance ? (
                <>
                  Balance <strong>{formatUnits(balance.balance.units)}</strong>
                  <button
                    type="button"
                    className="chip"
                    onClick={() => balance.balance && props.onAmountInput(unitsToInput(balance.balance.units))}
                    disabled={busy || balance.balance.units === 0n}
                  >
                    Max
                  </button>
                </>
              ) : balance.error ? 'Balance unavailable' : null}
            </span>
          ) : (
            <button type="button" className="chip" onClick={props.onConnectSource}>Connect your {source.name} wallet</button>
          )}
          {owner && <span className="leg__owner" title={owner}>{shortAddress(owner, 4, 4)}</span>}
        </div>
      </section>

      <div className="bridge__route">
        <button
          type="button"
          className="swap"
          onClick={props.onSwap}
          disabled={busy || !props.canSwap}
          aria-label={`Swap direction: send from ${destination.name} to ${source.name}`}
          title={props.canSwap ? undefined : `Sending ${symbol} from ${destination.name} isn't supported yet`}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M5 2v11m0 0-3-3m3 3 3-3M11 14V3m0 0 3 3m-3-3L8 6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <RouteRail
          sourceName={source.name}
          destinationName={destination.name}
          mode={asset === 'usdt' ? 'oft' : claim ? 'stellar-claim' : 'forward'}
          stage={null}
          symbol={symbol}
          compact
        />
      </div>

      <section className="leg leg--to" aria-labelledby="to-title">
        <header className="leg__head">
          <h2 id="to-title" className="leg__title">To</h2>
          <ChainPicker value={destination} chains={props.destinations} onChange={props.onDestination} label="Destination chain" disabled={busy} optionDetail={optionDetail} />
        </header>

        <label className="receive">
          <span className="receive__label">You receive</span>
          <span className="receive__value">
            <input
              className="receive__input"
              inputMode="decimal"
              autoComplete="off"
              placeholder={side === 'send' && amount && summary.loading ? '…' : '0.00'}
              aria-label={`Amount of ${destSymbol} to receive`}
              value={receiveValue}
              onChange={(e) => onReceiveChange(e.target.value)}
              disabled={busy}
            />
            <span className="receive__unit">{destSymbol}</span>
          </span>
        </label>

        <label className="recipient">
          <span className="recipient__label">Recipient on {destination.name}</span>
          <span className={`recipient__field${recipientTouched && !recipientValid ? ' is-invalid' : ''}`}>
            <input
              value={recipient}
              onChange={(e) => props.onRecipient(e.target.value)}
              placeholder={asset === 'usdt' && destination.kind === 'stellar' ? 'G… address' : RECIPIENT_PLACEHOLDER[destination.kind]}
              spellCheck={false}
              autoComplete="off"
              disabled={busy}
              aria-invalid={recipientTouched && !recipientValid}
            />
            <button type="button" className="chip" onClick={props.onRecipientFromWallet} disabled={busy}>
              Use my wallet
            </button>
          </span>
          {recipientTouched && !recipientValid && <span className="field-error">{recipientError(asset, destination.kind)}</span>}
          {recipientValid && summary.stellarRecipientReady === false && (
            <span className="field-error">
              This account has no {destSymbol} trustline, so it can't receive {destSymbol} yet. Add one in a Stellar wallet first.
            </span>
          )}
        </label>
      </section>

      {fastOffered && data?.quotes.fast && (
        <fieldset className="speed" disabled={busy}>
          <legend className="visually-hidden">Transfer speed</legend>
          <label className="speed__option">
            <input type="radio" name="speed" checked={!fast} onChange={() => props.onFast(false)} />
            <span className="speed__name">Standard</span>
            <span className="speed__detail">
              {data.quotes.standard.protocolBps === 0 ? 'No protocol fee' : `${data.quotes.standard.protocolBps} bps`}. Waits for {source.name} to finalize.
            </span>
          </label>
          <label className="speed__option">
            <input type="radio" name="speed" checked={fast} onChange={() => props.onFast(true)} />
            <span className="speed__name">Fast</span>
            <span className="speed__detail">
              {amount && amount > 0n
                ? `${formatUnits(protocolFee(amount, data.quotes.fast.protocolBps), 6, 2)} USDC fee`
                : `${data.quotes.fast.protocolBps} bps fee`}. Lands in about a minute.
            </span>
          </label>
        </fieldset>
      )}

      {asset === 'usdc' ? <UsdcCosts props={props} costs={costs} /> : <UsdtCosts props={props} data={props.usdtQuote.data} />}

      {summary.error && <p className="notice notice--error" role="alert">{summary.error}</p>}
      {error && <p className="notice notice--error" role="alert">{error}</p>}
      {claim && (
        <p className="notice">
          Circle can't deliver to Stellar by itself. Once the burn is attested, this page asks you to claim the USDC on
          Stellar with one signature. Any funded Stellar account can sign it.
        </p>
      )}
      {asset === 'usdt' && destination.kind === 'solana' && (
        <p className="notice">
          Solana keeps Tether's own USDT. The USDT0 Legacy Mesh pays it out from a pool on Solana, for a 0.03% fee.
        </p>
      )}
      <p className="notice">Transfers can't be reversed. Check the recipient before you confirm.</p>

      <button type="submit" className="cta" disabled={cta.disabled} aria-busy={busy}>
        {busy && <span className="spinner" aria-hidden="true" />}
        {cta.label}
      </button>
    </form>
  )
}
