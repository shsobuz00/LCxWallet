import { erc20Abi, formatUnits, type Address } from 'viem'
import { accountKey } from '@/lib/custody-shared'
import type { AssetKey } from '@/lib/custody-shared'
import { NETWORKS } from '@/lib/networks'
import { VAULT_ACCOUNT, VAULT_PRIVATE_KEY, payoutStatus } from './config'
import { gasPrice, networkOf, publicClientFor, walletClientFor } from './chains'
import { adjustBalance, findEntry, pendingWithdrawals, updateEntry } from './db'
import { balanceOfToken, decimalsOf, fromInternal, tokenFor } from './tokens'

const log = (...args: unknown[]) => console.log('[payout]', ...args)

interface PayoutJob {
  entryId: string
  user: string
  asset: AssetKey
  chainId: number
  to: Address
  /** Internal units debited from the user (gross, including fee). */
  grossInternal: bigint
  /** Internal units delivered to the recipient. */
  netInternal: bigint
}

async function feeFields(chainId: number) {
  const fees = await publicClientFor(chainId).estimateFeesPerGas()
  const perGas = fees.maxFeePerGas ?? fees.gasPrice ?? (await gasPrice(chainId))
  return {
    perGas,
    fields: fees.maxFeePerGas
      ? { maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas }
      : { gasPrice: perGas },
  }
}

function refund(job: Pick<PayoutJob, 'entryId' | 'user' | 'asset' | 'chainId' | 'grossInternal'>, reason: string) {
  const entry = findEntry(job.entryId)
  if (!entry || entry.status !== 'pending') return
  adjustBalance(job.user, accountKey(job.asset, job.chainId), job.grossInternal)
  updateEntry(job.entryId, { status: 'failed', note: `${reason} Your balance was restored.` })
}

/** Pays from the treasury on the target network. Returns the tx hash. */
async function payDirect(job: PayoutJob, units: bigint): Promise<string> {
  if (!VAULT_ACCOUNT) throw new Error('Treasury key missing')
  const token = tokenFor(job.chainId, job.asset)
  if (!token) throw new Error('Asset not supported on this network')
  const client = publicClientFor(job.chainId)
  const wallet = walletClientFor(job.chainId, VAULT_ACCOUNT)
  const { fields } = await feeFields(job.chainId)
  const hash =
    token.key === 'NATIVE'
      ? await wallet.sendTransaction({ to: job.to, value: units, gas: 21_000n, ...fields })
      : await wallet.writeContract({
          address: token.address as Address,
          abi: erc20Abi,
          functionName: 'transfer',
          args: [job.to, units],
          ...fields,
        })
  updateEntry(job.entryId, { txHash: hash, payoutChainId: job.chainId, note: 'Treasury payout sent' })
  const receipt = await client.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`The payout transaction reverted (${hash}).`)
  return hash
}

/** Does the treasury hold enough on the target network to pay directly (units + gas headroom)? */
async function canPayDirect(job: PayoutJob, units: bigint): Promise<boolean> {
  if (!VAULT_ACCOUNT) return false
  const net = networkOf(job.chainId)
  const token = tokenFor(job.chainId, job.asset)
  if (!net || !token) return false
  const { perGas } = await feeFields(job.chainId)
  const have = await balanceOfToken(job.chainId, token, VAULT_ACCOUNT.address)
  if (token.key === 'NATIVE') return have >= units + 21_000n * perGas * 2n
  if (net.isArc) return have >= units + (100_000n * perGas) / 10n ** 12n + 1n
  const nativeHave = await publicClientFor(job.chainId).getBalance({ address: VAULT_ACCOUNT.address })
  return have >= units && nativeHave >= 100_000n * perGas
}

