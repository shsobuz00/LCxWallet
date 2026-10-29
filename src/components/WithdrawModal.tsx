import { useMemo, useState } from 'react'
import { ConnectKitButton } from 'connectkit'
import { useAccount, useSignMessage } from 'wagmi'
import { isAddress } from 'viem'
import { AlertTriangle, CheckCircle2, ExternalLink, Fuel, Info, Landmark, Loader2, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { NETWORKS, explorerTx, networkById, type TokenKey } from '@/lib/networks'
import { internalBalance, submitWithdrawal, useCustodyEntries, useFeeQuote, useVaultStatus, type InternalBalances } from '@/lib/custody'
import { assetDecimals, withdrawalMessage } from '@/lib/custody-shared'
import { fmt, shortAddr } from '@/lib/format'
import { formatUnitsExact, parseUnitsExact } from '@/onchain-money'
import { Modal, NetworkIcon, TokenIcon } from './ui'

interface Props {
  open: boolean
  onClose: () => void
  /** Internal balances, already synced with Supabase. */
  balances?: InternalBalances
  /** Called after a withdrawal is accepted so balances refresh at once. */
  onSubmitted: () => void
}

function newRequestParams() {
  return { nonce: crypto.randomUUID().replace(/-/g, ''), expiresAt: Math.floor(Date.now() / 1000) + 300 }
}

export function WithdrawModal({ open, onClose, balances, onSubmitted }: Props) {
  const { address, isConnected } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const entries = useCustodyEntries(address)
  const vault = useVaultStatus()

  const [chainId, setChainId] = useState<number>(NETWORKS[0].chainId)
  const network = networkById(chainId) ?? NETWORKS[0]
  const [tokenKey, setTokenKey] = useState<TokenKey>('USDC')
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [phase, setPhase] = useState<'idle' | 'signing' | 'submitting'>('idle')
  const [error, setError] = useState<string>()
  const [submittedId, setSubmittedId] = useState<string>()

  const close = () => {
    setPhase('idle')
    setError(undefined)
    setSubmittedId(undefined)
    onClose()
  }

  const options = useMemo(
    () => [
      { key: 'USDT' as const, symbol: 'USDT', disabled: network.unavailable.USDT },
      { key: 'USDC' as const, symbol: 'USDC', disabled: network.unavailable.USDC },
      ...(network.isArc ? [] : [{ key: 'NATIVE' as const, symbol: network.nativeSymbol, disabled: undefined }]),
    ],
    [network],
  )
  const selected = options.find((o) => o.key === tokenKey && !o.disabled) ?? options.find((o) => !o.disabled)
  const asset = selected?.key
  const decimals = asset ? assetDecimals(asset) : 6
  const available = asset ? internalBalance(balances, asset, network.chainId) : 0n

  const quote = useFeeQuote(asset, network.chainId)
  const feeRaw = quote.data ? BigInt(quote.data.feeRaw) : undefined

  let amountRaw: bigint | undefined
  let amountError: string | undefined
  if (amount.trim() !== '') {
    try {
      amountRaw = parseUnitsExact(amount, decimals)
      if (amountRaw <= 0n) amountRaw = undefined
    } catch {
      amountError = `Enter a valid amount (up to ${decimals} decimals).`
    }
  }
  const toValid = isAddress(to)
  const receive = amountRaw !== undefined && feeRaw !== undefined ? amountRaw - feeRaw : undefined

  let blocker: string | undefined
  if (amountRaw !== undefined) {
    if (amountRaw > available) blocker = 'Amount exceeds your internal balance.'
    else if (receive !== undefined && receive <= 0n) blocker = 'Amount is not larger than the withdrawal fee.'
  }
  const payoutsOff = vault.data ? !vault.data.payoutsEnabled : false

  const busy = phase !== 'idle'
  const canSubmit = isConnected && !!address && !!asset && toValid && !!amountRaw && !blocker && !!quote.data && !payoutsOff && !busy

  const submit = async () => {
    if (!canSubmit || !address || !asset) return
    setError(undefined)
    const params = newRequestParams()
    const body = { user: address, asset, chainId: network.chainId, to, amount: formatUnitsExact(amountRaw ?? 0n, decimals), ...params }
    try {
      setPhase('signing')
      const signature = await signMessageAsync({ message: withdrawalMessage(body) })
      setPhase('submitting')
      const { id } = await submitWithdrawal({ ...body, signature })
      setSubmittedId(id)
      onSubmitted()
      void entries.refetch()
      toast.success('Withdrawal queued')
    } catch (e) {
      const err = e as { code?: number; shortMessage?: string; message?: string }
      if (err.code === 4001 || /user rejected|denied/i.test(err.shortMessage ?? err.message ?? '')) toast('Withdrawal cancelled')
      else setError(err.message ?? 'The withdrawal could not be submitted.')
    } finally {
      setPhase('idle')
    }
  }

  const entry = submittedId ? entries.data?.find((x) => x.id === submittedId) : undefined
  const payoutNetwork = networkById(entry?.payoutChainId ?? entry?.chainId)

  const cta = !isConnected
    ? 'Connect wallet'
    : phase === 'signing'
      ? 'Sign the request in your wallet…'
      : phase === 'submitting'
        ? 'Submitting…'
        : !selected
          ? 'No asset available'
          : !toValid
            ? 'Enter a valid recipient'
            : !amountRaw
              ? 'Enter an amount'
              : blocker
                ? 'Cannot withdraw this amount'
                : `Withdraw ${amount} ${selected.symbol}`

  return (
    <Modal open={open} onClose={close} title="Withdraw" subtitle="Paid out from the Admin Main Treasury to any address on the network you choose.">
      {submittedId ? (
        <div className="space-y-5 text-center">
          {!entry || entry.status === 'pending' ? (
            <Loader2 size={48} className="mx-auto animate-spin text-sky-600" />
          ) : entry.status === 'completed' ? (
            <CheckCircle2 size={52} className="mx-auto text-emerald-500" />
          ) : (
            <XCircle size={52} className="mx-auto text-rose-500" />
          )}
          <div>
            <p className="font-display text-xl font-bold text-navy">
              {!entry || entry.status === 'pending' ? 'Processing payout…' : entry.status === 'completed' ? 'Payout sent' : 'Payout failed'}
            </p>
            <p className="mt-1 text-sm text-navy-500">{entry?.note ?? 'Your balance was debited and the treasury is paying out.'}</p>
          </div>
          {entry?.txHash && payoutNetwork && (
            <a href={explorerTx(payoutNetwork, entry.txHash)} target="_blank" rel="noopener noreferrer" className="btn btn-glass w-full">
              <ExternalLink size={16} /> View on explorer
            </a>
          )}
          <button onClick={close} className="btn btn-primary w-full">
            Done
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          {payoutsOff && vault.data && (
            <div role="alert" className="flex items-start gap-2 rounded-2xl bg-amber-50 p-3 text-xs text-amber-800 ring-1 ring-inset ring-amber-200">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <p>Payouts are paused: {vault.data.reason}</p>
            </div>
          )}

          <div>
            <p className="label mb-2">Destination network</p>
            <div className="flex flex-wrap gap-2">
              {NETWORKS.map((n) => (
                <button
                  key={n.chainId}
                  onClick={() => setChainId(n.chainId)}
                  aria-pressed={n.chainId === chainId}
                  disabled={busy}
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
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Withdrawal asset">
              {options.map((o) => {
                const active = selected?.key === o.key
                return (
                  <button
                    key={o.key}
                    role="radio"
                    aria-checked={active}
                    disabled={!!o.disabled || busy}
                    title={o.disabled}
                    onClick={() => setTokenKey(o.key)}
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

          <div>
            <label htmlFor="wd-to" className="label mb-2 block">
              Recipient address on {network.short}
            </label>
            <div className="inner-field flex items-center gap-2 rounded-2xl px-3">
              <input
                id="wd-to"
                value={to}
                onChange={(e) => setTo(e.target.value.trim())}
                placeholder="0x…"
                spellCheck={false}
                autoComplete="off"
                className="min-h-[48px] w-full bg-transparent font-mono text-sm text-navy outline-none placeholder:text-navy-400"
              />
              {address && (
                <button onClick={() => setTo(address)} className="shrink-0 rounded-lg px-2 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky/10">
                  My wallet
                </button>
              )}
            </div>
            {to !== '' && !toValid && <p className="mt-1.5 text-xs text-rose-600">Not a valid EVM address.</p>}
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <label htmlFor="wd-amount" className="label">
                Amount
              </label>
              <span className="text-xs text-navy-500">
                Internal balance:{' '}
                <span className="font-semibold tabular-nums text-navy">
                  {balances ? fmt(available, decimals, asset === 'NATIVE' ? 4 : 2) : '—'}
                </span>
              </span>
            </div>
            <div className="inner-field flex items-center gap-2 rounded-2xl px-3">
              <input
                id="wd-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(',', '.'))}
                placeholder="0.00"
                className="min-h-[56px] w-full bg-transparent font-display text-2xl font-bold tabular-nums text-navy outline-none placeholder:text-navy-400/60"
              />
              <span className="shrink-0 text-sm font-semibold text-navy-500">{selected?.symbol}</span>
              <button
                onClick={() => setAmount(formatUnitsExact(available, decimals))}
                disabled={available <= 0n || busy}
                className="shrink-0 rounded-lg bg-sky/15 px-2.5 py-1.5 text-xs font-bold text-sky-800 hover:bg-sky/25 disabled:opacity-40"
              >
                MAX
              </button>
            </div>
            {amountError && <p className="mt-1.5 text-xs text-rose-600">{amountError}</p>}
          </div>

          <dl className="inner-field space-y-2 rounded-2xl p-4 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="flex items-center gap-1.5 text-navy-500">
                <Fuel size={14} /> Withdrawal fee
              </dt>
              <dd className="font-semibold tabular-nums text-navy">
                {quote.isLoading ? 'Calculating…' : quote.data && feeRaw !== undefined ? `~${fmt(feeRaw, quote.data.decimals, asset === 'NATIVE' ? 6 : 4)} ${quote.data.symbol}` : 'Unavailable'}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-navy-500">Recipient receives</dt>
              <dd className="font-semibold tabular-nums text-navy">
                {receive !== undefined && receive > 0n ? `${fmt(receive, decimals, asset === 'NATIVE' ? 6 : 4)} ${selected?.symbol}` : '—'}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="flex items-center gap-1.5 text-navy-500">
                <Landmark size={14} /> Paid from
              </dt>
              <dd className="font-mono text-xs text-navy">{vault.data?.vault ? shortAddr(vault.data.vault) : 'Admin Main Treasury'}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-navy-500">Recipient</dt>
              <dd className="font-mono text-xs text-navy">{toValid ? shortAddr(to) : '—'}</dd>
            </div>
            <p className="pt-1 text-xs text-navy-400">
              {quote.data?.note}. {asset === 'USDC' && !network.isArc ? 'If the treasury lacks USDC here, it bridges from another network with Circle CCTP.' : ''}
            </p>
          </dl>

          {(blocker || error) && (
            <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
              {blocker ?? error}
            </p>
          )}

          {isConnected ? (
            <button onClick={() => void submit()} disabled={!canSubmit} className="btn btn-primary min-h-[52px] w-full text-base">
              {busy && <Loader2 size={18} className="animate-spin" />}
              {cta}
            </button>
          ) : (
            <ConnectKitButton.Custom>
              {({ show }) => (
                <button onClick={show} className="btn btn-primary min-h-[52px] w-full text-base">
                  Connect wallet
                </button>
              )}
            </ConnectKitButton.Custom>
          )}
        </div>
      )}
    </Modal>
  )
}
