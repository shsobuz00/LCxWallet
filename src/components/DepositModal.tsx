import { useMemo, useState } from 'react'
import { ConnectKitButton } from 'connectkit'
import { useAccount, useSendTransaction, useSwitchChain, useWriteContract } from 'wagmi'
import { Copy, Check, ExternalLink, Info, Loader2, QrCode, Send, ShieldAlert } from 'lucide-react'
import { toast } from 'sonner'
import { erc20Abi, type Address } from 'viem'
import { NETWORKS, explorerAddress, explorerTx, networkById, type TokenKey } from '@/lib/networks'
import type { ChainSnapshot } from '@/lib/portfolio'
import { useDepositAddress } from '@/lib/custody'
import { fmt } from '@/lib/format'
import { ADMIN_MAIN_VAULT } from '@/lib/vault'
import { formatUnitsExact, parseUnitsExact } from '@/onchain-money'
import { Modal, NetworkIcon, TokenIcon } from './ui'

interface Props {
  open: boolean
  onClose: () => void
  address?: Address
  snapshots?: Record<number, ChainSnapshot>
  /** Custody deposit address per network from the synced wallet record. */
  depositAddresses?: Record<string, string>
  initialChainId?: number
}

/** Deterministic placeholder pattern derived from the address. Not a scannable QR code. */
function QrPlaceholder({ seed }: { seed: string }) {
  const size = 25
  const hex = seed.replace(/^0x/, '').padEnd(40, '0')
  const cells: { x: number; y: number }[] = []
  const inFinder = (x: number, y: number) => (x < 8 && y < 8) || (x >= size - 8 && y < 8) || (x < 8 && y >= size - 8)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (inFinder(x, y)) continue
      const i = y * size + x
      const nibble = parseInt(hex[i % hex.length], 16)
      if (((nibble >> (i % 4)) & 1) === 1) cells.push({ x, y })
    }
  }
  const finder = (ox: number, oy: number) => (
    <g key={`${ox}-${oy}`}>
      <rect x={ox} y={oy} width={7} height={7} rx={1.4} fill="#0B1B3A" />
      <rect x={ox + 1} y={oy + 1} width={5} height={5} rx={1} fill="#fff" />
      <rect x={ox + 2} y={oy + 2} width={3} height={3} rx={0.8} fill="#38BDF8" />
    </g>
  )
  return (
    <svg viewBox={`-1 -1 ${size + 2} ${size + 2}`} className="h-40 w-40" role="img" aria-label="QR code placeholder">
      <rect x={-1} y={-1} width={size + 2} height={size + 2} rx={2} fill="#fff" />
      {cells.map(({ x, y }) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={0.9} height={0.9} rx={0.25} fill={(x + y) % 5 === 0 ? '#F472B6' : '#0B1B3A'} />
      ))}
      {finder(0, 0)}
      {finder(size - 7, 0)}
      {finder(0, size - 7)}
    </svg>
  )
}

