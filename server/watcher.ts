import { erc20Abi, type Address } from 'viem'
import { randomUUID } from 'node:crypto'
import { accountKey, assetDecimals, type AssetKey } from '@/lib/custody-shared'
import { ADMIN_MAIN_VAULT, VAULT_ACCOUNT, depositAccount, depositsEnabled, payoutStatus } from './config'
import { gasPrice, networkOf, publicClientFor, walletClientFor } from './chains'
import {
  adjustBalance,
  addEntry,
  allDeposits,
  setAccounted,
  updateEntry,
  type DepositRecord,
  entryIdsToForward,
} from './db'
import { balanceOfToken, decimalsOf, toInternal, tokenFor } from './tokens'

const SCAN_INTERVAL_MS = 10_000
const ERC20_TRANSFER_GAS_BUFFER = 12n // x1.2
let scanning = false

const log = (...args: unknown[]) => console.log('[custody]', ...args)

/** Fee fields that work on both EIP-1559 and legacy chains. */
async function feeFields(chainId: number) {
  const fees = await publicClientFor(chainId).estimateFeesPerGas()
  const perGas = fees.maxFeePerGas ?? fees.gasPrice ?? (await gasPrice(chainId))
  const fields = fees.maxFeePerGas
    ? { maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas }
    : { gasPrice: perGas }
  return { perGas, fields }
}

async function creditNewDeposits(rec: DepositRecord) {
  const net = networkOf(rec.chainId)
  if (!net) return
  for (const token of net.tokens) {
    const asset = token.key
    const bal = await balanceOfToken(rec.chainId, token, rec.address as Address)
    const accounted = BigInt(rec.accounted[asset])
    if (bal <= accounted) {
      if (bal < accounted) setAccounted(rec.address, asset, bal)
      continue
    }
    const delta = bal - accounted
    const decimals = await decimalsOf(rec.chainId, token)
    const internal = toInternal(asset, delta, decimals)
    if (internal <= 0n) continue
    adjustBalance(rec.user, accountKey(asset, rec.chainId), internal)
    setAccounted(rec.address, asset, accounted + delta)
    addEntry({
      id: randomUUID(),
      user: rec.user,
      kind: 'deposit',
      chainId: rec.chainId,
      asset,
      symbol: token.symbol,
      amountRaw: internal.toString(),
      decimals: assetDecimals(asset),
      to: rec.address,
      forwarded: false,
      status: 'completed',
      note: 'Credited to your internal balance',
      createdAt: Date.now(),
    })
    log(`credited ${internal} ${token.symbol} (internal units) to ${rec.user} from ${rec.address} on ${rec.chainId}`)
  }
}

function markForwarded(rec: DepositRecord, asset: AssetKey, txHash: string) {
  for (const id of entryIdsToForward(rec.address, asset)) {
    updateEntry(id, { forwarded: true, txHash, note: 'Forwarded to the Admin Main Treasury' })
  }
}

async function sweepToken(rec: DepositRecord, asset: 'USDC' | 'USDT') {
  const net = networkOf(rec.chainId)
  const token = tokenFor(rec.chainId, asset)
  if (!net || !token || !ADMIN_MAIN_VAULT) return
  const accounted = BigInt(rec.accounted[asset])
  if (accounted <= 0n) return

  const account = depositAccount(rec.user, rec.chainId)
  if (account.address.toLowerCase() !== rec.address.toLowerCase()) throw new Error('Derived address mismatch')
  const client = publicClientFor(rec.chainId)
  const { perGas, fields } = await feeFields(rec.chainId)
  const tokenAddress = token.address as Address

  const gasEstimate = await client.estimateContractGas({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [ADMIN_MAIN_VAULT, accounted],
    account,
  })
  const gasLimit = (gasEstimate * ERC20_TRANSFER_GAS_BUFFER) / 10n
  const gasCost = gasLimit * perGas

  let amount = accounted
  if (net.isArc) {
    // Arc pays gas in USDC: the sweep leaves enough behind to cover its own fee (18 -> 6 decimals, rounded up).
    const costUsdc = (gasCost + 10n ** 12n - 1n) / 10n ** 12n
    if (accounted <= costUsdc) return
    amount = accounted - costUsdc
  } else {
    const nativeBal = await client.getBalance({ address: rec.address as Address })
    if (nativeBal < gasCost) {
      if (!VAULT_ACCOUNT || !payoutStatus().enabled) {
        log(`sweep of ${asset} on ${rec.chainId} waiting: treasury key needed to top up gas`)
        return
      }
      const topUp = gasCost - nativeBal
      const topUpHash = await walletClientFor(rec.chainId, VAULT_ACCOUNT).sendTransaction({
        to: rec.address as Address,
        value: topUp,
        ...(await feeFields(rec.chainId)).fields,
      })
      await client.waitForTransactionReceipt({ hash: topUpHash })
      // The gas top-up is treasury money, not a user deposit: mark it as accounted so it is never credited.
      setAccounted(rec.address, 'NATIVE', BigInt(rec.accounted.NATIVE) + topUp)
    }
  }

  const hash = await walletClientFor(rec.chainId, account).writeContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [ADMIN_MAIN_VAULT, amount],
    gas: gasLimit,
    ...fields,
  })
  const receipt = await client.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`Sweep reverted: ${hash}`)

  const remaining = accounted - amount
  const balNow = await balanceOfToken(rec.chainId, token, rec.address as Address)
  setAccounted(rec.address, asset, remaining < balNow ? remaining : balNow)
  const nativeNow = await client.getBalance({ address: rec.address as Address })
  if (BigInt(rec.accounted.NATIVE) > nativeNow) setAccounted(rec.address, 'NATIVE', nativeNow)
  markForwarded(rec, asset, hash)
  log(`swept ${asset} from ${rec.address} to treasury: ${hash}`)
}

async function sweepNative(rec: DepositRecord) {
  const net = networkOf(rec.chainId)
  if (!net || net.isArc || !ADMIN_MAIN_VAULT) return
  if (entryIdsToForward(rec.address, 'NATIVE').length === 0) return

  const account = depositAccount(rec.user, rec.chainId)
  const client = publicClientFor(rec.chainId)
  const { perGas, fields } = await feeFields(rec.chainId)
  const bal = await client.getBalance({ address: rec.address as Address })
  const reserve = 21_000n * perGas
  if (bal <= reserve) return

  const hash = await walletClientFor(rec.chainId, account).sendTransaction({
    to: ADMIN_MAIN_VAULT,
    value: bal - reserve,
    gas: 21_000n,
    ...fields,
  })
  const receipt = await client.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`Native sweep reverted: ${hash}`)
  const nativeNow = await client.getBalance({ address: rec.address as Address })
  setAccounted(rec.address, 'NATIVE', nativeNow)
  markForwarded(rec, 'NATIVE', hash)
  log(`swept native from ${rec.address} to treasury: ${hash}`)
}

export async function scanOnce() {
  if (scanning || !depositsEnabled()) return
  scanning = true
  try {
    for (const rec of allDeposits()) {
      try {
        await creditNewDeposits(rec)
        await sweepToken(rec, 'USDC')
        await sweepToken(rec, 'USDT')
        await sweepNative(rec)
      } catch (error) {
        log(`scan error for ${rec.address} on ${rec.chainId}:`, (error as Error).message)
      }
    }
  } finally {
    scanning = false
  }
}

export function startWatcher() {
  void scanOnce()
  setInterval(() => void scanOnce(), SCAN_INTERVAL_MS)
}
