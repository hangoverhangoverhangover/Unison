// Counts plays: once per queue entry, after PLAY_COUNT_MIN_MS of actual listening
// (or half the track when it's shorter). Seeking doesn't count as listening.
import { PLAY_COUNT_MIN_MS, type PlayReport } from '@shared/history'
import type { PlaybackState } from '@shared/playback'

interface Entry {
  uid: string
  startedAt: number
  playedMs: number
  /** Wall-clock time playback last resumed, or null while not playing. */
  since: number | null
  counted: boolean
}

export function threshold(durationMs: number): number {
  return durationMs > 0 ? Math.min(PLAY_COUNT_MIN_MS, durationMs / 2) : PLAY_COUNT_MIN_MS
}

export function bindHistory(
  controller: { getState(): PlaybackState; subscribe(l: (s: PlaybackState) => void): () => void },
  record: (r: PlayReport) => void = (r) =>
    void window.api.invoke('history:record', r).catch(() => undefined),
  now: () => number = () => Date.now(),
  tickMs = 1000
): () => void {
  let entry: Entry | null = null
  let state = controller.getState()

  const settle = (): void => {
    if (!entry || entry.since === null) return
    const t = now()
    entry.playedMs += t - entry.since
    entry.since = t
  }
  const check = (): void => {
    if (!entry || entry.counted) return
    settle()
    const track = state.current?.track
    if (!track || state.current?.uid !== entry.uid) return
    if (entry.playedMs >= threshold(state.durationMs || track.durationMs)) {
      entry.counted = true
      record({ track, playedMs: Math.round(entry.playedMs), startedAt: entry.startedAt })
    }
  }

  const onState = (s: PlaybackState): void => {
    settle()
    state = s
    const uid = s.current?.uid ?? null
    if (uid !== (entry?.uid ?? null)) {
      entry = uid ? { uid, startedAt: now(), playedMs: 0, since: null, counted: false } : null
    }
    if (entry) entry.since = s.status === 'playing' ? (entry.since ?? now()) : null
    check()
  }

  onState(state)
  const unsubscribe = controller.subscribe(onState)
  const timer = setInterval(check, tickMs)
  return () => {
    unsubscribe()
    clearInterval(timer)
  }
}
