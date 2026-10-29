# ArcVault

A custodial multi-chain deposit and withdrawal app for Arc Testnet, Ethereum Sepolia, Base Sepolia, Polygon Amoy and BSC Testnet. Each user gets a personal deposit address per network. Deposits are credited to an internal balance, forwarded to an Admin Main Treasury wallet, and withdrawals are paid out from that treasury to any recipient on any supported network.

Built with [Arc Studio](https://studio.arc.io)

## Tech stack

- React, Vite, TypeScript
- Tailwind CSS, Lucide icons, Framer Motion
- wagmi, viem, ConnectKit
- Bun server for the custody API (deposit watcher, treasury payouts)

## Development

Prerequisites: [Bun](https://bun.sh) and a browser wallet such as MetaMask.

```bash
bun install
bun run dev      # web app
bun run server   # custody API (second terminal), proxied at /api
```

Production: `bun run build`, then `bun run start` (runs the custody API and the built app together on `$PORT`, default 7860).

Other scripts: `bun run check` (lint and typecheck), `bun run contracts:build`, `bun run contracts:test`.

### Environment variables

- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (optional): same values as the `NEXT_PUBLIC_*` pair; use these names for a deployed build.
- `VITE_ADMIN_MAIN_VAULT`: public address of the Admin Main Treasury.
- `CUSTODY_MNEMONIC` (secret, server only): seed that derives every user's deposit address. Back it up; losing it strands any unforwarded deposits.
- `ADMIN_VAULT_PRIVATE_KEY` (secret, server only): private key of the treasury address. Payouts and gas top-ups stay disabled until it is set and matches `VITE_ADMIN_MAIN_VAULT`.
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Supabase project URL and publishable key (public values, read-only in the browser).
- `SUPABASE_SERVICE_ROLE_KEY` (secret, server only): lets the custody server write balances and ledger entries to Supabase. Never expose it to the browser.
- `WITHDRAW_FEE_STABLE` (optional): flat fee for USDC/USDT payouts outside Arc. Defaults to 0.
- `CUSTODY_PORT` (optional): custody API port. Defaults to 3001.
- `VITE_USDT_<chainId>` (optional): address of a USDT test token for a network that has no default, for example `VITE_USDT_84532` for Base Sepolia.
- `RPC_PROXY_BASE_URL`, `RPC_PROXY_TOKEN`, `RPC_PROXY_CHAINS` (optional outside Arc Studio): provisioned by Arc Studio for backend RPC access.

## Supabase setup

Run `supabase/schema.sql` once in the Supabase SQL editor. It creates the `wallets` and `custody_entries` tables, read-only access for the browser, and realtime. The server writes with the service-role key. Until then the app falls back to the server's own ledger.

## Notes

- This is a testnet prototype. Balances are stored in `server/data/db.json`; use a real database and hardened key management before anything else.
- Withdrawals require a wallet signature. Keep `.env` private: it holds the treasury and seed secrets.
- Arc Network uses USDC as its native gas token, so Arc offers USDC only.
- Everything runs on testnets. Test tokens have no real value.
