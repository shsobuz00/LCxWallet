import { ArrowDownToLine, ArrowUpFromLine, Activity, Coins, Database, ExternalLink, Fuel, Landmark, ShieldCheck } from 'lucide-react'
import { NETWORKS, explorerAddress, type NetworkConfig } from '@/lib/networks'
import type { ChainSnapshot } from '@/lib/portfolio'
import { internalBalance, type InternalBalances } from '@/lib/custody'
import type { VaultStatus } from '@/lib/custody-shared'
import { fmt, shortAddr } from '@/lib/format'
import { ADMIN_MAIN_VAULT } from '@/lib/vault'
import { NetworkIcon, TokenIcon } from './ui'

interface Props {
  isConnected: boolean
  loading: boolean
  balances?: InternalBalances
  snapshots?: Record<number, ChainSnapshot>
  vault?: VaultStatus
  vaultError?: string
  syncSource?: 'supabase' | 'server'
  syncLive?: boolean
  onDeposit: () => void
  onWithdraw: () => void
}

const Skeleton = () => <span className="inline-block h-7 w-24 animate-pulse rounded-lg bg-navy/10 align-middle" />

function Value({ text, loading, connected }: { text?: string; loading: boolean; connected: boolean }) {
  if (!connected) return <span className="text-navy-400">—</span>
  if (loading && text === undefined) return <Skeleton />
  return <span>{text ?? '—'}</span>
}

function StableCard({
  asset,
  total,
  footnote,
  isConnected,
  loading,
}: {
  asset: 'USDT' | 'USDC'
  total?: bigint
  footnote: string
  isConnected: boolean
  loading: boolean
}) {
  return (
    <article className="glass lift rounded-3xl p-5">
      <div className="flex items-center gap-2.5">
        <TokenIcon token={asset} size={28} />
        <h3 className="font-display text-base font-semibold text-navy">{asset}</h3>
        <span className="ml-auto rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-semibold text-navy-500 ring-1 ring-inset ring-sky/30">
          Unified
        </span>
      </div>
      <p className="mt-3 font-display text-3xl font-bold tabular-nums tracking-tight text-navy">
        <Value text={total !== undefined ? fmt(total, 6, 2) : undefined} loading={loading} connected={isConnected} />
      </p>
      <p className="mt-3 text-xs text-navy-400">{footnote}</p>
    </article>
  )
}

