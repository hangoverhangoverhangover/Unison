// Last.fm: "now playing" when a queue entry starts playing, and one scrobble per entry
// once it has really played for half its length or 4 minutes (Last.fm's rule; tracks
// of 30 s or less never scrobble). Paused time and seeking don't count. Main decides
// which services scrobble and keeps the offline waiting list.
import { scrobbleAfterMs, type ScrobbleReport } from '@shared/lastfm'
import type { PlaybackState } from '@shared/playback'
import type { Track } from '@shared/types'

interface Entry {
  uid: string
  startedAt: number
  playedMs: number
  /** When playback last resumed, or null while not playing. */
  since: number | null
  announced: boolean
  scrobbled: boolean
}

export interface LastfmSink {
  nowPlaying(track: Track): void
  scrobble(report: ScrobbleReport): void
}

const ipcSink: LastfmSink = {
  nowPlaying: (track) => void window.api.invoke('lastfm:nowPlaying', track).catch(() => undefined),
  scrobble: (report) => void window.api.invoke('lastfm:scrobble', report).catch(() => undefined)
}

export function bindLastfm(
  controller: { getState(): PlaybackState; subscribe(l: (s: PlaybackState) => void): () => void },
  sink: LastfmSink = ipcSink,
  now: () => number = () => Date.now(),
  every: (fn: () => void) => () => void = (fn) => {
    const id = setInterval(fn, 1000)
    return () => clearInterval(id)
  }
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
    if (!entry) return
    settle()
    const track = state.current?.track
    if (!track || state.current?.uid !== entry.uid) return
    if (!entry.announced && state.status === 'playing') {
      entry.announced = true
      sink.nowPlaying(track)
    }
    if (entry.scrobbled) return
    const after = scrobbleAfterMs(state.durationMs || track.durationMs)
    if (after !== null && entry.playedMs >= after) {
      entry.scrobbled = true
      sink.scrobble({ track, startedAt: entry.startedAt })
    }
  }

  const onState = (s: PlaybackState): void => {
    settle()
    state = s
    const uid = s.current?.uid ?? null
    if (uid !== (entry?.uid ?? null)) {
      entry = uid
        ? { uid, startedAt: now(), playedMs: 0, since: null, announced: false, scrobbled: false }
        : null
    }
    if (entry) entry.since = s.status === 'playing' ? (entry.since ?? now()) : null
    check()
  }

  onState(state)
  const unsubscribe = controller.subscribe(onState)
  const stop = every(check)
  return () => {
    unsubscribe()
    stop()
  }
}
