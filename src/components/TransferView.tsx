import { useEffect, useState } from 'react'
import { tokenSymbol } from '../config/assets'
import { chainById, txUrl, type Chain } from '../config/chains'
import { isInFlight, transferAsset, type Transfer } from '../hooks/useTransfers'
import { formatUnits } from '../lib/amount'
import { lzScanUrl } from '../lib/lzscan'
import { shortAddress } from '../lib/recipient'
import { ChainIcon } from './ChainIcon'
import { RouteRail } from './RouteRail'

function useElapsed(since: number, running: boolean): string {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [running])
  const seconds = Math.max(0, Math.floor((now - since) / 1000))
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return m > 0 ? `${m}m ${s.toString().padStart(2, '0')}s` : `${s}s`
}

function oftHeadline(transfer: Transfer, source: Chain, destination: Chain): string {
  switch (transfer.stage) {
    case 'approving': return `Approve the ${tokenSymbol('usdt', source.id)} spend`
    case 'burning': return `Sending on ${source.name}`
    case 'burned': return 'Sent. Waiting for LayerZero'
    case 'attesting': return `Waiting for ${source.name} to finalize`
    case 'forwarding': return `Delivering on ${destination.name}`
    case 'complete': return 'Delivered'
    default: return 'Transfer stopped'
  }
}

function headline(transfer: Transfer, source: Chain, destination: Chain): string {
  if (transfer.mode === 'oft') return oftHeadline(transfer, source, destination)
  switch (transfer.stage) {
    case 'approving': return 'Approve the USDC spend'
    case 'burning': return `Burning on ${source.name}`
    case 'burned': return 'Burned. Waiting for Circle'
    case 'attesting': return transfer.fast ? 'Circle is attesting the burn' : `Waiting for ${source.name} to finalize`
    case 'forwarding': return 'Minting on the destination'
    case 'claimable': return 'Ready to claim on Stellar'
    case 'claiming': return 'Claiming on Stellar'
    case 'complete': return 'Delivered'
    case 'failed': return 'Transfer stopped'
  }
}

function TxLink({ chain, hash }: { chain: Chain; hash: string }) {
  const url = txUrl(chain, hash)
  const label = shortAddress(hash, 6, 6)
  return url ? <a href={url} target="_blank" rel="noreferrer">{label}</a> : <span title={hash}>{label}</span>
}

interface TransferViewProps {
  transfer: Transfer
  onNew: () => void
  /** Null when no Stellar wallet is connected. */
  stellarAddress: string | null
  onConnectStellar: () => void
  onClaim: (transfer: Transfer) => void
  claimError: string | null
}

export function TransferView({ transfer, onNew, stellarAddress, onConnectStellar, onClaim, claimError }: TransferViewProps) {
  const source = chainById(transfer.sourceChainId)
  const destination = chainById(transfer.destChainId)
  const running = isInFlight(transfer.stage)
  const elapsed = useElapsed(transfer.createdAt, running)
  const claimStage = transfer.stage === 'claimable' || transfer.stage === 'claiming'
  const receive = formatUnits(BigInt(transfer.receive), 6, 2)
  const asset = transferAsset(transfer)
  const oft = transfer.mode === 'oft'
  const sentSymbol = tokenSymbol(asset, source.id)
  const receivedSymbol = tokenSymbol(asset, destination.id)

  return (
    <section className="tracker" aria-live="polite">
      <header className="tracker__head">
        <ChainIcon src={destination.icon} name={destination.name} size={40} badge={source.icon} />
        <div>
          <h2 className="tracker__title">{headline(transfer, source, destination)}</h2>
          <p className="tracker__sub">
            {receive} {receivedSymbol} to {shortAddress(transfer.recipient, 6, 4)} on {destination.name}
          </p>
        </div>
      </header>

      <RouteRail
        sourceName={source.name}
        destinationName={destination.name}
        mode={transfer.mode}
        stage={transfer.stage}
        failedAt={transfer.burnTxHash ? 2 : 0}
        symbol={sentSymbol}
      />

      {claimStage && (
        <div className="claim">
          <p className="claim__copy">
            Circle attested the burn. Sign one Stellar transaction to mint {receive} USDC and send it to the recipient.
            Any funded Stellar account can sign, it only pays the XLM fee.
          </p>
          {stellarAddress ? (
            <button type="button" className="cta" onClick={() => onClaim(transfer)} disabled={transfer.stage === 'claiming'} aria-busy={transfer.stage === 'claiming'}>
              {transfer.stage === 'claiming' && <span className="spinner" aria-hidden="true" />}
              {transfer.stage === 'claiming' ? 'Confirm the claim in your wallet' : `Claim ${receive} USDC on Stellar`}
            </button>
          ) : (
            <button type="button" className="cta" onClick={onConnectStellar}>Connect a Stellar wallet to claim</button>
          )}
          {claimError && <p className="notice notice--error" role="alert">{claimError}</p>}
        </div>
      )}

      {transfer.error && <p className="notice notice--error" role="alert">{transfer.error}</p>}
      {transfer.stage === 'failed' && transfer.burnTxHash && oft && (
        <p className="notice">
          The send went through on {source.name}, but LayerZero couldn't deliver it yet. Delivery can be retried
          on the destination; LayerZero Scan has the message and its status.
        </p>
      )}
      {transfer.stage === 'failed' && transfer.burnTxHash && !oft && (
        <p className="notice">
          The burn went through, so the funds are safe in CCTP. Look up the burn below. The mint can still be
          completed with the message and attestation from Circle.
        </p>
      )}

      <dl className="costs costs--tracker">
        <div><dt>Sent</dt><dd>{formatUnits(BigInt(transfer.amount), 6, 2)} {sentSymbol}</dd></div>
        {oft ? (
          <div><dt>Route</dt><dd>USDT0 over LayerZero</dd></div>
        ) : (
          <div><dt>Speed</dt><dd>{transfer.fast ? 'Fast' : 'Standard'}</dd></div>
        )}
        <div><dt>Time</dt><dd>{elapsed}</dd></div>
        <div>
          <dt>{source.name} {oft ? 'send' : 'burn'}</dt>
          <dd>{transfer.burnTxHash ? <TxLink chain={source} hash={transfer.burnTxHash} /> : 'Waiting for signature'}</dd>
        </div>
        <div>
          <dt>{destination.name} {transfer.mode === 'stellar-claim' ? 'claim' : oft ? 'delivery' : 'mint'}</dt>
          <dd>{transfer.destTxHash ? <TxLink chain={destination} hash={transfer.destTxHash} /> : '—'}</dd>
        </div>
        {oft && transfer.burnTxHash && (
          <div>
            <dt>LayerZero Scan</dt>
            <dd><a href={lzScanUrl(transfer.burnTxHash)} target="_blank" rel="noreferrer">Track the message</a></dd>
          </div>
        )}
      </dl>

      <button type="button" className={running ? 'cta cta--quiet' : 'cta'} onClick={onNew}>
        {running ? 'Start another transfer' : 'New transfer'}
      </button>
      {running && (
        <p className="tracker__foot">
          {transfer.mode === 'stellar-claim'
            ? 'You can close this tab. The claim waits in your transfer list until you come back.'
            : oft
              ? 'You can close this tab. LayerZero delivers it either way, and this page picks the status back up when you return.'
              : 'You can close this tab. Circle finishes the mint either way, and this page picks the status back up when you return.'}
        </p>
      )}
    </section>
  )
}