export function DepositModal({ open, onClose, address, snapshots, depositAddresses, initialChainId }: Props) {
  const { chainId: walletChainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()
  const { sendTransactionAsync } = useSendTransaction()

  const [chainId, setChainId] = useState<number>(initialChainId ?? NETWORKS[0].chainId)
  const network = networkById(chainId) ?? NETWORKS[0]
  const [picked, setPicked] = useState<TokenKey>('USDC')
  const [copied, setCopied] = useState(false)
  const [amount, setAmount] = useState('')
  const [sending, setSending] = useState<'idle' | 'switching' | 'signing'>('idle')
  const [sentHash, setSentHash] = useState<string>()

  const known = depositAddresses?.[String(network.chainId)] as Address | undefined
  const custody = useDepositAddress(address, network.chainId, !known)

  const options = useMemo(
    () => [
      { key: 'USDT' as const, symbol: 'USDT', disabled: network.unavailable.USDT },
      { key: 'USDC' as const, symbol: 'USDC', disabled: network.unavailable.USDC },
      ...(network.isArc ? [] : [{ key: 'NATIVE' as const, symbol: network.nativeSymbol, disabled: undefined }]),
    ],
    [network],
  )
  const selected = options.find((o) => o.key === picked && !o.disabled) ?? options.find((o) => !o.disabled)
  const token = network.tokens.find((t) => t.key === selected?.key)
  const walletBalance = selected ? snapshots?.[network.chainId]?.balances[selected.key] : undefined
  const custodyAddress = known ?? custody.data?.address

  const copy = async () => {
    if (!custodyAddress) return
    try {
      await navigator.clipboard.writeText(custodyAddress)
      setCopied(true)
      toast.success('Deposit address copied')
      setTimeout(() => setCopied(false), 1600)
    } catch {
      toast.error('Copy failed. Select the address and copy it manually.')
    }
  }

  let amountRaw: bigint | undefined
  let amountError: string | undefined
  if (amount.trim() !== '' && token) {
    try {
      amountRaw = parseUnitsExact(amount, walletBalance?.decimals ?? token.decimals)
      if (amountRaw <= 0n) amountRaw = undefined
    } catch {
      amountError = 'Enter a valid amount.'
    }
  }
  const overBalance = amountRaw !== undefined && walletBalance !== undefined && amountRaw > walletBalance.raw

  const sendFromWallet = async () => {
    if (!custodyAddress || !token || amountRaw === undefined) return
    try {
      if (walletChainId !== network.chainId) {
        setSending('switching')
        await switchChainAsync({ chainId: network.chainId })
      }
      setSending('signing')
      const hash =
        token.key === 'NATIVE'
          ? await sendTransactionAsync({ to: custodyAddress, value: amountRaw, chainId: network.chainId })
          : await writeContractAsync({
              address: token.address as Address,
              abi: erc20Abi,
              functionName: 'transfer',
              args: [custodyAddress, amountRaw],
              chainId: network.chainId,
            })
      setSentHash(hash)
      setAmount('')
      toast.success('Deposit sent. It is credited once detected.')
    } catch (e) {
      const err = e as { code?: number; shortMessage?: string }
      if (err.code !== 4001) toast.error(err.shortMessage ?? 'The deposit could not be sent.')
    } finally {
      setSending('idle')
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Deposit"
      subtitle="Send funds to your personal custody address. They are credited to your internal balance automatically."
    >
      <div className="space-y-5">
        <div>
          <p className="label mb-2">Network</p>
          <div className="flex flex-wrap gap-2">
            {NETWORKS.map((n) => (
              <button
                key={n.chainId}
                onClick={() => {
                  setChainId(n.chainId)
                  setSentHash(undefined)
                }}
                aria-pressed={n.chainId === chainId}
                className={`btn !min-h-[44px] gap-2 !px-3 ${n.chainId === chainId ? 'btn-primary' : 'btn-glass'}`}
              >
                <NetworkIcon chainId={n.chainId} size={18} />
                {n.short}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="label mb-2">Asset</p>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Deposit asset">
            {options.map((o) => {
              const active = selected?.key === o.key
              return (
                <button
                  key={o.key}
                  role="radio"
                  aria-checked={active}
                  disabled={!!o.disabled}
                  title={o.disabled}
                  onClick={() => setPicked(o.key)}
                  className={`inner-field flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-2xl text-sm font-semibold text-navy transition hover:-translate-y-1 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0 ${
                    active ? '!border-sky ring-4 ring-sky/20' : ''
                  }`}
                >
                  <TokenIcon token={o.key} chainId={network.chainId} size={22} />
                  {o.symbol}
                </button>
              )
            })}
          </div>
          {options.some((o) => o.disabled) && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-navy-500">
              <Info size={14} className="mt-0.5 shrink-0 text-sky-600" />
              {options.find((o) => o.disabled)?.disabled}
            </p>
          )}
        </div>

        {!address ? (
          <div className="inner-field flex flex-col items-center gap-3 rounded-3xl p-6 text-center">
            <p className="text-sm text-navy-500">Connect your wallet to get your custody deposit address.</p>
            <ConnectKitButton.Custom>
              {({ show }) => (
                <button onClick={show} className="btn btn-primary">
                  Connect wallet
                </button>
              )}
            </ConnectKitButton.Custom>
          </div>
        ) : !known && custody.isError ? (
          <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
            {custody.error instanceof Error ? custody.error.message : 'Could not get a deposit address.'} Start the custody
            server with <span className="font-mono">bun run server</span>.
          </p>
        ) : (
          <div className="inner-field rounded-3xl p-4">
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
              <div className="flex flex-col items-center gap-1.5">
                <div className="rounded-2xl bg-white p-2 shadow-[0_10px_24px_-12px_rgba(11,27,58,0.5)]">
                  {custodyAddress ? (
                    <QrPlaceholder seed={custodyAddress} />
                  ) : (
                    <div className="flex h-40 w-40 items-center justify-center">
                      <Loader2 className="animate-spin text-sky-600" />
                    </div>
                  )}
                </div>
                <span className="flex items-center gap-1 text-[11px] font-medium text-navy-400">
                  <QrCode size={12} /> QR placeholder
                </span>
              </div>
              <div className="min-w-0 flex-1 space-y-3">
                <div>
                  <p className="label">Your {selected?.symbol} custody address on {network.short}</p>
                  <p className="mt-1 break-all rounded-xl bg-navy/[0.04] p-3 font-mono text-[13px] leading-snug text-navy">
                    {custodyAddress ?? 'Generating…'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => void copy()} disabled={!custodyAddress} className="btn btn-primary !min-h-[44px] flex-1">
                    {copied ? <Check size={16} /> : <Copy size={16} />}
                    {copied ? 'Copied' : 'Copy address'}
                  </button>
                  {custodyAddress && (
                    <a href={explorerAddress(network, custodyAddress)} target="_blank" rel="noopener noreferrer" className="btn btn-glass !min-h-[44px]">
                      <ExternalLink size={16} /> Explorer
                    </a>
                  )}
                </div>
                <p className="text-xs text-navy-500">
                  Unique to your account and this network. Funds sent here are forwarded to the Admin Main Treasury
                  {ADMIN_MAIN_VAULT ? ` (${ADMIN_MAIN_VAULT.slice(0, 8)}…${ADMIN_MAIN_VAULT.slice(-4)})` : ''}.
                </p>
              </div>
            </div>
          </div>
        )}

        {address && custodyAddress && selected && token && (
          <div className="space-y-2">
            <p className="label">Or send from your connected wallet</p>
            <div className="inner-field flex items-center gap-2 rounded-2xl px-3">
              <input
                aria-label="Deposit amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(',', '.'))}
                placeholder="0.00"
                className="min-h-[52px] w-full bg-transparent font-display text-xl font-bold tabular-nums text-navy outline-none placeholder:text-navy-400/60"
              />
              <span className="text-sm font-semibold text-navy-500">{selected.symbol}</span>
              <button
                disabled={!walletBalance}
                onClick={() => walletBalance && setAmount(formatUnitsExact(walletBalance.raw, walletBalance.decimals))}
                className="rounded-lg bg-sky/15 px-2.5 py-1.5 text-xs font-bold text-sky-800 hover:bg-sky/25 disabled:opacity-40"
              >
                MAX
              </button>
            </div>
            <p className="text-xs text-navy-500">
              Wallet balance on {network.short}:{' '}
              <span className="font-semibold tabular-nums text-navy">
                {walletBalance ? `${fmt(walletBalance.raw, walletBalance.decimals, selected.key === 'NATIVE' ? 4 : 2)} ${walletBalance.symbol}` : '—'}
              </span>
              {network.isArc && ' (also pays the gas)'}
            </p>
            {(amountError || overBalance) && (
              <p className="text-xs text-rose-600">{amountError ?? 'Amount exceeds your wallet balance.'}</p>
            )}
            <button
              onClick={() => void sendFromWallet()}
              disabled={!amountRaw || overBalance || sending !== 'idle'}
              className="btn btn-primary w-full"
            >
              {sending !== 'idle' ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              {sending === 'switching' ? `Switching to ${network.short}…` : sending === 'signing' ? 'Confirm in your wallet…' : `Deposit ${amount || ''} ${selected.symbol}`}
            </button>
            {sentHash && (
              <a href={explorerTx(network, sentHash)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs font-semibold text-sky-700 hover:underline">
                <ExternalLink size={12} /> Deposit transaction. Your balance updates once the server detects it.
              </a>
            )}
          </div>
        )}

        <div className="flex items-start gap-2 rounded-2xl bg-amber-50/80 p-3 text-xs text-amber-800 ring-1 ring-inset ring-amber-200">
          <ShieldAlert size={16} className="mt-0.5 shrink-0" />
          <p>
            Send only {selected?.symbol ?? 'supported assets'} on {network.name} to this address. Other tokens or networks may
            be lost. Testnet funds only.
          </p>
        </div>
      </div>
    </Modal>
  )
}
