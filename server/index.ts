import { isAddress, verifyMessage, type Address } from 'viem'
import { randomUUID } from 'node:crypto'
import {
  accountKey,
  assetDecimals,
  withdrawalMessage,
  type AssetKey,
  type VaultChainLiquidity,
  type VaultStatus,
  type WithdrawalRequest,
} from '@/lib/custody-shared'
import { NETWORKS } from '@/lib/networks'
import { parseUnitsExact } from '@/onchain-money'
import { ADMIN_MAIN_VAULT, PORT, depositAccount, depositsEnabled, payoutStatus } from './config'
import { networkOf } from './chains'
import { adjustBalance, addEntry, depositAddressesFor, entriesFor, getBalances, knownUsers, registerDeposit, consumeNonce } from './db'
import { startMirror, supabaseStatus } from './supabase'
import { quoteFee } from './fees'
import { recoverPending, runPayout } from './payout'
import { balanceOfToken, decimalsOf, toInternal, tokenFor } from './tokens'
import { startWatcher } from './watcher'

const MAX_USERS = 200
const ASSETS: AssetKey[] = ['USDC', 'USDT', 'NATIVE']

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
const fail = (message: string, status = 400) => json({ error: message }, status)

// ---- Treasury liquidity (cached) -------------------------------------------------------------

let statusCache: { at: number; chains: VaultChainLiquidity[] } | undefined

async function treasuryLiquidity(): Promise<VaultChainLiquidity[]> {
  if (statusCache && Date.now() - statusCache.at < 15_000) return statusCache.chains
  const vault = ADMIN_MAIN_VAULT
  const chains = await Promise.all(
    NETWORKS.map(async (net): Promise<VaultChainLiquidity> => {
      const row: VaultChainLiquidity = { chainId: net.chainId, online: false }
      if (!vault) return row
      await Promise.all(
        net.tokens.map(async (token) => {
          try {
            const raw = await balanceOfToken(net.chainId, token, vault)
            row[token.key] = toInternal(token.key, raw, await decimalsOf(net.chainId, token)).toString()
            row.online = true
          } catch {
            // Leave the field out: unreadable is not zero.
          }
        }),
      )
      return row
    }),
  )
  statusCache = { at: Date.now(), chains }
  return chains
}

// ---- Routes ------------------------------------------------------------------------------------

async function handleWithdraw(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => undefined)) as WithdrawalRequest | undefined
  if (!body) return fail('Invalid request body')
  const { user, asset, chainId, to, amount, nonce, expiresAt, signature } = body

  if (!isAddress(user) || !isAddress(to)) return fail('Invalid address')
  if (!ASSETS.includes(asset)) return fail('Unknown asset')
  const net = networkOf(Number(chainId))
  const token = net && tokenFor(net.chainId, asset)
  if (!net || !token) return fail(`${asset} cannot be withdrawn on that network`)
  if (typeof nonce !== 'string' || nonce.length < 8 || nonce.length > 80) return fail('Invalid nonce')
  const now = Math.floor(Date.now() / 1000)
  if (!Number.isInteger(expiresAt) || expiresAt < now || expiresAt > now + 600) return fail('The signed request expired. Try again.')

  let gross: bigint
  try {
    gross = parseUnitsExact(String(amount), assetDecimals(asset))
  } catch {
    return fail('Invalid amount')
  }
  if (gross <= 0n) return fail('Amount must be greater than zero')

  const message = withdrawalMessage({ user, asset, chainId: net.chainId, to, amount, nonce, expiresAt })
  const valid = await verifyMessage({ address: user as Address, message, signature: signature as `0x${string}` }).catch(
    () => false,
  )
  if (!valid) return fail('Signature does not match the account', 401)

  const status = payoutStatus()
  if (!status.enabled) return fail(`Payouts are disabled: ${status.reason}`, 503)

  const fee = await quoteFee(asset, net.chainId)
  const feeInternal = BigInt(fee.feeRaw)
  const netInternal = gross - feeInternal
  if (netInternal <= 0n) return fail('Amount is below the withdrawal fee')

  // From here to the debit there is no await, so two requests cannot spend the same balance.
  if (!consumeNonce(user, nonce, expiresAt)) return fail('This request was already submitted', 409)
  const key = accountKey(asset, net.chainId)
  try {
    adjustBalance(user, key, -gross)
  } catch {
    return fail('Insufficient internal balance', 409)
  }
  const id = randomUUID()
  addEntry({
    id,
    user: user.toLowerCase(),
    kind: 'withdrawal',
    chainId: net.chainId,
    asset,
    symbol: token.symbol,
    amountRaw: gross.toString(),
    decimals: assetDecimals(asset),
    from: user.toLowerCase(),
    to: to.toLowerCase(),
    feeRaw: feeInternal.toString(),
    status: 'pending',
    note: 'Queued for payout from the Admin Main Treasury',
    createdAt: Date.now(),
  })
  void runPayout({
    entryId: id,
    user: user.toLowerCase(),
    asset,
    chainId: net.chainId,
    to: to as Address,
    grossInternal: gross,
    netInternal,
  })
  return json({ id })
}

