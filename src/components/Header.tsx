import { useEffect, useRef, useState } from 'react'
import { ConnectKitButton } from 'connectkit'
import { useAccount, useSwitchChain } from 'wagmi'
import { ChevronDown, Check, Wallet, Vault, AlertTriangle } from 'lucide-react'
import { NETWORKS, networkById } from '@/lib/networks'
import { shortAddr } from '@/lib/format'
import { NetworkIcon } from './ui'

function NetworkSwitcher() {
  const { chainId, isConnected } = useAccount()
  const { switchChain, isPending } = useSwitchChain()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = networkById(chainId)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  if (!isConnected) return null

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="btn btn-glass gap-2 !px-3"
      >
        {current ? (
          <>
            <NetworkIcon chainId={current.chainId} size={20} />
            <span className="hidden sm:inline">{current.name}</span>
            <span className="sm:hidden">{current.short}</span>
          </>
        ) : (
          <>
            <AlertTriangle size={16} className="text-amber-600" />
            <span>Unsupported</span>
          </>
        )}
        <ChevronDown size={16} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ul
          role="listbox"
          className="glass absolute right-0 z-40 mt-2 w-64 overflow-hidden rounded-2xl p-1.5"
        >
          {NETWORKS.map((n) => (
            <li key={n.chainId}>
              <button
                role="option"
                aria-selected={n.chainId === chainId}
                disabled={isPending}
                onClick={() => {
                  setOpen(false)
                  if (n.chainId !== chainId) switchChain({ chainId: n.chainId })
                }}
                className="flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium text-navy transition hover:bg-sky/10"
              >
                <NetworkIcon chainId={n.chainId} size={22} />
                <span className="flex-1">{n.name}</span>
                {n.chainId === chainId && <Check size={16} className="text-sky-600" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-white/60 bg-white/50 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-sky to-blush text-white shadow-[0_8px_18px_-6px_rgba(56,189,248,0.8)]">
            <Vault size={20} />
          </span>
          <div className="leading-tight">
            <p className="font-display text-lg font-bold tracking-tight text-navy">
              Arc<span className="gradient-text">Vault</span>
            </p>
            <p className="hidden text-[11px] font-medium text-navy-400 sm:block">Multi-chain deposits and withdrawals</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <NetworkSwitcher />
          <ConnectKitButton.Custom>
            {({ isConnected, isConnecting, show, address, ensName }) => (
              <button onClick={show} className="btn btn-primary gap-2">
                <Wallet size={16} />
                {isConnecting
                  ? 'Connecting…'
                  : isConnected && address
                    ? (ensName ?? shortAddr(address))
                    : 'Connect wallet'}
              </button>
            )}
          </ConnectKitButton.Custom>
        </div>
      </div>
    </header>
  )
}
