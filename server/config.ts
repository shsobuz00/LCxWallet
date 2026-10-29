import { isAddress, parseUnits, type Address, type Hex } from 'viem'
import { mnemonicToAccount, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'

export const PORT = Number(process.env.CUSTODY_PORT ?? 3001)

/** Admin Main Treasury: receives every swept deposit and pays every withdrawal. Public address. */
const rawVault = process.env.VITE_ADMIN_MAIN_VAULT ?? ''
export const ADMIN_MAIN_VAULT: Address | undefined = isAddress(rawVault) ? rawVault : undefined

/** Seed for the per-user deposit addresses. Server only. Never expose to the browser. */
export const CUSTODY_MNEMONIC = process.env.CUSTODY_MNEMONIC

/** Signing key of the Admin Main Treasury. Server only. */
// Accepts the key with or without the 0x prefix, and ignores surrounding quotes or spaces.
const trimmedKey = process.env.ADMIN_VAULT_PRIVATE_KEY?.trim().replace(/^['"]|['"]$/g, '')
const rawKey = trimmedKey && /^[0-9a-fA-F]{64}$/.test(trimmedKey) ? `0x${trimmedKey}` : trimmedKey
export const VAULT_PRIVATE_KEY: Hex | undefined = rawKey && /^0x[0-9a-fA-F]{64}$/.test(rawKey) ? (rawKey as Hex) : undefined
export const VAULT_ACCOUNT: PrivateKeyAccount | undefined = VAULT_PRIVATE_KEY ? privateKeyToAccount(VAULT_PRIVATE_KEY) : undefined

export function payoutStatus(): { enabled: boolean; reason?: string } {
  if (!ADMIN_MAIN_VAULT) return { enabled: false, reason: 'VITE_ADMIN_MAIN_VAULT is not a valid address.' }
  if (!VAULT_ACCOUNT) {
    return {
      enabled: false,
      reason: rawKey
        ? 'ADMIN_VAULT_PRIVATE_KEY is not a valid 32-byte hex private key.'
        : 'ADMIN_VAULT_PRIVATE_KEY is not set, so the treasury cannot sign payouts.',
    }
  }
  if (VAULT_ACCOUNT.address.toLowerCase() !== ADMIN_MAIN_VAULT.toLowerCase()) {
    return {
      enabled: false,
      reason: `ADMIN_VAULT_PRIVATE_KEY controls ${VAULT_ACCOUNT.address}, not the configured treasury ${ADMIN_MAIN_VAULT}. Update VITE_ADMIN_MAIN_VAULT or the key.`,
    }
  }
  return { enabled: true }
}

export const depositsEnabled = () => !!CUSTODY_MNEMONIC && !!ADMIN_MAIN_VAULT

/** Optional flat withdrawal fee for ERC-20 payouts (in stablecoin units, 6 decimals). Default 0. */
export const FLAT_STABLE_FEE: bigint = parseUnits(process.env.WITHDRAW_FEE_STABLE ?? '0', 6)

/** Deterministic deposit key for a user on a network. */
export function depositIndex(user: string, chainId: number): number {
  const data = new TextEncoder().encode(`arcvault:${user.toLowerCase()}:${chainId}`)
  const hash = new Bun.CryptoHasher('sha256').update(data).digest()
  // Non-hardened BIP-44 address index: < 2^31.
  return new DataView(hash.buffer, hash.byteOffset).getUint32(0) & 0x7fffffff
}

export function depositAccount(user: string, chainId: number) {
  if (!CUSTODY_MNEMONIC) throw new Error('CUSTODY_MNEMONIC is not configured')
  return mnemonicToAccount(CUSTODY_MNEMONIC, { addressIndex: depositIndex(user, chainId) })
}
