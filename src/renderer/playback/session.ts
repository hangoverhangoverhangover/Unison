// Session restore (QoL round 2): saves the queue, current track, position, volume,
// shuffle and repeat to main, and puts them back when the app starts.
import type { PlaybackState, SessionSnapshot } from '@shared/playback'

/** Changes are saved after this quiet period. */
export const SAVE_DEBOUNCE_MS = 1000
/** While playing, the position is also saved this often. */
export const POSITION_SAVE_MS = 10_000
/** Biggest queue kept (main truncates beyond this too). */
const MAX_QUEUE = 2000

interface Source {
  getState(): PlaybackState
  getPositionMs(): number
  subscribe(listener: (s: PlaybackState) => void): () => void
  restore(snapshot: SessionSnapshot): Promise<void>
}

export function toSnapshot(s: PlaybackState, positionMs: number, now: Date): SessionSnapshot {
  return {
    current: s.current,
    queue: s.queue.slice(0, MAX_QUEUE),
    positionMs: Math.max(0, Math.round(positionMs)),
    volume: s.volume,
    muted: s.muted,
    shuffle: s.shuffle,
    repeat: s.repeat,
    savedAt: now.toISOString()
  }
}

/** Fingerprint of what's worth saving (not the ticking position). */
function key(s: PlaybackState): string {
  return JSON.stringify([
    s.current?.uid ?? null,
    s.queue.map((q) => q.uid),
    s.volume,
    s.muted,
    s.shuffle,
    s.repeat,
    s.status === 'playing'
  ])
}

export function bindSession(
  controller: Source,
  io: {
    load: () => Promise<SessionSnapshot | null>
    save: (s: SessionSnapshot) => void
  } = {
    load: () => window.api.invoke('session:load'),
    save: (s) => void window.api.invoke('session:save', s).catch(() => undefined)
  }
): () => void {
  let disposed = false
  let restored = false
  let lastKey = ''
  let timer: ReturnType<typeof setTimeout> | undefined

  const saveNow = (): void => {
    if (timer) clearTimeout(timer)
    timer = undefined
    io.save(toSnapshot(controller.getState(), controller.getPositionMs(), new Date()))
  }
  const schedule = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(saveNow, SAVE_DEBOUNCE_MS)
  }

  // Restore first; saving starts only after, so an empty startup can't overwrite it.
  void io
    .load()
    .then((snap) => (snap && !disposed ? controller.restore(snap) : undefined))
    .catch(() => undefined)
    .finally(() => {
      restored = true
      lastKey = key(controller.getState())
    })

  const unsubscribe = controller.subscribe((s) => {
    if (!restored) return
    const k = key(s)
    if (k === lastKey) return
    lastKey = k
    schedule()
  })
  const tick = setInterval(() => {
    if (restored && controller.getState().status === 'playing') saveNow()
  }, POSITION_SAVE_MS)
  const onUnload = (): void => {
    if (restored) saveNow()
  }
  window.addEventListener('beforeunload', onUnload)

  return () => {
    disposed = true
    unsubscribe()
    clearInterval(tick)
    if (timer) clearTimeout(timer)
    window.removeEventListener('beforeunload', onUnload)
  }
}
