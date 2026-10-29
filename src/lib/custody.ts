import { useQuery } from '@tanstack/react-query'
import {
  accountKey,
  type AssetKey,
  type CustodyEntry,
  type FeeQuote,
  type VaultStatus,
  type WithdrawalRequest,
} from './custody-shared'
const API_BASE_URL = import.meta.env.VITE_API_URL || "https://lcxwallet.onrender.com";
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}/api${path}`, init);
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
  return body as T;
}

export type InternalBalances = Record<string, bigint>

export function useCustodyBalances(user?: string) {
  return useQuery({
    queryKey: ['custody-balances', user],
    enabled: !!user,
    refetchInterval: 5_000,
    queryFn: () => api<{ balances: Record<string, string> }>(`/balances?user=${user}`),
    select: (data): InternalBalances => Object.fromEntries(Object.entries(data.balances).map(([k, v]) => [k, BigInt(v)])),
  })
}

export function internalBalance(balances: InternalBalances | undefined, asset: AssetKey, chainId: number): bigint {
  return balances?.[accountKey(asset, chainId)] ?? 0n
}

export function useCustodyEntries(user?: string) {
  return useQuery({
    queryKey: ['custody-entries', user],
    enabled: !!user,
    refetchInterval: 5_000,
    queryFn: () => api<{ entries: CustodyEntry[] }>(`/ledger?user=${user}`),
    select: (data) => data.entries,
  })
}

export function useDepositAddress(user: string | undefined, chainId: number, enabled = true) {
  return useQuery({
    queryKey: ['deposit-address', user, chainId],
    enabled: !!user && enabled,
    staleTime: Infinity,
    queryFn: () => api<{ address: `0x${string}`; chainId: number }>(`/deposit-address?user=${user}&chainId=${chainId}`),
  })
}

export function useVaultStatus() {
  return useQuery({
    queryKey: ['vault-status'],
    refetchInterval: 20_000,
    queryFn: () => api<VaultStatus>('/status'),
  })
}

export function useFeeQuote(asset: AssetKey | undefined, chainId: number) {
  return useQuery({
    queryKey: ['fee-quote', asset, chainId],
    enabled: !!asset,
    refetchInterval: 15_000,
    queryFn: () => api<FeeQuote>(`/quote?asset=${asset}&chainId=${chainId}`),
  })
}

export function submitWithdrawal(request: WithdrawalRequest) {
  return api<{ id: string }>('/withdraw', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  })
}
