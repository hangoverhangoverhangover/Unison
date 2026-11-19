// Tap-along lyric sync for the lyrics editor. The song plays; the first tap marks the
// first line (or word, in word mode) starting, and every tap after marks the one being
// sung ending, which is when the next one starts. One more tap than units in all.
import type { LyricLine } from '@shared/lyrics'

export interface SyncState {
  mode: 'lines' | 'words'
  lines: string[]
  /** Words per line (word mode). */
  words: string[][]
  /** Start of each unit (line or word, in order), then the end of the last one. */
  stamps: number[]
  /** Taps so far. */
  cursor: number
  /** Units (lines or words); a full sync takes total + 1 taps. */
  total: number
  done: boolean
}

/** Split a line into words, each keeping the spaces after it. */
export function wordsOf(line: string): string[] {
  return line.match(/\S+\s*/g) ?? []
}

export function startSync(text: string, mode: SyncState['mode']): SyncState {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  const words = lines.map(wordsOf)
  const total = mode === 'lines' ? lines.length : words.reduce((n, w) => n + w.length, 0)
  return { mode, lines, words, stamps: [], cursor: 0, total, done: total === 0 }
}

/** Stamp the next unit at `positionMs` (ignored if it's before the previous stamp). */
export function tap(s: SyncState, positionMs: number): SyncState {
  if (s.done) return s
  const last = s.stamps[s.cursor - 1]
  if (last !== undefined && positionMs < last) return s
  const stamps = [...s.stamps.slice(0, s.cursor), Math.round(positionMs)]
  const cursor = s.cursor + 1
  return { ...s, stamps, cursor, done: cursor > s.total }
}

export function undo(s: SyncState): SyncState {
  if (s.cursor === 0) return s
  const cursor = s.cursor - 1
  return { ...s, stamps: s.stamps.slice(0, cursor), cursor, done: false }
}

/** The stamped lines so far (all of them once done). */
export function buildLines(s: SyncState): LyricLine[] {
  if (s.mode === 'lines') {
    return s.stamps.map((timeMs, i) => ({ timeMs, text: s.lines[i] ?? '' }))
  }
  const out: LyricLine[] = []
  let k = 0
  s.words.forEach((ws, i) => {
    const words = ws
      .map((text) => ({ text, timeMs: s.stamps[k++] }))
      .filter((w): w is { text: string; timeMs: number } => w.timeMs !== undefined)
    if (words.length === 0) return
    out.push({ timeMs: words[0]!.timeMs, text: s.lines[i]!, words })
  })
  // The end of the last word clears the line.
  const end = s.stamps[s.total]
  if (end !== undefined) out.push({ timeMs: end, text: '' })
  return out
}

/** The unit being sung now (before the first tap: the first one, coming up). */
export function currentUnit(s: SyncState): number {
  return Math.max(0, Math.min(s.cursor - 1, s.total - 1))
}

/** Index of the line being sung (for highlighting). */
export function currentLineIndex(s: SyncState): number {
  if (s.mode === 'lines') return currentUnit(s)
  let k = currentUnit(s)
  for (let i = 0; i < s.words.length; i++) {
    if (k < s.words[i]!.length) return i
    k -= s.words[i]!.length
  }
  return s.lines.length - 1
}
