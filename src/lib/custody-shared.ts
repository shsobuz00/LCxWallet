/**
 * Types and helpers shared by the browser and the custody server.
 * Internal accounting units: USDC and USDT use 6 decimals, native assets use 18.
 */

export type AssetKey = 'USDC' | 'USDT' | 'NATIVE'

export const STABLE_DECIMALS = 6
export const NATIVE_DECIMALS = 18

/** Account key inside a user's internal balance. USDC and USDT are unified across networks. */
export function accountKey(asset: AssetKey, chainId: number): string {
  return asset === 'NATIVE' ? `NATIVE:${chainId}` : asset
}

export function assetDecimals(asset: AssetKey): number {
  return asset === 'NATIVE' ? NATIVE_DECIMALS : STABLE_DECIMALS
}

export type EntryStatus = 'completed' | 'pending' | 'failed'

export interface CustodyEntry {
  id: string
  kind: 'deposit' | 'withdrawal'
  /** Network the user deposited on, or the network the withdrawal is delivered on. */
  chainId: number
  /** Network the treasury paid from, when it differs from chainId (bridged payout). */
  payoutChainId?: number
  asset: AssetKey
  symbol: string
  /** Internal units as a decimal string (bigint). */
  amountRaw: string
  decimals: number
  from?: string
  to?: string
  /** Deposit: sweep tx into the treasury. Withdrawal: payout tx. */
  txHash?: string
  /** Deposit only: true once the funds reached the Admin Main Treasury. */
  forwarded?: boolean
  feeRaw?: string
  status: EntryStatus
  note?: string
  createdAt: number
}

export interface VaultChainLiquidity {
  chainId: number
  online: boolean
  /** Treasury balances in internal units (decimal strings). Missing when unreadable. */
  USDC?: string
  USDT?: string
  NATIVE?: string
}

export interface VaultStatus {
  vault: string
  payoutsEnabled: boolean
  reason?: string
  depositsEnabled: boolean
  supabase?: { configured: boolean; ready: boolean; error?: string }
  chains: VaultChainLiquidity[]
}

export interface FeeQuote {
  feeRaw: string
  decimals: number
  symbol: string
  note: string
}

export interface WithdrawalRequest {
  user: string
  asset: AssetKey
  chainId: number
  to: string
  /** Human-readable decimal amount, e.g. "5" or "1.25". */
  amount: string
  nonce: string
  /** Unix seconds. */
  expiresAt: number
  signature: string
}

/** Exact text the user's wallet signs to authorise a withdrawal. */
export function withdrawalMessage(
  p: Pick<WithdrawalRequest, 'user' | 'asset' | 'chainId' | 'to' | 'amount' | 'nonce' | 'expiresAt'>,
): string {
  return [
    'ArcVault withdrawal',
    `User: ${p.user.toLowerCase()}`,
    `Asset: ${p.asset}`,
    `Network: ${p.chainId}`,
    `Recipient: ${p.to.toLowerCase()}`,
    `Amount: ${p.amount}`,
    `Nonce: ${p.nonce}`,
    `Expires: ${p.expiresAt}`,
  ].join('\n')
}
