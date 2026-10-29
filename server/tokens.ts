import { erc20Abi, type Address } from 'viem'
import type { AssetKey } from '@/lib/custody-shared'
import type { TokenConfig } from '@/lib/networks'
import { publicClientFor, networkOf } from './chains'

export function tokenFor(chainId: number, asset: AssetKey): TokenConfig | undefined {
  return networkOf(chainId)?.tokens.find((t) => t.key === asset)
}

const decimalsCache = new Map<string, number>()

/** On-chain decimals of a token (native is always 18). Cached after the first read. */
export async function decimalsOf(chainId: number, token: TokenConfig): Promise<number> {
  if (token.key === 'NATIVE') return 18
  const cacheKey = `${chainId}:${token.address}`
  const cached = decimalsCache.get(cacheKey)
  if (cached !== undefined) return cached
  let decimals = token.decimals
  try {
    decimals = Number(
      await publicClientFor(chainId).readContract({
        address: token.address as Address,
        abi: erc20Abi,
        functionName: 'decimals',
      }),
    )
  } catch {
    // Fall back to the configured value.
  }
  decimalsCache.set(cacheKey, decimals)
  return decimals
}

/** On-chain units -> internal units (stablecoins normalised to 6 decimals, rounded down). */
export function toInternal(asset: AssetKey, raw: bigint, tokenDecimals: number): bigint {
  if (asset === 'NATIVE') return raw
  return tokenDecimals >= 6 ? raw / 10n ** BigInt(tokenDecimals - 6) : raw * 10n ** BigInt(6 - tokenDecimals)
}

/** Internal units -> on-chain units. */
export function fromInternal(asset: AssetKey, internal: bigint, tokenDecimals: number): bigint {
  if (asset === 'NATIVE') return internal
  return tokenDecimals >= 6 ? internal * 10n ** BigInt(tokenDecimals - 6) : internal / 10n ** BigInt(6 - tokenDecimals)
}

export async function balanceOfToken(chainId: number, token: TokenConfig, owner: Address): Promise<bigint> {
  const client = publicClientFor(chainId)
  if (token.key === 'NATIVE') return client.getBalance({ address: owner })
  return client.readContract({ address: token.address as Address, abi: erc20Abi, functionName: 'balanceOf', args: [owner] })
}
