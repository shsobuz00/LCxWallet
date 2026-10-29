import { ConnectKitButton } from 'connectkit'
import { useSwitchChain } from 'wagmi'
import { BadgeCheck, CircleDashed, CheckCircle2, Sparkles } from 'lucide-react'
import { ARC_NETWORK } from '@/lib/networks'
import { fmt } from '@/lib/format'

interface Props {
  isConnected: boolean
  onArc: boolean
  /** Internal USDC balance (6 decimals). Undefined while unknown. */
  internalUsdc?: bigint
}

function Step({ done, label, action }: { done: boolean; label: string; action?: React.ReactNode }) {
  return (
    <li className="flex min-h-[44px] items-center gap-3 rounded-xl bg-white/60 px-3 py-2 text-sm">
      {done ? (
        <CheckCircle2 size={18} className="shrink-0 text-emerald-600" />
      ) : (
        <CircleDashed size={18} className="shrink-0 text-navy-400" />
      )}
      <span className={`flex-1 ${done ? 'text-navy-500 line-through decoration-navy-400/40' : 'font-medium text-navy'}`}>
        {label}
      </span>
      {!done && action}
    </li>
  )
}

export function ArcBanner({ isConnected, onArc, internalUsdc }: Props) {
  const { switchChain, isPending } = useSwitchChain()
  const funded = internalUsdc !== undefined && internalUsdc > 0n
  const isMember = isConnected && funded

  return (
    <section className="glass lift relative overflow-hidden rounded-[28px] p-5 sm:p-6" aria-label="Arc Circle onboarding">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-gradient-to-br from-sky/30 to-blush/30 blur-3xl"
      />
      <div className="relative grid gap-5 md:grid-cols-[1.1fr_1fr] md:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            {isMember ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-sky to-blush px-3 py-1 text-xs font-bold text-white shadow-[0_6px_16px_-6px_rgba(56,189,248,0.9)]">
                <BadgeCheck size={14} /> Arc Circle Member
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-1 text-xs font-bold text-navy ring-1 ring-inset ring-sky/40">
                <Sparkles size={14} className="text-sky-600" /> Arc Circle Ecosystem
              </span>
            )}
            <span className="rounded-full bg-navy px-2.5 py-1 text-[11px] font-semibold text-white">USDC native gas</span>
            <span className="rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-navy ring-1 ring-inset ring-blush/40">
              No USDT on Arc
            </span>
          </div>
          <h2 className="mt-3 font-display text-2xl font-bold leading-tight tracking-tight text-navy sm:text-3xl">
            {isMember ? (
              <>
                You are live on <span className="gradient-text">Arc Testnet</span>
              </>
            ) : (
              <>
                Join the <span className="gradient-text">Arc Circle</span> in three steps
              </>
            )}
          </h2>
          <p className="mt-2 max-w-md text-pretty text-sm text-navy-500">
            {isMember && internalUsdc !== undefined
              ? `Your internal balance holds ${fmt(internalUsdc, 6, 2)} USDC. On Arc the same USDC pays gas, so there is no second token to manage.`
              : 'Arc uses USDC as its gas token. One balance covers deposits, withdrawals, and network fees.'}
          </p>
        </div>

        <ol className="grid gap-2">
          <Step
            done={isConnected}
            label="Connect your wallet"
            action={
              <ConnectKitButton.Custom>
                {({ show }) => (
                  <button onClick={show} className="btn btn-primary !min-h-[36px] !px-3 text-xs">
                    Connect
                  </button>
                )}
              </ConnectKitButton.Custom>
            }
          />
          <Step
            done={isConnected && onArc}
            label={`Switch to ${ARC_NETWORK.name}`}
            action={
              isConnected ? (
                <button
                  disabled={isPending}
                  onClick={() => switchChain({ chainId: ARC_NETWORK.chainId })}
                  className="btn btn-glass !min-h-[36px] !px-3 text-xs"
                >
                  Switch
                </button>
              ) : undefined
            }
          />
          <Step
            done={funded}
            label="Get test USDC (sidebar) and deposit it"
          />
        </ol>
      </div>
    </section>
  )
}
