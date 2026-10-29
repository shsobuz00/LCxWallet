/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 */

import { http, createConfig } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { arcTestnet, sepolia, baseSepolia, polygonAmoy, bscTestnet } from 'viem/chains'
import { injected } from 'wagmi/connectors'
import { getChain } from '@/onchain-facts'
import { registerChain } from './tracing'

// The registry's Sepolia endpoint answers 429 under load, so Sepolia uses a PublicNode endpoint.
const RPC_OVERRIDES: Partial<Record<number, string>> = {
  [sepolia.id]: 'https://ethereum-sepolia-rpc.publicnode.com',
}
const rpcFor = (chainId: number) => RPC_OVERRIDES[chainId] ?? getChain(chainId)?.rpcUrls[0]

// Pre-register chain RPC URLs so trace events show correct chain names immediately
registerChain(arcTestnet.id, rpcFor(arcTestnet.id) ?? arcTestnet.rpcUrls.default.http[0])
registerChain(sepolia.id, rpcFor(sepolia.id) ?? sepolia.rpcUrls.default.http[0])
registerChain(baseSepolia.id, rpcFor(baseSepolia.id) ?? baseSepolia.rpcUrls.default.http[0])
registerChain(polygonAmoy.id, rpcFor(polygonAmoy.id) ?? polygonAmoy.rpcUrls.default.http[0])
registerChain(bscTestnet.id, bscTestnet.rpcUrls.default.http[0])

export const config = createConfig({
  chains: [arcTestnet, sepolia, baseSepolia, polygonAmoy, bscTestnet, mainnet], // mainnet needed for ENS resolution
  connectors: [injected()],
  transports: {
    [arcTestnet.id]: http(rpcFor(arcTestnet.id)),
    [sepolia.id]: http(rpcFor(sepolia.id)),
    [baseSepolia.id]: http(rpcFor(baseSepolia.id)),
    [polygonAmoy.id]: http(rpcFor(polygonAmoy.id)),
    [bscTestnet.id]: http(),
    [mainnet.id]: http(), // ENS resolution uses mainnet
  },
})

export type SupportedChainId =
  | typeof arcTestnet.id
  | typeof sepolia.id
  | typeof baseSepolia.id
  | typeof polygonAmoy.id
  | typeof bscTestnet.id
