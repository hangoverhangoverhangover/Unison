// Lyrics (QoL 3): synced lyrics in LRC form, line by line, and word by word when the
// line carries <mm:ss.xx> word tags (from the user's own sync). Pure helpers only.

export interface LyricWord {
  timeMs: number
  text: string
}

export interface LyricLine {
  timeMs: number
  text: string
  /** Word timing, when known (the user's own word-by-word sync). */
  words?: LyricWord[]
}

export interface LyricsResult {
  /** Where they came from: the user's own, LRCLIB, or nothing found. */
  source: 'user' | 'lrclib' | 'none'
  /** Time-synced lines, or null when only plain text is known. */
  synced: LyricLine[] | null
  plain: string | null
  instrumental: boolean
}

const LINE_STAMP = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g
const WORD_STAMP = /<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>/g

function toMs(min: string, sec: string, frac?: string): number {
  // ".5" is half a second, ".12" 120 ms, ".003" 3 ms.
  const ms = frac ? Math.round(Number(`0.${frac}`) * 1000) : 0
  return Number(min) * 60_000 + Number(sec) * 1000 + ms
}

/** Parse LRC text into lines sorted by time. Metadata tags ([ar:…]) and unstamped text are skipped. */
export function parseLrc(text: string): LyricLine[] {
  const out: LyricLine[] = []
  for (const raw of text.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(LINE_STAMP)]
    if (stamps.length === 0) continue
    const body = raw.replace(LINE_STAMP, '')
    const wordStamps = [...body.matchAll(WORD_STAMP)]
    let words: LyricWord[] | undefined
    let lineText: string
    if (wordStamps.length > 0) {
      words = wordStamps.map((m, i) => {
        const start = m.index! + m[0].length
        const end = wordStamps[i + 1]?.index ?? body.length
        return { timeMs: toMs(m[1]!, m[2]!, m[3]), text: body.slice(start, end) }
      })
      lineText = words
        .map((w) => w.text)
        .join('')
        .trim()
    } else {
      lineText = body.trim()
    }
    for (const s of stamps) {
      const line: LyricLine = { timeMs: toMs(s[1]!, s[2]!, s[3]), text: lineText }
      if (words) line.words = words
      out.push(line)
    }
  }
  return out.sort((a, b) => a.timeMs - b.timeMs)
}

function stamp(ms: number): string {
  const total = Math.max(0, Math.round(ms / 10))
  const min = Math.floor(total / 6000)
  const sec = Math.floor((total % 6000) / 100)
  const cs = total % 100
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

/** Write lines back as LRC (word tags included when a line has them). */
export function toLrc(lines: LyricLine[]): string {
  return lines
    .map((l) => {
      const body = l.words?.length
        ? l.words.map((w) => `<${stamp(w.timeMs)}>${w.text}`).join('')
        : l.text
      return `[${stamp(l.timeMs)}]${body}\n`
    })
    .join('')
}

/** Index of the line playing at `positionMs` (the last one that started), or -1. */
export function activeLine(lines: LyricLine[], positionMs: number): number {
  let lo = 0
  let hi = lines.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid]!.timeMs <= positionMs) {
      found = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return found
}

/** Index of the word playing in a word-timed line, or -1 (no word timing / before it). */
export function activeWord(line: LyricLine, positionMs: number): number {
  if (!line.words?.length) return -1
  let found = -1
  line.words.forEach((w, i) => {
    if (w.timeMs <= positionMs) found = i
  })
  return found
}
