import type { Address } from 'viem'
import { arcTestnet, sepolia, baseSepolia, polygonAmoy, bscTestnet } from 'viem/chains'
import { getChain, getUsdc } from '@/onchain-facts'
import type { SupportedChainId } from '@/config'

export type TokenKey = 'USDT' | 'USDC' | 'NATIVE'

export interface TokenConfig {
  key: TokenKey
  symbol: string
  /** Undefined for the chain's native gas token. */
  address?: Address
  /** Expected decimals; the portfolio reads decimals() onchain and overrides this. */
  decimals: number
}

export type BridgeChainName = 'Arc_Testnet' | 'Ethereum_Sepolia' | 'Base_Sepolia' | 'Polygon_Amoy_Testnet'

const BRIDGE_CHAINS: Partial<Record<number, BridgeChainName>> = {
  [arcTestnet.id]: 'Arc_Testnet',
  [sepolia.id]: 'Ethereum_Sepolia',
  [baseSepolia.id]: 'Base_Sepolia',
  [polygonAmoy.id]: 'Polygon_Amoy_Testnet',
}

export interface NetworkConfig {
  chainId: SupportedChainId
  name: string
  short: string
  isArc: boolean
  nativeSymbol: string
  explorerBase: string
  tokens: TokenConfig[]
  /** Circle App Kit chain name. Present only where USDC can move over CCTP. */
  bridgeChain?: BridgeChainName
  /** Why a token cannot be used on this network (shown instead of hiding it). */
  unavailable: Partial<Record<'USDT' | 'USDC', string>>
}

/** Optional per-chain USDT override, e.g. VITE_USDT_84532=0x... */
function usdtOverride(chainId: number): Address | undefined {
  const env = import.meta.env as Record<string, string | undefined>
  const value = env[`VITE_USDT_${chainId}`]
  return value && /^0x[0-9a-fA-F]{40}$/.test(value) ? (value as Address) : undefined
}

function usdc(chainId: number): TokenConfig | undefined {
  const fact = getUsdc(chainId)
  return fact ? { key: 'USDC', symbol: 'USDC', address: fact.address as Address, decimals: fact.decimals } : undefined
}

function build(
  chainId: SupportedChainId,
  name: string,
  short: string,
  nativeSymbol: string,
  usdtDefault?: { address: Address; decimals: number },
): NetworkConfig {
  const isArc = chainId === arcTestnet.id
  const tokens: TokenConfig[] = []
  const unavailable: NetworkConfig['unavailable'] = {}

  const usdcToken = usdc(chainId)
  if (usdcToken) tokens.push(usdcToken)
  else
    unavailable.USDC =
      chainId === bscTestnet.id
        ? 'Circle USDC and CCTP bridging are not available on BSC Testnet, so USDC cannot be withdrawn here.'
        : `USDC is not in the Arc Studio registry for ${name}.`

  if (isArc) {
    unavailable.USDT = 'Arc Network natively uses USDC. USDT is not supported.'
  } else {
    const override = usdtOverride(chainId)
    const address = override ?? usdtDefault?.address
    if (address) tokens.push({ key: 'USDT', symbol: 'USDT', address, decimals: usdtDefault?.decimals ?? 6 })
    else unavailable.USDT = `No USDT test token is configured for ${name}. Set VITE_USDT_${chainId} to enable it.`
  }

  // On Arc the gas token IS USDC, so there is no separate native asset to list.
  if (!isArc) tokens.push({ key: 'NATIVE', symbol: nativeSymbol, decimals: 18 })

  return {
    chainId,
    name,
    short,
    isArc,
    nativeSymbol,
    explorerBase: getChain(chainId)?.explorerBase ?? '',
    tokens,
    bridgeChain: BRIDGE_CHAINS[chainId],
    unavailable,
  }
}

export const NETWORKS: NetworkConfig[] = [
  build(arcTestnet.id, 'Arc Testnet', 'Arc', 'USDC'),
  build(sepolia.id, 'Ethereum Sepolia', 'Sepolia', 'ETH', {
    address: '0x7169D38820dfd117C3FA1f22a697dBA58d90BA06',
    decimals: 6,
  }),
  build(baseSepolia.id, 'Base Sepolia', 'Base', 'ETH'),
  build(polygonAmoy.id, 'Polygon Amoy', 'Polygon', 'POL', {
    address: '0xc7e9CDd039614DD17D4Db59f91D7C258d0aDc9a5',
    decimals: 6,
  }),
  build(bscTestnet.id, 'BSC Testnet', 'BSC', 'BNB', {
    address: '0x337610d27c682E347C9cD60BD4b3b107C9d34dDd',
    decimals: 18,
  }),
]

export const ARC_NETWORK = NETWORKS[0]

export function networkById(chainId: number | undefined): NetworkConfig | undefined {
  return NETWORKS.find((n) => n.chainId === chainId)
}

export function explorerTx(network: NetworkConfig, hash: string): string {
  return `${network.explorerBase}/tx/${hash}`
}

export function explorerAddress(network: NetworkConfig, address: string): string {
  return `${network.explorerBase}/address/${address}`
}
