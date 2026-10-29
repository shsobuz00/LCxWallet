import { useQuery } from '@tanstack/react-query'
import { erc20Abi, type Address } from 'viem'
import { getBalance, getBlockNumber, readContract } from 'wagmi/actions'
import { config } from '@/config'
import { NETWORKS, type NetworkConfig, type TokenKey } from './networks'

export interface TokenBalance {
  key: TokenKey
  symbol: string
  raw: bigint
  decimals: number
}

export interface ChainSnapshot {
  chainId: number
  online: boolean
  blockNumber?: bigint
  latencyMs?: number
  balances: Partial<Record<TokenKey, TokenBalance>>
}

async function snapshotFor(network: NetworkConfig, owner?: Address): Promise<ChainSnapshot> {
  const chainId = network.chainId
  const started = performance.now()
  let blockNumber: bigint | undefined
  let online = false
  try {
    blockNumber = await getBlockNumber(config, { chainId })
    online = true
  } catch {
    online = false
  }
  const latencyMs = online ? Math.round(performance.now() - started) : undefined

  const balances: ChainSnapshot['balances'] = {}
  if (owner && online) {
    await Promise.all(
      network.tokens.map(async (token) => {
        try {
          if (token.key === 'NATIVE') {
            const native = await getBalance(config, { address: owner, chainId })
            balances.NATIVE = { key: 'NATIVE', symbol: token.symbol, raw: native.value, decimals: native.decimals }
            return
          }
          const address = token.address as Address
          const [raw, decimals] = await Promise.all([
            readContract(config, { address, abi: erc20Abi, functionName: 'balanceOf', args: [owner], chainId }),
            readContract(config, { address, abi: erc20Abi, functionName: 'decimals', chainId }).catch(
              () => token.decimals,
            ),
          ])
          balances[token.key] = { key: token.key, symbol: token.symbol, raw, decimals: Number(decimals) }
        } catch {
          // An unreadable token is left undefined so the UI shows "—", never a made-up zero.
        }
      }),
    )
  }

  return { chainId, online, blockNumber, latencyMs, balances }
}

export function usePortfolio(owner?: Address) {
  return useQuery({
    queryKey: ['portfolio', owner ?? 'none'],
    queryFn: async () => {
      const all = await Promise.all(NETWORKS.map((network) => snapshotFor(network, owner)))
      return Object.fromEntries(all.map((s) => [s.chainId, s]))
    },
    refetchInterval: 15_000,
    staleTime: 8_000,
  })
}

/** Sum of a stablecoin across every network, in 6-decimal units (no float math). */
export function totalStable(
  snapshots: Record<number, ChainSnapshot> | undefined,
  key: 'USDT' | 'USDC',
): bigint | undefined {
  if (!snapshots) return undefined
  let total = 0n
  let seen = false
  for (const snap of Object.values(snapshots)) {
    const bal = snap.balances[key]
    if (!bal) continue
    seen = true
    // Normalise to 6 decimals so 18-decimal USDT (BSC) and 6-decimal USDT add safely.
    total += bal.decimals >= 6 ? bal.raw / 10n ** BigInt(bal.decimals - 6) : bal.raw * 10n ** BigInt(6 - bal.decimals)
  }
  return seen ? total : undefined
}
