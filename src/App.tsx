import { useCallback, useEffect, useMemo, useState } from 'react'
import { BridgeForm } from './components/BridgeForm'
import { Header, type WalletPill } from './components/Header'
import { TransferList } from './components/TransferList'
import { TransferView } from './components/TransferView'
import { WalletModal, type WalletOption } from './components/WalletModal'
import { destinationChains, fitRoute, isAssetId, routeSupported, sourceChains, type AssetId } from './config/assets'
import { CHAINS, chainById, type Chain, type ChainKind } from './config/chains'
import { useBridgeAction, useStellarClaim, type Signers } from './hooks/useBridgeAction'
import { useEvmWallet } from './hooks/useEvmWallet'
import { useRouteQuote } from './hooks/useRouteQuote'
import { useSolanaWallet } from './hooks/useSolanaWallet'
import { useSourceBalance } from './hooks/useSourceBalance'
import { useStellarWallet } from './hooks/useStellarWallet'
import { useTransfers } from './hooks/useTransfers'
import { useUsdtQuote } from './hooks/useUsdtQuote'
import { parseUnits } from './lib/amount'
import { sendForReceive } from './lib/quote'
import { readPref, writePref } from './lib/prefs'

interface RoutePref {
  asset: AssetId
  sourceId: string
  destId: string
  fast: boolean
}

const ROUTE_KEY = 'cctp.route'
const DEFAULT_ROUTE: RoutePref = { asset: 'usdc', sourceId: 'stellar', destId: 'base', fast: false }

function loadRoute(): RoutePref {
  try {
    const parsed = JSON.parse(readPref(ROUTE_KEY) ?? 'null') as Partial<RoutePref> | null
    const known = (id: unknown): id is string => typeof id === 'string' && CHAINS.some((c) => c.id === id)
    if (parsed && known(parsed.sourceId) && known(parsed.destId)) {
      // Routes saved before the asset switch existed are USDC.
      const asset = isAssetId(parsed.asset) ? parsed.asset : 'usdc'
      return { asset, ...fitRoute(asset, { sourceId: parsed.sourceId, destId: parsed.destId }), fast: parsed.fast === true }
    }
  } catch {
    // Fall through to the default route.
  }
  return DEFAULT_ROUTE
}

/** Which amount the user typed: the one sent, or (exact out) the one that must land. */
type AmountSide = 'send' | 'receive'

type ModalFamily = Exclude<ChainKind, 'stellar'>

interface ModalState {
  family: ModalFamily
  /** Opened from "Use my wallet": fill the recipient once connected. */
  fillRecipient: boolean
}

const FAMILY_TITLE: Record<ModalFamily, string> = {
  evm: 'Connect an EVM wallet',
  solana: 'Connect a Solana wallet',
}

const FAMILY_EMPTY: Record<ModalFamily, string> = {
  evm: 'No EVM wallet found in this browser. Install MetaMask, Rabby or Coinbase Wallet, then reload the page.',
  solana: 'No Solana wallet found in this browser. Install Phantom, Solflare or Backpack, then reload the page.',
}