async function route(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const path = url.pathname

  if (req.method === 'GET' && path === '/health') return json({ ok: true })

  if (req.method === 'GET' && path === '/status') {
    const payouts = payoutStatus()
    const body: VaultStatus = {
      vault: ADMIN_MAIN_VAULT ?? '',
      payoutsEnabled: payouts.enabled,
      reason: payouts.reason,
      depositsEnabled: depositsEnabled(),
      supabase: supabaseStatus(),
      chains: await treasuryLiquidity(),
    }
    return json(body)
  }

  if (req.method === 'GET' && path === '/deposit-address') {
    const user = url.searchParams.get('user') ?? ''
    const chainId = Number(url.searchParams.get('chainId'))
    if (!isAddress(user)) return fail('Invalid user address')
    if (!networkOf(chainId)) return fail('Unsupported network')
    if (!depositsEnabled()) return fail('Custody deposits are not configured on the server', 503)
    const address = depositAccount(user, chainId).address
    registerDeposit(user, chainId, address)
    return json({ address, chainId })
  }

  if (req.method === 'POST' && path === '/wallet/ensure') {
    const body = (await req.json().catch(() => undefined)) as { user?: string } | undefined
    const user = body?.user ?? ''
    if (!isAddress(user)) return fail('Invalid user address')
    if (!depositsEnabled()) return fail('Custody deposits are not configured on the server', 503)
    const existing = knownUsers()
    if (!existing.includes(user.toLowerCase()) && existing.length >= MAX_USERS) return fail('User limit reached on this testnet server', 503)
    // One custody address per network, all registered now so a deposit on any network is credited.
    for (const net of NETWORKS) registerDeposit(user, net.chainId, depositAccount(user, net.chainId).address)
    const addresses = depositAddressesFor(user)
    return json({
      wallet_address: user.toLowerCase(),
      deposit_address: addresses[String(NETWORKS[0].chainId)],
      deposit_addresses: addresses,
    })
  }

  if (req.method === 'GET' && path === '/balances') {
    const user = url.searchParams.get('user') ?? ''
    if (!isAddress(user)) return fail('Invalid user address')
    return json({ balances: getBalances(user) })
  }

  if (req.method === 'GET' && path === '/ledger') {
    const user = url.searchParams.get('user') ?? ''
    if (!isAddress(user)) return fail('Invalid user address')
    return json({ entries: entriesFor(user) })
  }

  if (req.method === 'GET' && path === '/quote') {
    const asset = url.searchParams.get('asset') as AssetKey
    const chainId = Number(url.searchParams.get('chainId'))
    if (!ASSETS.includes(asset) || !networkOf(chainId) || !tokenFor(chainId, asset)) return fail('Unsupported asset or network')
    return json(await quoteFee(asset, chainId))
  }

  if (req.method === 'POST' && path === '/withdraw') return handleWithdraw(req)

  return fail('Not found', 404)
}

Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  idleTimeout: 60,
  async fetch(req) {
    try {
      return await route(req)
    } catch (error) {
      console.error('[server]', error)
      return fail('Internal error', 500)
    }
  },
})

console.log(`[server] custody API on http://127.0.0.1:${PORT}`)
const payouts = payoutStatus()
console.log(`[server] deposits ${depositsEnabled() ? 'enabled' : 'DISABLED'}; payouts ${payouts.enabled ? 'enabled' : `DISABLED (${payouts.reason})`}`)
void recoverPending()
startWatcher()
startMirror()
