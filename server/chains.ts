import { createPublicClient, createWalletClient, http, type Chain, type PublicClient } from 'viem'
import type { Account } from 'viem'
import { arcTestnet, baseSepolia, bscTestnet, polygonAmoy, sepolia } from 'viem/chains'
import { getChain } from '@/onchain-facts'
import { NETWORKS, type NetworkConfig } from '@/lib/networks'

const VIEM_CHAINS: Record<number, Chain> = {
  [arcTestnet.id]: arcTestnet,
  [sepolia.id]: sepolia,
  [baseSepolia.id]: baseSepolia,
  [polygonAmoy.id]: polygonAmoy,
  [bscTestnet.id]: bscTestnet,
}

export function networkOf(chainId: number): NetworkConfig | undefined {
  return NETWORKS.find((n) => n.chainId === chainId)
}

// The Arc Studio RPC proxy is not configured in this project, so public RPCs are used.
// The registry's Sepolia endpoint answers 429 under load, so Sepolia uses a PublicNode endpoint (checked live).
const RPC_OVERRIDES: Partial<Record<number, string>> = {
  [sepolia.id]: 'https://ethereum-sepolia-rpc.publicnode.com',
}

function rpcUrl(chainId: number): string {
  const chain = VIEM_CHAINS[chainId]
  return RPC_OVERRIDES[chainId] ?? getChain(chainId)?.rpcUrls[0] ?? chain.rpcUrls.default.http[0]
}

const publicClients = new Map<number, PublicClient>()

export function publicClientFor(chainId: number): PublicClient {
  let client = publicClients.get(chainId)
  if (!client) {
    client = createPublicClient({ chain: VIEM_CHAINS[chainId], transport: http(rpcUrl(chainId), { timeout: 10_000, retryCount: 1 }) }) as PublicClient
    publicClients.set(chainId, client)
  }
  return client
}

export function walletClientFor(chainId: number, account: Account) {
  return createWalletClient({ account, chain: VIEM_CHAINS[chainId], transport: http(rpcUrl(chainId)) })
}

/** Current gas price in wei (18-decimal gas-token units). */
export async function gasPrice(chainId: number): Promise<bigint> {
  const client = publicClientFor(chainId)
  const fees = await client.estimateFeesPerGas()
  return fees.maxFeePerGas ?? fees.gasPrice ?? (await client.getGasPrice())
}