/** USDC only: burn from the treasury's richest CCTP network and mint straight to the recipient. */
async function payByBridge(job: PayoutJob, units: bigint): Promise<{ hash: string; sourceChainId: number }> {
  const dest = networkOf(job.chainId)
  if (!VAULT_ACCOUNT || !VAULT_PRIVATE_KEY || !dest?.bridgeChain) throw new Error('Bridge payout unavailable')

  const candidates = await Promise.all(
    NETWORKS.filter((n) => n.bridgeChain && n.chainId !== job.chainId).map(async (n) => {
      try {
        const token = tokenFor(n.chainId, 'USDC')
        const raw = token ? await balanceOfToken(n.chainId, token, VAULT_ACCOUNT!.address) : 0n
        return { network: n, raw }
      } catch {
        return { network: n, raw: 0n }
      }
    }),
  )
  const funded = candidates.filter((c) => c.raw >= units)
  const source = funded.find((c) => c.network.isArc) ?? funded.sort((a, b) => (a.raw > b.raw ? -1 : 1))[0]
  if (!source?.network.bridgeChain) throw new Error('The treasury does not hold enough USDC on any network yet.')

  updateEntry(job.entryId, { note: 'Bridging via Circle CCTP', payoutChainId: source.network.chainId })
  const [{ AppKit }, { createViemAdapterFromPrivateKey }] = await Promise.all([
    import('@circle-fin/app-kit'),
    import('@circle-fin/adapter-viem-v2'),
  ])
  const adapter = createViemAdapterFromPrivateKey({ privateKey: VAULT_PRIVATE_KEY })
  const result = await new AppKit().bridge({
    from: { adapter, chain: source.network.bridgeChain },
    to: { chain: dest.bridgeChain, recipientAddress: job.to, useForwarder: true },
    amount: formatUnits(units, 6),
  })
  const burn = result.steps.find((s) => s.name === 'burn')?.txHash
  if (result.state !== 'success') {
    const failed = result.steps.find((s) => s.state === 'error')
    throw new Error(`The bridge stopped at "${failed?.name ?? 'an unknown step'}"${burn ? ` after the burn (${burn})` : ''}.`)
  }
  return { hash: burn ?? '', sourceChainId: source.network.chainId }
}

export async function runPayout(job: PayoutJob) {
  try {
    const status = payoutStatus()
    if (!status.enabled) throw new Error(status.reason ?? 'Payouts are disabled.')
    const token = tokenFor(job.chainId, job.asset)
    if (!token) throw new Error('Asset not supported on this network.')
    const units = fromInternal(job.asset, job.netInternal, await decimalsOf(job.chainId, token))
    if (units <= 0n) throw new Error('Amount is too small after fees.')

    if (await canPayDirect(job, units)) {
      const hash = await payDirect(job, units)
      updateEntry(job.entryId, {
        status: 'completed',
        txHash: hash,
        payoutChainId: job.chainId,
        note: 'Paid from the Admin Main Treasury',
      })
      log(`paid ${job.entryId} directly: ${hash}`)
      return
    }
    if (job.asset === 'USDC') {
      const { hash, sourceChainId } = await payByBridge(job, units)
      updateEntry(job.entryId, {
        status: 'completed',
        txHash: hash,
        payoutChainId: sourceChainId,
        note: 'Paid from the Admin Main Treasury via Circle CCTP. Circle’s forwarding fee is taken from the amount delivered.',
      })
      log(`paid ${job.entryId} by bridge: ${hash}`)
      return
    }
    throw new Error(`The treasury does not hold enough ${job.asset === 'NATIVE' ? 'native gas token' : job.asset} on this network yet.`)
  } catch (error) {
    const message = (error as Error).message
    log(`payout ${job.entryId} failed: ${message}`)
    const entry = findEntry(job.entryId)
    // A bridge that already started may have burned funds: do not auto-refund it.
    if (entry?.note?.startsWith('Bridging') && /after the burn/.test(message)) {
      updateEntry(job.entryId, { status: 'failed', note: `${message} Needs manual review, no automatic refund.` })
      return
    }
    refund(job, `${message}`)
  }
}

/** On startup: settle withdrawals that were in flight when the server stopped. */
export async function recoverPending() {
  for (const entry of pendingWithdrawals()) {
    const job = { entryId: entry.id, user: (entry as { user: string }).user, asset: entry.asset, chainId: entry.chainId, grossInternal: BigInt(entry.amountRaw) }
    if (entry.txHash) {
      try {
        const chainId = entry.payoutChainId ?? entry.chainId
        const receipt = await publicClientFor(chainId).waitForTransactionReceipt({ hash: entry.txHash as `0x${string}`, timeout: 60_000 })
        if (receipt.status === 'success') updateEntry(entry.id, { status: 'completed', note: 'Paid from the Admin Main Treasury' })
        else refund(job, 'The payout transaction reverted.')
      } catch {
        log(`could not confirm ${entry.id} yet`)
      }
    } else if (entry.note?.startsWith('Bridging')) {
      updateEntry(entry.id, { status: 'failed', note: 'Interrupted during a bridge payout. Needs manual review, no automatic refund.' })
    } else {
      refund(job, 'The server restarted before the payout was sent.')
    }
  }
}

export type { PayoutJob }