export default function App() {
  const stellar = useStellarWallet()
  const evm = useEvmWallet()
  const solana = useSolanaWallet()
  const store = useTransfers()

  const [route, setRoute] = useState<RoutePref>(loadRoute)
  const [amountInput, setAmountInput] = useState('')
  const [receiveInput, setReceiveInput] = useState('')
  const [side, setSide] = useState<AmountSide>('send')
  // Recipients are kept per address format, so one EVM address carries across EVM chains.
  const [recipients, setRecipients] = useState<Partial<Record<ChainKind, string>>>({})
  const [activeId, setActiveId] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalState | null>(null)

  useEffect(() => writePref(ROUTE_KEY, JSON.stringify(route)), [route])

  const asset = route.asset
  const source = chainById(route.sourceId)
  const destination = chainById(route.destId)

  const addressFor = useCallback(
    (kind: ChainKind): string | null => {
      if (kind === 'stellar') return stellar.address
      if (kind === 'evm') return evm.connection?.address ?? null
      return solana.connection?.address ?? null
    },
    [stellar.address, evm.connection, solana.connection],
  )

  const owner = addressFor(source.kind)
  const recipient = recipients[destination.kind] ?? ''
  const setRecipient = useCallback((kind: ChainKind, value: string) => {
    setRecipients((prev) => ({ ...prev, [kind]: value }))
  }, [])

  const typedAmount = useMemo(() => parseUnits(amountInput), [amountInput])
  const receiveTarget = useMemo(() => (side === 'receive' ? parseUnits(receiveInput) : null), [side, receiveInput])
  const fast = asset === 'usdc' && route.fast
  const balance = useSourceBalance(asset, source, owner)
  // Both hooks always run (hook rules); each idles when its asset isn't selected.
  const quote = useRouteQuote(source, destination, recipient, asset === 'usdc')
  // OFT fees are linear, so in exact-out mode quoting at the target size is close enough to size the send.
  const quoteAmount = side === 'send' ? typedAmount : receiveTarget
  const usdtQuote = useUsdtQuote({ enabled: asset === 'usdt', source, destination, recipient, amount: quoteAmount, owner })
  const amount =
    side === 'send' || receiveTarget === null || receiveTarget <= 0n
      ? side === 'send' ? typedAmount : receiveTarget
      : sendForReceive(asset, receiveTarget, quote.data, usdtQuote.data, source, fast)

  const typeSend = useCallback((value: string) => {
    setAmountInput(value)
    setSide('send')
  }, [])
  const typeReceive = useCallback((value: string) => {
    setReceiveInput(value)
    setSide('receive')
  }, [])

  const signers: Signers = useMemo(
    () => ({ stellar: { address: stellar.address, sign: stellar.sign }, evm: evm.connection, solana: solana.connection }),
    [stellar.address, stellar.sign, evm.connection, solana.connection],
  )

  const refreshBalance = balance.refresh
  const onBurned = useCallback(() => {
    setAmountInput('')
    setReceiveInput('')
    setSide('send')
    refreshBalance()
  }, [refreshBalance])

  const bridge = useBridgeAction({ store, signers, onBurned })
  const claim = useStellarClaim(store, signers.stellar)
  const active = store.transfers.find((t) => t.id === activeId) ?? null

  const connectFamily = (kind: ChainKind, fillRecipient: boolean = false) => {
    if (kind === 'stellar') {
      stellar
        .connect()
        .then((address) => {
          if (fillRecipient) setRecipient('stellar', address)
        })
        .catch(() => {
          // Closing the Stellar modal is not an error worth surfacing.
        })
      return
    }
    setModal({ family: kind, fillRecipient })
  }

  const fillRecipientFromWallet = () => {
    const own = addressFor(destination.kind)
    if (own) setRecipient(destination.kind, own)
    else connectFamily(destination.kind, true)
  }

  /** Switching USDC ↔ USDT keeps the route where it can; otherwise Ethereum and a reachable destination. */
  const chooseAsset = (next: AssetId) => {
    setRoute((prev) => (prev.asset === next ? prev : { ...prev, asset: next, ...fitRoute(next, prev) }))
  }

  const chooseSource = (chain: Chain) => {
    setRoute((prev) => {
      // Picking the destination as the source flips the route instead of making it invalid.
      const flipped = chain.id === prev.destId && routeSupported(prev.asset, chain.id, prev.sourceId)
      const next = flipped ? { sourceId: chain.id, destId: prev.sourceId } : { sourceId: chain.id, destId: prev.destId }
      return { ...prev, ...fitRoute(prev.asset, next) }
    })
  }

  const canSwap = routeSupported(asset, destination.id, source.id)
  const swap = () => {
    if (canSwap) setRoute((prev) => ({ ...prev, sourceId: prev.destId, destId: prev.sourceId }))
  }

  const submit = async () => {
    if (amount === null) return
    const receive = side === 'receive' && receiveTarget !== null ? receiveTarget : undefined
    const id = await bridge.run({ asset, source, destination, amount, recipient, fast, receive })
    if (id) setActiveId(id)
  }

  const pills: WalletPill[] = []
  if (stellar.address) pills.push({ family: 'stellar', name: 'Stellar wallet', address: stellar.address })
  if (evm.connection) {
    pills.push({ family: 'evm', name: evm.connection.wallet.info.name, icon: evm.connection.wallet.info.icon, address: evm.connection.address })
  }
  if (solana.connection) {
    pills.push({ family: 'solana', name: solana.connection.wallet.name, icon: solana.connection.wallet.icon, address: solana.connection.address })
  }

  const onPill = (family: ChainKind) => {
    if (family === 'stellar') void stellar.openProfile()
    else setModal({ family, fillRecipient: false })
  }

  const modalOptions: WalletOption[] =
    modal?.family === 'evm'
      ? evm.wallets.map((w) => ({ id: w.info.rdns, name: w.info.name, icon: w.info.icon }))
      : solana.wallets.map((w) => ({ id: w.name, name: w.name, icon: w.icon }))

  const modalConnected =
    modal?.family === 'evm'
      ? evm.connection && { name: evm.connection.wallet.info.name, address: evm.connection.address }
      : solana.connection && { name: solana.connection.wallet.name, address: solana.connection.address }

  const pickWallet = async (id: string) => {
    if (!modal) return
    let address: string
    if (modal.family === 'evm') {
      const wallet = evm.wallets.find((w) => w.info.rdns === id)
      if (!wallet) throw new Error('That wallet is no longer available')
      address = await evm.connect(wallet)
    } else {
      const wallet = solana.wallets.find((w) => w.name === id)
      if (!wallet) throw new Error('That wallet is no longer available')
      address = await solana.connect(wallet)
    }
    if (modal.fillRecipient) setRecipient(modal.family, address)
    setModal(null)
  }

  return (
    <div className="shell">
      <Header pills={pills} onPill={onPill} onConnect={() => connectFamily(source.kind)} />

      <main className="layout">
        <div className="intro">
          <h1 className="intro__title">Move USDC and USDT between chains</h1>
          <p className="intro__copy">
            USDC moves with Circle CCTP, USDT with USDT0 over LayerZero. Both land without gas on the other side,
            except USDC into Stellar, which you claim with one signature.
          </p>
        </div>

        <div className="card">
          {active ? (
            <TransferView
              transfer={active}
              onNew={() => setActiveId(null)}
              stellarAddress={stellar.address}
              onConnectStellar={() => connectFamily('stellar')}
              onClaim={(t) => void claim.claim(t)}
              claimError={claim.error?.id === active.id ? claim.error.message : null}
            />
          ) : (
            <BridgeForm
              asset={asset}
              onAsset={chooseAsset}
              source={source}
              destination={destination}
              sources={sourceChains(asset)}
              destinations={destinationChains(asset, source)}
              onSource={chooseSource}
              onDestination={(chain) => setRoute((prev) => ({ ...prev, destId: chain.id }))}
              onSwap={swap}
              canSwap={canSwap}
              owner={owner}
              balance={balance}
              side={side}
              amountInput={amountInput}
              onAmountInput={typeSend}
              receiveInput={receiveInput}
              onReceiveInput={typeReceive}
              amount={amount}
              recipient={recipient}
              onRecipient={(value) => setRecipient(destination.kind, value)}
              onRecipientFromWallet={fillRecipientFromWallet}
              fast={route.fast}
              onFast={(fast) => setRoute((prev) => ({ ...prev, fast }))}
              quote={quote}
              usdtQuote={usdtQuote}
              step={bridge.step}
              error={bridge.error}
              onConnectSource={() => connectFamily(source.kind)}
              onSubmit={() => void submit()}
            />
          )}
        </div>

        <TransferList transfers={store.transfers} activeId={activeId} onSelect={setActiveId} />
      </main>

      <footer className="footnote">USDC on Circle CCTP V2 and the Circle Forwarding Service. USDT on USDT0 and LayerZero.</footer>

      {modal && (
        <WalletModal
          title={FAMILY_TITLE[modal.family]}
          options={modalOptions}
          emptyHint={FAMILY_EMPTY[modal.family]}
          connected={modalConnected ?? null}
          onPick={pickWallet}
          onDisconnect={() => {
            if (modal.family === 'evm') evm.disconnect()
            else solana.disconnect()
            setModal(null)
          }}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}
