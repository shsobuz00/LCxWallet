import { useEffect, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import {
  NetworkArc,
  NetworkBase,
  NetworkBinanceSmartChain,
  NetworkEthereum,
  NetworkPolygon,
  TokenBNB,
  TokenETH,
  TokenPOL,
  TokenUSDC,
  TokenUSDT,
} from '@web3icons/react'
import { arcTestnet, baseSepolia, bscTestnet, polygonAmoy, sepolia } from 'viem/chains'
import type { LedgerStatus } from '@/lib/ledger'
import type { TokenKey } from '@/lib/networks'

export function NetworkIcon({ chainId, size = 24 }: { chainId: number; size?: number }) {
  const props = { variant: 'branded' as const, size }
  switch (chainId) {
    case arcTestnet.id:
      return <NetworkArc {...props} />
    case sepolia.id:
      return <NetworkEthereum {...props} />
    case baseSepolia.id:
      return <NetworkBase {...props} />
    case polygonAmoy.id:
      return <NetworkPolygon {...props} />
    case bscTestnet.id:
      return <NetworkBinanceSmartChain {...props} />
    default:
      return null
  }
}

export function TokenIcon({ token, chainId, size = 24 }: { token: TokenKey; chainId?: number; size?: number }) {
  const props = { variant: 'branded' as const, size }
  if (token === 'USDT') return <TokenUSDT {...props} />
  if (token === 'USDC') return <TokenUSDC {...props} />
  if (chainId === bscTestnet.id) return <TokenBNB {...props} />
  if (chainId === polygonAmoy.id) return <TokenPOL {...props} />
  return <TokenETH {...props} />
}

const STATUS_STYLES: Record<LedgerStatus, string> = {
  completed: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  pending: 'bg-amber-50 text-amber-700 ring-amber-200',
  failed: 'bg-rose-50 text-rose-700 ring-rose-200',
}

export function StatusTag({ status }: { status: LedgerStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold capitalize ring-1 ring-inset ${STATUS_STYLES[status]}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full bg-current ${status === 'pending' ? 'animate-pulse' : ''}`}
        aria-hidden
      />
      {status}
    </span>
  )
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  children: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <button
            aria-label="Close dialog"
            className="absolute inset-0 cursor-default bg-navy/30 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="relative w-full max-w-lg"
            initial={{ y: 40, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 40, opacity: 0, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
          >
            <div className="glass lift max-h-[92dvh] overflow-y-auto rounded-t-[28px] p-5 sm:rounded-[28px] sm:p-7">
              <div className="mb-5 flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-display text-2xl font-bold tracking-tight text-navy">{title}</h2>
                  {subtitle && <p className="mt-1 text-sm text-navy-500">{subtitle}</p>}
                </div>
                <button
                  onClick={onClose}
                  aria-label="Close"
                  className="btn btn-glass !min-h-[44px] !w-11 !px-0"
                >
                  <X size={18} />
                </button>
              </div>
              {children}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
