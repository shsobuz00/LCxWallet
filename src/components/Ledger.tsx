import { useState } from 'react'
import { ArrowRight, ArrowDownToLine, ArrowUpFromLine, ExternalLink, RefreshCw, Zap, ScrollText } from 'lucide-react'
import type { LedgerKind, LedgerRow } from '@/lib/ledger'
import { explorerAddress, explorerTx, networkById } from '@/lib/networks'
import { fmt, shortAddr, timeAgo } from '@/lib/format'
import { NetworkIcon, StatusTag } from './ui'

type Filter = 'all' | LedgerKind

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'deposit', label: 'Deposits' },
  { key: 'withdrawal', label: 'Withdrawals' },
  { key: 'event', label: 'Arc events' },
]

const KIND_META: Record<LedgerKind, { label: string; Icon: typeof Zap; tone: string }> = {
  deposit: { label: 'Deposit', Icon: ArrowDownToLine, tone: 'bg-sky/15 text-sky-700' },
  withdrawal: { label: 'Withdrawal', Icon: ArrowUpFromLine, tone: 'bg-blush/20 text-pink-700' },
  event: { label: 'USDC Transfer event', Icon: Zap, tone: 'bg-navy/10 text-navy' },
}

interface Props {
  rows: LedgerRow[]
  isLoading: boolean
  isFetching: boolean
  error?: string
  isConnected: boolean
  onRefresh: () => void
}

export function Ledger({ rows, isLoading, isFetching, error, isConnected, onRefresh }: Props) {
  const [filter, setFilter] = useState<Filter>('all')
  const visible = rows.filter((r) => filter === 'all' || r.kind === filter).slice(0, 25)

  return (
    <section className="glass lift rounded-[28px] p-5 sm:p-6" aria-label="Transaction ledger">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="flex items-center gap-2 font-display text-xl font-bold text-navy">
            <ScrollText size={20} className="text-sky-600" /> Transaction ledger
          </h3>
          <p className="mt-1 text-xs text-navy-500">
            Your custodial deposits and withdrawals, plus live USDC contract events on Arc Testnet.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Ledger filter">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                role="tab"
                aria-selected={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={`rounded-full px-3 py-2 text-xs font-semibold transition hover:-translate-y-0.5 ${
                  filter === f.key ? 'bg-navy text-white' : 'bg-white/80 text-navy ring-1 ring-inset ring-sky/30'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <button onClick={onRefresh} aria-label="Refresh ledger" className="btn btn-glass !w-11 !px-0">
            <RefreshCw size={16} className={isFetching ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-inset ring-amber-200">
          {error}. Showing what could be loaded.
        </p>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="label border-b border-navy/10">
              <th className="py-2.5 pr-3 font-semibold">Type</th>
              <th className="py-2.5 pr-3 font-semibold">Amount</th>
              <th className="py-2.5 pr-3 font-semibold">Network</th>
              <th className="py-2.5 pr-3 font-semibold">From / To</th>
              <th className="py-2.5 pr-3 font-semibold">Time</th>
              <th className="py-2.5 pr-3 font-semibold">Status</th>
              <th className="py-2.5 text-right font-semibold">Tx</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && rows.length === 0
              ? Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} className="border-b border-navy/5">
                    <td colSpan={7} className="py-3">
                      <div className="h-8 animate-pulse rounded-lg bg-navy/[0.06]" />
                    </td>
                  </tr>
                ))
              : visible.map((row) => {
                  const meta = KIND_META[row.kind]
                  const network = networkById(row.chainId)
                  return (
                    <tr key={row.id} className="border-b border-navy/5 transition hover:bg-sky/[0.06]">
                      <td className="py-3 pr-3">
                        <span className="flex items-center gap-2 font-semibold text-navy">
                          <span className={`flex h-8 w-8 items-center justify-center rounded-xl ${meta.tone}`}>
                            <meta.Icon size={15} />
                          </span>
                          <span className="flex flex-col">
                            <span className="whitespace-nowrap">{meta.label}</span>
                            {row.kind === 'deposit' && (
                              <span className="text-[11px] font-medium text-navy-400">
                                {row.forwarded ? 'Forwarded to treasury' : 'Forwarding to treasury…'}
                              </span>
                            )}
                            {row.kind === 'withdrawal' && row.note && (
                              <span className="max-w-[220px] truncate text-[11px] font-medium text-navy-400" title={row.note}>
                                {row.note}
                              </span>
                            )}
                          </span>
                        </span>
                      </td>
                      <td className="py-3 pr-3 font-semibold tabular-nums text-navy">
                        {row.kind === 'deposit' ? '+' : row.kind === 'withdrawal' ? '−' : ''}
                        {fmt(row.amountRaw, row.decimals, 4)} {row.symbol}
                      </td>
                      <td className="py-3 pr-3">
                        <span className="flex items-center gap-1.5 text-navy-500">
                          <NetworkIcon chainId={row.chainId} size={16} />
                          {network?.short}
                          {row.destChainId !== undefined && (
                            <>
                              <ArrowRight size={12} />
                              <NetworkIcon chainId={row.destChainId} size={16} />
                              {networkById(row.destChainId)?.short}
                            </>
                          )}
                        </span>
                      </td>
                      <td className="py-3 pr-3 font-mono text-xs text-navy-500">
                        {row.from ? shortAddr(row.from) : '—'} → {row.to ? shortAddr(row.to) : '—'}
                      </td>
                      <td className="whitespace-nowrap py-3 pr-3 text-navy-500">{timeAgo(row.timestamp)}</td>
                      <td className="py-3 pr-3">
                        <StatusTag status={row.status} />
                      </td>
                      <td className="py-3 text-right">
                        {network && (row.hash || row.to) && (
                          <a
                            href={row.hash ? explorerTx(network, row.hash) : explorerAddress(network, row.to ?? '')}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label="View transaction on explorer"
                            className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-sky-700 hover:bg-sky/10"
                          >
                            <ExternalLink size={16} />
                          </a>
                        )}
                      </td>
                    </tr>
                  )
                })}
          </tbody>
        </table>
        {!isLoading && visible.length === 0 && (
          <p className="py-10 text-center text-sm text-navy-500">
            {filter === 'event'
              ? 'No recent USDC contract events were found.'
              : isConnected
                ? 'No matching activity yet. Deposit or withdraw to see it here.'
                : 'Connect a wallet to see your deposits and withdrawals.'}
          </p>
        )}
      </div>
    </section>
  )
}
