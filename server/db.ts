import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AssetKey, CustodyEntry } from '@/lib/custody-shared'

type TokenAmounts = Record<AssetKey, string>

export interface DepositRecord {
  user: string
  chainId: number
  address: string
  /** Raw on-chain units already credited (or deliberately ignored gas dust) and not yet swept. */
  accounted: TokenAmounts
}

export type StoredEntry = CustodyEntry & { user: string }

interface DbShape {
  /** user -> accountKey -> internal units (bigint as decimal string). */
  balances: Record<string, Record<string, string>>
  deposits: Record<string, DepositRecord>
  entries: StoredEntry[]
  nonces: Record<string, number>
}

const DIR = join(import.meta.dir, 'data')
const FILE = join(DIR, 'db.json')

function load(): DbShape {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true })
  if (!existsSync(FILE)) return { balances: {}, deposits: {}, entries: [], nonces: {} }
  // A parse failure throws on purpose: never silently discard custodial records.
  return JSON.parse(readFileSync(FILE, 'utf8')) as DbShape
}

const db: DbShape = load()

/** Single process, single writer: write to a temp file, then rename atomically. */
function persist() {
  const tmp = `${FILE}.tmp`
  writeFileSync(tmp, JSON.stringify(db))
  renameSync(tmp, FILE)
}

export type DbEvent = { type: 'wallet'; user: string } | { type: 'entry'; id: string }
const listeners: ((event: DbEvent) => void)[] = []
export const onDbChange = (fn: (event: DbEvent) => void) => void listeners.push(fn)
const emit = (event: DbEvent) => {
  for (const fn of listeners) fn(event)
}

const zero = (): TokenAmounts => ({ USDC: '0', USDT: '0', NATIVE: '0' })

export function getBalances(user: string): Record<string, string> {
  return { ...(db.balances[user.toLowerCase()] ?? {}) }
}

export function getBalance(user: string, key: string): bigint {
  return BigInt(db.balances[user.toLowerCase()]?.[key] ?? '0')
}

/** Adds (or subtracts, if negative) from a balance. Throws instead of going below zero. */
export function adjustBalance(user: string, key: string, delta: bigint) {
  const u = user.toLowerCase()
  const next = getBalance(u, key) + delta
  if (next < 0n) throw new Error('Insufficient internal balance')
  db.balances[u] = { ...(db.balances[u] ?? {}), [key]: next.toString() }
  persist()
  emit({ type: 'wallet', user: u })
}

export function registerDeposit(user: string, chainId: number, address: string): DepositRecord {
  const id = address.toLowerCase()
  const existing = db.deposits[id]
  if (existing) return existing
  const record: DepositRecord = { user: user.toLowerCase(), chainId, address, accounted: zero() }
  db.deposits[id] = record
  persist()
  emit({ type: 'wallet', user: record.user })
  return record
}

export const allDeposits = () => Object.values(db.deposits)

export function setAccounted(address: string, asset: AssetKey, raw: bigint) {
  const rec = db.deposits[address.toLowerCase()]
  if (!rec) return
  rec.accounted[asset] = (raw < 0n ? 0n : raw).toString()
  persist()
}

export function addEntry(entry: StoredEntry) {
  db.entries.unshift(entry)
  persist()
  emit({ type: 'entry', id: entry.id })
}

export function updateEntry(id: string, patch: Partial<CustodyEntry>) {
  const entry = db.entries.find((e) => e.id === id)
  if (!entry) return
  Object.assign(entry, patch)
  persist()
  emit({ type: 'entry', id })
}

export const findEntry = (id: string) => db.entries.find((e) => e.id === id)

export function entriesFor(user: string): CustodyEntry[] {
  const u = user.toLowerCase()
  return db.entries
    .filter((e) => e.user === u)
    .slice(0, 100)
    .map(({ user: _user, ...entry }) => entry)
}

export const pendingWithdrawals = () => db.entries.filter((e) => e.kind === 'withdrawal' && e.status === 'pending')

/** Marks a nonce as used. Returns false when it was already used. */
export function consumeNonce(user: string, nonce: string, expiresAtSec: number): boolean {
  const key = `${user.toLowerCase()}:${nonce}`
  const now = Math.floor(Date.now() / 1000)
  for (const [k, exp] of Object.entries(db.nonces)) if (exp < now) delete db.nonces[k]
  if (db.nonces[key]) return false
  db.nonces[key] = expiresAtSec + 60
  persist()
  return true
}

/** Deposit entries at this address that were credited but not yet forwarded to the treasury. */
export function entryIdsToForward(address: string, asset: AssetKey): string[] {
  const a = address.toLowerCase()
  return db.entries
    .filter((e) => e.kind === 'deposit' && e.asset === asset && !e.forwarded && e.to?.toLowerCase() === a)
    .map((e) => e.id)
}

export const depositAddressesFor = (user: string): Record<string, string> => {
  const u = user.toLowerCase()
  return Object.fromEntries(
    Object.values(db.deposits)
      .filter((d) => d.user === u)
      .map((d) => [String(d.chainId), d.address]),
  )
}

export const knownUsers = (): string[] =>
  [...new Set([...Object.keys(db.balances), ...Object.values(db.deposits).map((d) => d.user)])]

export const storedEntry = (id: string) => db.entries.find((e) => e.id === id)
export const allStoredEntries = () => db.entries