function NativeCard({ balances, isConnected, loading }: { balances?: InternalBalances; isConnected: boolean; loading: boolean }) {
  return (
    <article className="glass lift rounded-3xl p-5">
      <div className="flex items-center gap-2.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-sky to-blush text-white">
          <Fuel size={15} />
        </span>
        <h3 className="font-display text-base font-semibold text-navy">Native gas tokens</h3>
      </div>
      <ul className="mt-3 space-y-2">
        {NETWORKS.filter((n) => !n.isArc).map((n) => (
          <li key={n.chainId} className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 font-medium text-navy-500">
              <TokenIcon token="NATIVE" chainId={n.chainId} size={18} />
              {n.nativeSymbol} <span className="text-xs text-navy-400">· {n.short}</span>
            </span>
            <span className="font-semibold tabular-nums text-navy">
              {!isConnected ? '—' : balances ? fmt(internalBalance(balances, 'NATIVE', n.chainId), 18, 4) : loading ? '…' : '—'}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-navy-400">Arc has no separate gas token: its gas is USDC.</p>
    </article>
  )
}

function TreasuryCard({ vault, error }: { vault?: VaultStatus; error?: string }) {
  const address = vault?.vault || ADMIN_MAIN_VAULT
  const arc = NETWORKS[0]
  return (
    <section className="glass lift rounded-3xl p-5" aria-label="Admin Main Treasury">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-navy text-white">
            <Landmark size={18} />
          </span>
          <div>
            <h3 className="font-display text-base font-semibold text-navy">Admin Main Treasury</h3>
            {address && (
              <a
                href={explorerAddress(arc, address)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-mono text-xs text-sky-700 hover:underline"
              >
                {shortAddr(address, 8, 6)} <ExternalLink size={11} />
              </a>
            )}
          </div>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${
            vault?.payoutsEnabled
              ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
              : 'bg-amber-50 text-amber-800 ring-amber-200'
          }`}
        >
          <ShieldCheck size={13} />
          {vault ? (vault.payoutsEnabled ? 'Payouts live' : 'Payouts paused') : error ? 'Server offline' : 'Checking…'}
        </span>
      </div>
      {vault && !vault.payoutsEnabled && vault.reason && (
        <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-inset ring-amber-200">
          {vault.reason} Deposits are still credited; withdrawals stay disabled until the treasury key is added.
        </p>
      )}
      {error && !vault && (
        <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700 ring-1 ring-inset ring-rose-200">
          Could not reach the custody server. Run <span className="font-mono">bun run server</span>.
        </p>
      )}
      {vault && (
        <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {NETWORKS.map((n) => {
            const row = vault.chains.find((c) => c.chainId === n.chainId)
            return (
              <li key={n.chainId} className="rounded-2xl bg-white/60 p-3 text-xs">
                <p className="flex items-center gap-1.5 font-semibold text-navy">
                  <NetworkIcon chainId={n.chainId} size={16} />
                  {n.short}
                </p>
                <dl className="mt-2 space-y-1 tabular-nums text-navy-500">
                  {n.tokens.map((t) => {
                    const raw = row?.[t.key]
                    return (
                      <div key={t.key} className="flex justify-between gap-2">
                        <dt>{t.symbol}</dt>
                        <dd className="font-semibold text-navy">
                          {raw === undefined ? '—' : fmt(BigInt(raw), t.key === 'NATIVE' ? 18 : 6, t.key === 'NATIVE' ? 4 : 2)}
                        </dd>
                      </div>
                    )
                  })}
                </dl>
              </li>
            )
          })}
        </ul>
      )}
      <p className="mt-3 text-xs text-navy-400">Treasury liquidity per network. Deposits are forwarded here; payouts are sent from here.</p>
    </section>
  )
}

function NetworkStatus({ network, snap, loading }: { network: NetworkConfig; snap?: ChainSnapshot; loading: boolean }) {
  const state = snap ? (snap.online ? 'live' : 'offline') : loading ? 'checking' : 'offline'
  const dot = state === 'live' ? 'bg-emerald-500' : state === 'checking' ? 'bg-amber-400 animate-pulse' : 'bg-rose-500'
  return (
    <li className="glass lift flex flex-col gap-2 rounded-2xl p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold text-navy">
          <NetworkIcon chainId={network.chainId} size={22} />
          {network.name}
        </span>
        <span className="flex items-center gap-1.5 text-xs font-medium capitalize text-navy-500">
          <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden />
          {state}
        </span>
      </div>
      <div className="flex items-center justify-between text-xs text-navy-500">
        <span className="tabular-nums">{snap?.blockNumber !== undefined ? `Block ${snap.blockNumber.toLocaleString()}` : 'Block —'}</span>
        <span className="tabular-nums">{snap?.latencyMs !== undefined ? `${snap.latencyMs} ms` : '— ms'}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {network.isArc ? (
          <>
            <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-sky/20 to-blush/20 px-2 py-0.5 text-[11px] font-semibold text-navy ring-1 ring-inset ring-sky/40">
              <ShieldCheck size={12} /> Circle Ecosystem
            </span>
            <span className="rounded-full bg-navy px-2 py-0.5 text-[11px] font-semibold text-white">USDC only</span>
          </>
        ) : (
          network.tokens.map((t) => (
            <span key={t.key} className="rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-semibold text-navy-500 ring-1 ring-inset ring-navy/10">
              {t.symbol}
            </span>
          ))
        )}
      </div>
    </li>
  )
}

export function Dashboard({ isConnected, loading, balances, snapshots, vault, vaultError, syncSource, syncLive, onDeposit, onWithdraw }: Props) {
  const usdc = balances ? internalBalance(balances, 'USDC', 0) : undefined
  const usdt = balances ? internalBalance(balances, 'USDT', 0) : undefined
  const total = usdc !== undefined && usdt !== undefined ? usdc + usdt : undefined

  return (
    <div className="space-y-5">
      <section className="glass lift relative overflow-hidden rounded-[28px] p-6 sm:p-8" aria-label="Internal balance">
        <div aria-hidden className="pointer-events-none absolute -left-10 bottom-[-4rem] h-48 w-48 rounded-full bg-sky/25 blur-3xl" />
        <div className="relative flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="label flex items-center gap-1.5">
              <Coins size={13} /> Total internal balance
            </p>
            <p className="mt-2 font-display text-5xl font-bold tabular-nums tracking-[-0.03em] text-navy sm:text-6xl">
              <Value text={total !== undefined ? `$${fmt(total, 6, 2)}` : undefined} loading={loading} connected={isConnected} />
            </p>
            {isConnected && syncSource && (
              <p
                className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${
                  syncSource === 'supabase' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-amber-50 text-amber-800 ring-amber-200'
                }`}
              >
                <Database size={12} />
                {syncSource === 'supabase'
                  ? syncLive
                    ? 'Synced live with Supabase'
                    : 'Synced with Supabase'
                  : vault?.supabase?.configured
                    ? 'Server ledger only: run the Supabase setup SQL'
                    : 'Server ledger only'}
              </p>
            )}
            <p className="mt-2 max-w-xl text-pretty text-sm text-navy-500">
              {isConnected
                ? 'Deposits to your custody addresses are credited here automatically, on any network. Withdraw to any supported network. Testnet tokens have no real value.'
                : 'Connect a wallet to get your personal custody deposit addresses and see your internal balance.'}
            </p>
          </div>
          <div className="flex w-full flex-col gap-3 sm:flex-row md:w-auto">
            <button onClick={onDeposit} className="btn btn-primary min-h-[52px] flex-1 px-7 text-base md:flex-none">
              <ArrowDownToLine size={18} /> Deposit
            </button>
            <button onClick={onWithdraw} className="btn btn-glass min-h-[52px] flex-1 px-7 text-base md:flex-none">
              <ArrowUpFromLine size={18} /> Withdraw
            </button>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3" aria-label="Balances by asset">
        <StableCard asset="USDT" total={usdt} footnote="Not supported on Arc Network." isConnected={isConnected} loading={loading} />
        <StableCard asset="USDC" total={usdc} footnote="On Arc this is also the gas asset." isConnected={isConnected} loading={loading} />
        <NativeCard balances={balances} isConnected={isConnected} loading={loading} />
      </section>

      <TreasuryCard vault={vault} error={vaultError} />

      <section aria-label="Network status">
        <h3 className="mb-3 flex items-center gap-2 font-display text-lg font-semibold text-navy">
          <Activity size={18} className="text-sky-600" /> Network status
        </h3>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {NETWORKS.map((n) => (
            <NetworkStatus key={n.chainId} network={n} snap={snapshots?.[n.chainId]} loading={loading} />
          ))}
        </ul>
      </section>
    </div>
  )
}
