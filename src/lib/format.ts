import { formatUnitsFixed } from '@/onchain-money'

export const shortAddr = (value: string, head = 6, tail = 4) =>
  value.length > head + tail + 2 ? `${value.slice(0, head)}…${value.slice(-tail)}` : value

/** Formats a raw bigint with thousands separators and fixed fraction digits (no float math). */
export function fmt(raw: bigint, decimals: number, digits = 2): string {
  const fixed = formatUnitsFixed(raw, decimals, digits)
  const [whole, fraction] = fixed.split('.')
  const sign = whole.startsWith('-') ? '-' : ''
  const abs = sign ? whole.slice(1) : whole
  const grouped = abs.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return fraction ? `${sign}${grouped}.${fraction}` : `${sign}${grouped}`
}

export function timeAgo(ms: number): string {
  const diff = Math.max(0, Date.now() - ms)
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}
