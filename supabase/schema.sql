-- ArcVault custody schema. Safe to run more than once: it also upgrades older wallets / custody_entries tables.
-- No secrets in this file: the custody server writes with the service-role key (SUPABASE_SERVICE_ROLE_KEY).

create extension if not exists pgcrypto;

create table if not exists public.wallets (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null unique,
  usdc_balance numeric(30, 6) not null default 0.00,
  deposit_address text,
  created_at timestamptz not null default now()
);

create table if not exists public.custody_entries (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null,
  created_at timestamptz not null default now()
);

-- Upgrade path: tables created by an earlier, simpler version only get the columns they lack.
alter table public.wallets add column if not exists usdt_balance numeric(30, 6) not null default 0.00;
-- Native gas-token balances per network: { "<chainId>": "<raw 18-decimal units>" }
alter table public.wallets add column if not exists native_balances jsonb not null default '{}'::jsonb;
-- Custody deposit address per network, keyed by chain id (deposit_address is the Arc Testnet one).
alter table public.wallets add column if not exists deposit_addresses jsonb not null default '{}'::jsonb;
alter table public.wallets add column if not exists updated_at timestamptz not null default now();
create unique index if not exists wallets_wallet_address_uidx on public.wallets (wallet_address);

-- Legacy columns (kept filled by the server for compatibility with older readers).
alter table public.custody_entries add column if not exists amount numeric;
alter table public.custody_entries add column if not exists type text;
alter table public.custody_entries add column if not exists network text;
alter table public.custody_entries alter column amount drop not null;
alter table public.custody_entries alter column type drop not null;
alter table public.custody_entries alter column network drop not null;

alter table public.custody_entries add column if not exists kind text;
alter table public.custody_entries add column if not exists chain_id integer;
alter table public.custody_entries add column if not exists payout_chain_id integer;
alter table public.custody_entries add column if not exists asset text;
alter table public.custody_entries add column if not exists symbol text;
alter table public.custody_entries add column if not exists amount_raw text;
alter table public.custody_entries add column if not exists decimals integer;
alter table public.custody_entries add column if not exists from_address text;
alter table public.custody_entries add column if not exists to_address text;
alter table public.custody_entries add column if not exists tx_hash text;
alter table public.custody_entries add column if not exists forwarded boolean;
alter table public.custody_entries add column if not exists fee_raw text;
alter table public.custody_entries add column if not exists status text;
alter table public.custody_entries add column if not exists note text;
create index if not exists custody_entries_wallet_idx on public.custody_entries (wallet_address, created_at desc);

alter table public.wallets enable row level security;
alter table public.custody_entries enable row level security;

-- Browsers (publishable key) may only READ. The service-role key used by the server bypasses these policies.
drop policy if exists "wallets readable" on public.wallets;
create policy "wallets readable" on public.wallets for select to anon, authenticated using (true);
drop policy if exists "entries readable" on public.custody_entries;
create policy "entries readable" on public.custody_entries for select to anon, authenticated using (true);

revoke insert, update, delete, truncate on public.wallets from anon, authenticated;
revoke insert, update, delete, truncate on public.custody_entries from anon, authenticated;

-- Live updates in the browser.
do $$ begin
  alter publication supabase_realtime add table public.wallets;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.custody_entries;
exception when duplicate_object then null; end $$;
