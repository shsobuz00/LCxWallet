import { useQuery } from '@tanstack/react-query'
import { parseAbiItem, type Address } from 'viem'
import { arcTestnet } from 'viem/chains'
import { getPublicClient } from 'wagmi/actions'
import { config } from '@/config'
import { getUsdc } from '@/onchain-facts'
import { useCustodyEntries } from './custody'

export type LedgerKind = 'deposit' | 'withdrawal' | 'event'
export type LedgerStatus = 'completed' | 'pending' | 'failed'

export interface LedgerRow {
  id: string
  kind: LedgerKind
  /** Network the transaction in `hash` happened on (or the deposit network). */
  chainId: number
  /** Set when funds were delivered on a different network than chainId. */
  destChainId?: number
  symbol: string
  amountRaw: bigint
  decimals: number
  from?: string
  to?: string
  hash?: string
  /** Milliseconds since epoch. */
  timestamp: number
  status: LedgerStatus
  note?: string
  /** Deposits only: reached the Admin Main Treasury. */
  forwarded?: boolean
}

interface TransferLog {
  blockNumber: bigint
  logIndex: number
  transactionHash: `0x${string}`
  args: { from?: Address; to?: Address; value?: bigint }
}

const TRANSFER = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)')
const EVENT_LOOKBACK = 120n

/** Latest USDC Transfer events on the Arc Testnet token contract. */
async function fetchArcEvents(): Promise<LedgerRow[]> {
  const client = getPublicClient(config, { chainId: arcTestnet.id })
  const usdc = getUsdc(arcTestnet.id)
  if (!client || !usdc) throw new Error('Arc Testnet RPC is not available')

  const head = await client.getBlockNumber()
  const logs = (await client.getLogs({
    address: usdc.address as Address,
    event: TRANSFER,
    fromBlock: head > EVENT_LOOKBACK ? head - EVENT_LOOKBACK : 0n,
    toBlock: head,
  })) as readonly TransferLog[]

  const latest = [...logs]
    .sort((a, b) => (a.blockNumber === b.blockNumber ? b.logIndex - a.logIndex : Number(b.blockNumber - a.blockNumber)))
    .slice(0, 8)

  const stamps = new Map<bigint, number>()
  await Promise.all(
    [...new Set(latest.map((l) => l.blockNumber))].map(async (blockNumber) => {
      try {
        const block = await client.getBlock({ blockNumber })
        stamps.set(blockNumber, Number(block.timestamp) * 1000)
      } catch {
        stamps.set(blockNumber, Date.now())
      }
    }),
  )

  return latest.map((log) => ({
    id: `${log.transactionHash}:${log.logIndex}`,
    kind: 'event' as const,
    chainId: arcTestnet.id,
    symbol: 'USDC',
    amountRaw: log.args.value ?? 0n,
    decimals: usdc.decimals,
    from: log.args.from,
    to: log.args.to,
    hash: log.transactionHash,
    timestamp: stamps.get(log.blockNumber) ?? Date.now(),
    status: 'completed' as const,
  }))
}

export function useLedger(address?: Address) {
  const custody = useCustodyEntries(address)
  const events = useQuery({
    queryKey: ['arc-events'],
    queryFn: fetchArcEvents,
    refetchInterval: 20_000,
  })

  const own: LedgerRow[] = (custody.data ?? []).map((e) => ({
    id: e.id,
    kind: e.kind,
    chainId: e.payoutChainId ?? e.chainId,
    destChainId: e.payoutChainId && e.payoutChainId !== e.chainId ? e.chainId : undefined,
    symbol: e.symbol,
    amountRaw: BigInt(e.amountRaw),
    decimals: e.decimals,
    from: e.from,
    to: e.to,
    hash: e.txHash,
    timestamp: e.createdAt,
    status: e.status,
    note: e.note,
    forwarded: e.forwarded,
  }))

  const rows = [...own, ...(events.data ?? [])].sort((a, b) => b.timestamp - a.timestamp)
  const error =
    custody.error instanceof Error ? custody.error.message : events.error instanceof Error ? events.error.message : undefined

  return {
    rows,
    isLoading: custody.isLoading || events.isLoading,
    isFetching: custody.isFetching || events.isFetching,
    error,
    refetch: () => Promise.all([custody.refetch(), events.refetch()]),
  }
}
