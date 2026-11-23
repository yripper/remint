# Remint

Remint is a stablecoin bridge. Bridge **USDC** between any two CCTP chains with Circle CCTP V2 (Stellar, Solana, Ethereum, Base, Arbitrum, OP, Avalanche, Polygon, Unichain, Linea, World Chain, Sonic, Ink, Monad, Sei, HyperEVM), and **USDT** as USDT0 over LayerZero. Mainnet only.

The token chip next to the amount switches between USDC and USDT. Chain pickers only list chains that work for the selected token. If the current source doesn't carry it, the source falls back to Ethereum, and the destination falls back to the first preferred chain the source can reach.

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm test       # unit tests (route planning, hooks, fees, Iris and LayerZero Scan status, USDT0 routes, errors)
pnpm build
```

## Wallets

The wallet you connect depends on the chain you send from:

| Source | Connector |
|-|-|
| Stellar | Stellar Wallets Kit 2.8.0 (Freighter, xBull, Lobstr, …) |
| EVM chains | EIP-6963 discovery (MetaMask, Rabby, Coinbase, …), with a `window.ethereum` fallback. The app asks the wallet to switch to (or add) the source chain. |
| Solana | Wallet Standard (Phantom, Solflare, Backpack, …) |

"Use my wallet" next to the recipient fills in your own address on the destination family, connecting that wallet if needed.

## How a USDC transfer works

1. **Burn on the source chain** with `depositForBurnWithHook`:
   - Stellar: SAC `approve`, then `deposit_for_burn_with_hook` on `TokenMessengerMinter`. Amounts convert 6 → 7 decimals at this boundary only.
   - EVM: ERC-20 `approve` when the allowance is short, then `TokenMessengerV2.depositForBurnWithHook` via viem.
   - Solana: Circle's `@circle-fin/adapter-solana-kit` builds the CCTP program instruction. The wallet signs through a Wallet Standard bridge (`src/lib/solana.ts`).
2. **Circle attests.** The app polls `GET /v2/messages/{sourceDomain}?transactionHash=…`.
3. **Mint on the destination**:
   - **EVM and Solana destinations**: the Circle Forwarding Service submits the mint (hook `cctp-forward`, `destinationCaller` = zero), so the user needs no gas there. For Solana, `mintRecipient` is the recipient's USDC token account. If that account is missing, the extended hook asks Circle to create it.
   - **Stellar destination**: Circle can't forward into Stellar. `mintRecipient` and `destinationCaller` are both the `CctpForwarder` contract, and the hook carries the recipient strkey. Once attested, the user claims with one Stellar transaction (`mint_and_forward(message, attestation)`), signed by any funded Stellar account. The app blocks recipients without a USDC trustline.

Route encoding lives in `src/lib/route.ts` and is covered by `src/lib/__tests__/route.test.ts`.

## USDT (USDT0 over LayerZero)

USDT0 is Tether's USDT moved with LayerZero's OFT standard. USDT is locked on Ethereum, and USDT0 is minted and burned everywhere else. Addresses are in `src/config/usdt0.ts`, from docs.usdt0.to/api/deployments, and were checked on-chain (`token()`, decimals, Stellar peer).

| Route | Contract the user calls | Arrives as | USDT0 fee |
|-|-|-|-|
| USDT0 chain ↔ USDT0 chain (Arbitrum, OP, Polygon, Unichain, Ink, Monad, Sei, HyperEVM, Stellar) | That chain's OFT | USDT0 | none |
| Ethereum ↔ USDT0 chain | OFT Adapter (locks USDT; needs an approve) | USDT0 / USDT | none |
| Ethereum or Arbitrum → Solana | Legacy Mesh pool (needs an approve) | Tether's own Solana USDT | 0.03% |

- **One transaction per send:** `send(SendParam, MessagingFee, refund)` on EVM, or `send(from, send_param, fee, refund_address)` on the Stellar Soroban OFT.
- **Fees:** the LayerZero messaging fee is paid in the source chain's gas token (XLM on Stellar). It's quoted on-chain (`quoteOFT` + `quoteSend`) and sent with 5% headroom, which the endpoint refunds.
- **Delivery:** LayerZero's executor delivers, so there's no claim step, even into Stellar. Status comes from LayerZero Scan (`scan.layerzero-api.com/v1/messages/tx/{hash}`, no key needed).
- **Recipient encoding:** the OFT takes 32 raw bytes. That's a padded EVM address, the Solana wallet (the OFT derives the token account), or the raw Ed25519 key of a Stellar `G…` account. Stellar `M…` and `C…` recipients are refused for USDT0. A muxed id would be dropped, and an undeployed contract would strand the funds.
- **Stellar recipients need a USDT0 trustline** (`USDT0:GATISXX6BZ6NC7IKQBY37CJD4SOZL3CYZJWXEDG6JVIY4WBS6KXJHN6Q`). The app checks for it before sending.
- **Tether's Ethereum USDT** needs its allowance reset to 0 before a new approve. The app does this when it finds a partial allowance.

Not supported yet:
- **Sending USDT from Solana:** it needs LayerZero's Solana OFT SDK.
- **Two-hop routes** such as OP → Arbitrum → Solana: they need USDT0's MultiHop Composer, and a failed second hop strands the funds on Arbitrum. These routes simply don't appear in the destination list.

## Fees and speed

USDC:

- **Standard** (finality 2000): no protocol fee on any route today.
- **Fast** (finality 1000): offered where Circle supports Fast Transfer from the source. It costs a few bps.
- **Forwarding fee**: Circle's `forwardFee.med`, quoted right before the burn. There's none on routes into Stellar, because the user claims there.

`maxFee` = protocol fee + forwarding fee, from `GET /v2/burn/USDC/fees/{src}/{dst}`.

## Network

Mainnet only. Iris `iris-api.circle.com`. EVM chain IDs, USDC and TokenMessenger addresses come from Circle's Bridge Kit chain definitions (`@circle-fin/bridge-kit/chains`). Stellar addresses are in `src/config/networks.ts`.

Optional env overrides: `VITE_STELLAR_RPC`, `VITE_SOLANA_RPC`. The Stellar default is a Validation Cloud endpoint. The Solana default is PublicNode, because `api.mainnet-beta.solana.com` returns 403 to browser requests. For production, use a dedicated Solana RPC.

## Deploy

Remint is a static site on Cloudflare Workers, served at `bridge.coderipper.xyz` (`wrangler.jsonc`).

```sh
npx wrangler login   # once
pnpm release         # vite build + wrangler deploy
```

## Stack

Vite, React 19 and TypeScript, with:

- `@creit.tech/stellar-wallets-kit` and `@stellar/stellar-sdk`
- viem
- `@wallet-standard/app`
- `@solana/kit`
- `@circle-fin/adapter-solana-kit`, loaded on demand
- `@circle-fin/bridge-kit`, used for chain definitions only
- USDT0 needs no extra packages: it uses viem for EVM and `@stellar/stellar-sdk` for the Soroban OFT

## License

MIT. Remint is unaudited software that moves real funds on mainnet: use it at your own risk and start with small amounts.
