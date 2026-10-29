import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { parseUnitsExact } from '@/onchain-money'
import { supabase } from './supabaseClient'
import type { InternalBalances } from './custody'

export type WalletSource = 'supabase' | 'server'

export interface WalletRecord {
  walletAddress: string
  balances: InternalBalances
  /** Arc Testnet custody deposit address. */
  depositAddress?: string
  /** Custody deposit address per network, keyed by chain id. */
  depositAddresses: Record<string, string>
  source: WalletSource
}

interface WalletRow {
  wallet_address: string
  usdc_balance: number | string
  usdt_balance: number | string
  native_balances: Record<string, string> | null
  deposit_address: string | null
  deposit_addresses: Record<string, string> | null
}

interface EnsureResponse {
  wallet_address: string
  deposit_address?: string
  deposit_addresses: Record<string, string>
}

const toUnits = (value: number | string) => parseUnitsExact(Number(value).toFixed(6), 6)

function fromRow(row: WalletRow): WalletRecord {
  const balances: InternalBalances = { USDC: toUnits(row.usdc_balance), USDT: toUnits(row.usdt_balance) }
  for (const [chainId, raw] of Object.entries(row.native_balances ?? {})) balances[`NATIVE:${chainId}`] = BigInt(raw)
  return {
    walletAddress: row.wallet_address,
    balances,
    depositAddress: row.deposit_address ?? undefined,
    depositAddresses: row.deposit_addresses ?? {},
    source: 'supabase',
  }
}
const API_BASE_URL = import.meta.env.VITE_API_URL || "https://lcxwallet.onrender.com";
async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}/api${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await response.json().catch(() => ({}))) as { error?: string }
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`)
  return data as T
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function readRow(address: string): Promise<{ row: WalletRow | null; ok: boolean }> {
  if (!supabase) return { row: null, ok: false }
  const result = await supabase.from('wallets').select('*').eq('wallet_address', address).maybeSingle<WalletRow>()
  if (result.error) return { row: null, ok: false }
  // A row without the new columns comes from an out-of-date schema and cannot be trusted for balances.
  if (result.data && !('deposit_addresses' in result.data && 'usdt_balance' in result.data)) return { row: null, ok: false }
  return { row: result.data, ok: true }
}

/**
 * Connect flow: look the wallet up in Supabase. A new wallet is created through the custody server
 * (it assigns the deposit addresses and writes the row with a balance of 0.00). Falls back to the
 * server's own ledger when Supabase is unreachable or its schema has not been created yet.
 */
async function loadWallet(address: string): Promise<WalletRecord> {
  const first = await readRow(address)
  if (first.ok && first.row) return fromRow(first.row)

  const ensured = await post<EnsureResponse>('/wallet/ensure', { user: address })

  if (first.ok) {
    for (let attempt = 0; attempt < 6; attempt++) {
      await wait(500)
      const next = await readRow(address)
      if (next.row) return fromRow(next.row)
    }
  }

  const response = await fetch(`${API_BASE_URL}/api/balances?user=${address}`);
  const { balances } = (await response.json()) as { balances: Record<string, string> }
  return {
    walletAddress: ensured.wallet_address,
    balances: Object.fromEntries(Object.entries(balances).map(([k, v]) => [k, BigInt(v)])),
    depositAddress: ensured.deposit_address,
    depositAddresses: ensured.deposit_addresses,
    source: 'server',
  }
}

export function useWallet(address?: string) {
  const queryClient = useQueryClient()
  const lower = address?.toLowerCase()
  const [live, setLive] = useState(false)

  const query = useQuery({
    queryKey: ['wallet-record', lower],
    enabled: !!lower,
    refetchInterval: 5_000,
    queryFn: () => loadWallet(lower as string),
  })

  // Push updates: refetch the moment the custody server changes this wallet's row or ledger.
  useEffect(() => {
    if (!supabase || !lower) return
    const channel = supabase
      .channel(`wallet-${lower}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wallets', filter: `wallet_address=eq.${lower}` }, () => {
        void queryClient.invalidateQueries({ queryKey: ['wallet-record', lower] })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'custody_entries', filter: `wallet_address=eq.${lower}` }, () => {
        void queryClient.invalidateQueries({ queryKey: ['custody-entries'] })
        void queryClient.invalidateQueries({ queryKey: ['wallet-record', lower] })
      })
      .subscribe((status) => setLive(String(status) === 'SUBSCRIBED'))
    return () => {
      void supabase?.removeChannel(channel)
    }
  }, [lower, queryClient])

  return { ...query, wallet: query.data, live: live && query.data?.source === 'supabase' }
}
