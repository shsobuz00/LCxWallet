import { formatUnitsExact } from '@/onchain-money'
import { networkOf } from './chains'
import { onDbChange, allStoredEntries, depositAddressesFor, getBalances, knownUsers, storedEntry, type DbEvent } from './db'

/**
 * Mirrors the custody ledger into Supabase so browsers can read balances live.
 * The local ledger stays authoritative. The server writes with the service-role key (bypasses row-level
 * security); browsers only hold the publishable key and can read, never write.
 */
const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '')
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

export const supabaseConfigured = !!(URL_BASE && SERVICE_KEY)

const ARC_TESTNET = '5042002'
const log = (...args: unknown[]) => console.log('[supabase]', ...args)

let ready = false
let lastError: string | undefined
const dirtyWallets = new Set<string>()
const dirtyEntries = new Set<string>()
let timer: ReturnType<typeof setTimeout> | undefined
let flushing = false

export const supabaseStatus = () => ({ configured: supabaseConfigured, ready, error: lastError })

async function rest(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY!, 'content-type': 'application/json', ...(init.headers as Record<string, string>) },
    signal: AbortSignal.timeout(15_000),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${path.split('?')[0]} ${response.status}: ${text.slice(0, 200)}`)
  return text ? JSON.parse(text) : null
}

const upsert = (table: string, conflict: string, row: Record<string, unknown>) =>
  rest(`${table}?on_conflict=${conflict}`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(row),
  })

const REQUIRED_COLUMNS: Record<string, string[]> = {
  wallets: ['wallet_address', 'usdc_balance', 'usdt_balance', 'native_balances', 'deposit_address', 'deposit_addresses', 'updated_at'],
  custody_entries: [
    'id', 'wallet_address', 'kind', 'chain_id', 'payout_chain_id', 'asset', 'symbol', 'amount_raw', 'decimals',
    'from_address', 'to_address', 'tx_hash', 'forwarded', 'fee_raw', 'status', 'note', 'created_at', 'amount', 'type', 'network',
  ],
}

async function checkReady() {
  try {
    await rest('wallets?select=id&limit=1')
    await rest('custody_entries?select=id&limit=1')
    const spec = (await rest('')) as { definitions?: Record<string, { properties?: Record<string, unknown> }> }
    const missing = Object.entries(REQUIRED_COLUMNS).flatMap(([table, cols]) =>
      cols.filter((c) => !(c in (spec.definitions?.[table]?.properties ?? {}))).map((c) => `${table}.${c}`),
    )
    if (missing.length > 0) throw new Error(`tables are missing columns (${missing.join(', ')}). Re-run supabase/schema.sql`)
    if (!ready) log('connected: schema verified')
    ready = true
    lastError = undefined
  } catch (error) {
    ready = false
    lastError = (error as Error).message
  }
  return ready
}

async function pushWallet(user: string) {
  const balances = getBalances(user)
  const native: Record<string, string> = {}
  for (const [key, value] of Object.entries(balances)) {
    if (key.startsWith('NATIVE:')) native[key.slice(7)] = value
  }
  const addresses = depositAddressesFor(user)
  const row: Record<string, unknown> = {
    wallet_address: user,
    usdc_balance: formatUnitsExact(BigInt(balances.USDC ?? '0'), 6),
    usdt_balance: formatUnitsExact(BigInt(balances.USDT ?? '0'), 6),
    native_balances: native,
    deposit_addresses: addresses,
    updated_at: new Date().toISOString(),
  }
  if (addresses[ARC_TESTNET]) row.deposit_address = addresses[ARC_TESTNET]
  await upsert('wallets', 'wallet_address', row)
}

async function pushEntry(id: string) {
  const e = storedEntry(id)
  if (!e) return
  await upsert('custody_entries', 'id', {
    id: e.id,
    wallet_address: e.user,
    kind: e.kind,
    chain_id: e.chainId,
    payout_chain_id: e.payoutChainId ?? null,
    asset: e.asset,
    symbol: e.symbol,
    amount_raw: e.amountRaw,
    decimals: e.decimals,
    from_address: e.from ?? null,
    to_address: e.to ?? null,
    tx_hash: e.txHash ?? null,
    forwarded: e.forwarded ?? null,
    fee_raw: e.feeRaw ?? null,
    status: e.status,
    note: e.note ?? null,
    created_at: new Date(e.createdAt).toISOString(),
    // Legacy columns, kept filled for older readers.
    amount: formatUnitsExact(BigInt(e.amountRaw), e.decimals),
    type: e.kind,
    network: networkOf(e.chainId)?.name ?? String(e.chainId),
  })
}

async function flush() {
  if (flushing) return
  flushing = true
  try {
    if (!ready && !(await checkReady())) return
    // Wallets first so entries always have a wallet row to point at.
    for (const user of [...dirtyWallets]) {
      try {
        await pushWallet(user)
        dirtyWallets.delete(user)
      } catch (error) {
        lastError = (error as Error).message
        log('wallet sync failed, will retry:', lastError)
      }
    }
    for (const id of [...dirtyEntries]) {
      try {
        await pushEntry(id)
        dirtyEntries.delete(id)
      } catch (error) {
        lastError = (error as Error).message
        log('entry sync failed, will retry:', lastError)
      }
    }
  } finally {
    flushing = false
  }
}

function schedule(delay = 250) {
  if (timer) return
  timer = setTimeout(() => {
    timer = undefined
    void flush()
  }, delay)
}

function mark(event: DbEvent) {
  if (event.type === 'wallet') dirtyWallets.add(event.user)
  else dirtyEntries.add(event.id)
  schedule()
}

export function startMirror() {
  if (!supabaseConfigured) {
    log('not configured: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed')
    return
  }
  onDbChange(mark)
  // Full resync at startup, then a retry sweep that also picks up the schema once it is created.
  for (const user of knownUsers()) dirtyWallets.add(user)
  for (const e of allStoredEntries()) dirtyEntries.add(e.id)
  void (async () => {
    if (!(await checkReady())) log(`waiting for the schema (run supabase/schema.sql in the Supabase SQL editor): ${lastError}`)
    schedule(0)
  })()
  setInterval(() => {
    if (dirtyWallets.size > 0 || dirtyEntries.size > 0 || !ready) schedule(0)
  }, 30_000)
}
