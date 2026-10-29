# ArcVault

> Built with Arc Studio - money-powered apps in minutes

This is the **project memory** - what Arc Studio remembers about building this app. It helps future agents (or humans) understand and extend the project.

---

## What This App Does

Multi-chain deposit/withdraw dashboard (Arc Testnet, Sepolia, Base Sepolia, Polygon Amoy, BSC Testnet). Non-custodial: balances are the connected wallet's real balances; withdrawals are real wallet transfers; ledger = on-chain Arc USDC Transfer logs + locally stored withdrawals. Arc is USDC-only (native gas = USDC). Deposit QR is a placeholder. Token addresses live in `src/lib/networks.ts` (USDC from `@/onchain-facts`; USDT per testnet, override with VITE_USDT_<chainId>).

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry. Sources in `contracts/`, unit tests in `contracts/test/*.t.sol`. Build with `bun run contracts:build` (`forge build`), test with `bun run contracts:test` (`forge test`).
- Wallet: injected (MetaMask, etc.)
- Chain: Arc Testnet (Chain ID: 5042002, imported from `viem/chains`)
- Token: USDC (6 decimals) (Address: 0x3600000000000000000000000000000000000000, Chain: Arc Testnet)
- Toasts: Sonner

## Key Files

- `src/App.tsx` - Main application logic
- `src/components/` - UI components
- `src/config.ts` - wagmi config (chains, connectors, transports)

## To Run

```bash
bun install
bun run dev
```


## Custody architecture (added)

- `server/` (Bun, `bun run server`, port 3001, proxied at `/api`): derives per-user, per-network deposit addresses from `CUSTODY_MNEMONIC`, watches balances every 10s, credits the internal balance, sweeps to the Admin Main Treasury (`VITE_ADMIN_MAIN_VAULT` = 0x3Da05c5140F346D348e14fd1274dCcbb5BB613b4), and pays withdrawals from the treasury (needs `ADMIN_VAULT_PRIVATE_KEY`). USDC payouts bridge via CCTP when the target chain lacks treasury liquidity.
- Withdrawals are authorised by an EIP-191 signature (`withdrawalMessage` in `src/lib/custody-shared.ts`), with nonce and expiry.
- Internal units: USDC/USDT 6 decimals (unified across networks), native 18 decimals (per network).
- Sepolia uses a PublicNode RPC because the registry endpoint rate-limits (429).
- Supabase mirror: `server/supabase.ts` upserts balances and ledger entries into `wallets` / `custody_entries` with `SUPABASE_SERVICE_ROLE_KEY` (server only). The browser (`src/lib/wallet.ts`) uses the publishable key to read the wallet row, subscribe to realtime changes, and creates missing wallets through `POST /api/wallet/ensure`. The local ledger (`server/data/db.json`) stays authoritative. Schema: `supabase/schema.sql`.
