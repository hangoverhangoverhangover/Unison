/** 3:07, 1:02:45. Negative or non-finite input renders as 0:00. */
export function formatTime(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

/** "12 songs, 47 min" / "1 song, 3 min" / "300 songs, 18 hr 34 min" */
export function formatCollection(count: number, totalMs: number): string {
  const songs = `${count} ${count === 1 ? 'song' : 'songs'}`
  const mins = Math.round(totalMs / 60000)
  if (mins < 60) return `${songs}, ${mins} min`
  return `${songs}, ${Math.floor(mins / 60)} hr ${mins % 60} min`
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60]
]

/** "2 months ago" from an ISO time; empty for bad input. */
export function timeAgo(iso: string | undefined, now = Date.now()): string {
  const t = iso ? Date.parse(iso) : NaN
  if (!Number.isFinite(t)) return ''
  const secs = Math.round((t - now) / 1000)
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  for (const [unit, size] of UNITS) {
    if (Math.abs(secs) >= size) return rtf.format(Math.round(secs / size), unit)
  }
  return rtf.format(0, 'minute')
}

/** 1234 -> "1,234"; 1234567 -> "1.2M". */
export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  return n.toLocaleString()
}

/** Short counts for stat lines: 413, 2.6k, 974k, 1.3M. */
export function compactNumber(n: number): string {
  const trim = (v: number): string => v.toFixed(1).replace(/\.0$/, '')
  if (n < 1000) return String(n)
  if (n < 10_000) return `${trim(n / 1000)}k`
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  if (n < 10_000_000) return `${trim(n / 1_000_000)}M`
  return `${Math.round(n / 1_000_000)}M`
}
