import type { AssetKey, FeeQuote } from '@/lib/custody-shared'
import { FLAT_STABLE_FEE } from './config'
import { gasPrice, networkOf } from './chains'

const ERC20_GAS = 65_000n
const NATIVE_GAS = 21_000n

/**
 * Withdrawal fee, deducted from the amount the recipient receives.
 * - Gas-token assets (native coins, and USDC on Arc where USDC is the gas token): the estimated network gas.
 * - Other ERC-20 payouts: an optional flat fee (WITHDRAW_FEE_STABLE, default 0).
 */
export async function quoteFee(asset: AssetKey, chainId: number): Promise<FeeQuote> {
  const net = networkOf(chainId)
  if (!net) throw new Error('Unsupported network')

  if (asset === 'NATIVE') {
    const wei = NATIVE_GAS * (await gasPrice(chainId))
    return { feeRaw: wei.toString(), decimals: 18, symbol: net.nativeSymbol, note: 'Estimated network gas' }
  }
  if (net.isArc && asset === 'USDC') {
    const wei = ERC20_GAS * (await gasPrice(chainId))
    const usdc = (wei + 10n ** 12n - 1n) / 10n ** 12n
    return { feeRaw: usdc.toString(), decimals: 6, symbol: 'USDC', note: 'Estimated network gas (Arc gas is USDC)' }
  }
  return {
    feeRaw: FLAT_STABLE_FEE.toString(),
    decimals: 6,
    symbol: asset,
    note: FLAT_STABLE_FEE > 0n ? 'Flat withdrawal fee' : 'No withdrawal fee. The treasury pays the network gas.',
  }
}
