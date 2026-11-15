// Main window side of the mini player: publishes playback while the mini player is
// open and runs the controls it sends. Nothing is sent while it's closed.
import type { MiniCommand, MiniState } from '@shared/match'
import type { PlaybackState } from '@shared/playback'

/** Re-sent this often while playing so the mini player's extrapolated clock can't drift. */
export const RESYNC_MS = 5000

interface Source {
  subscribe(listener: (s: PlaybackState) => void): () => void
  getState(): PlaybackState
  getPositionMs(): number
  toggle(): Promise<void>
  next(): Promise<void>
  previous(): Promise<void>
  seek(ms: number): void
}

export function toMiniState(s: PlaybackState, positionMs: number, now: number): MiniState {
  return {
    track: s.current?.track ?? null,
    status: s.status,
    positionMs: Math.max(0, Math.round(positionMs)),
    at: now,
    durationMs: s.durationMs || s.current?.track.durationMs || 0,
    shuffle: s.shuffle,
    repeat: s.repeat,
    hasNext: s.queue.length > 0
  }
}

export function runMiniCommand(controller: Source, c: MiniCommand): void {
  switch (c.type) {
    case 'toggle':
      void controller.toggle()
      return
    case 'next':
      void controller.next()
      return
    case 'previous':
      void controller.previous()
      return
    case 'seek':
      if (Number.isFinite(c.positionMs)) controller.seek(Math.max(0, c.positionMs))
  }
}

export function bindMiniBridge(
  controller: Source,
  onOpenChange: (open: boolean) => void,
  publish: (s: MiniState) => void = (s) => void window.api.invoke('mini:publish', s)
): () => void {
  let open = false
  let unsubscribe: (() => void) | undefined
  let timer: ReturnType<typeof setInterval> | undefined

  const send = (): void =>
    publish(toMiniState(controller.getState(), controller.getPositionMs(), Date.now()))
  const start = (): void => {
    send()
    unsubscribe = controller.subscribe(send)
    timer = setInterval(() => {
      if (controller.getState().status === 'playing') send()
    }, RESYNC_MS)
  }
  const stop = (): void => {
    unsubscribe?.()
    unsubscribe = undefined
    if (timer) clearInterval(timer)
    timer = undefined
  }

  const offs = [
    window.api.on('mini:open', (next) => {
      if (next === open) return
      open = next
      onOpenChange(open)
      if (open) start()
      else stop()
    }),
    window.api.on('mini:command', (c) => {
      runMiniCommand(controller, c)
      // Seeks don't always change status; push the new position right away.
      if (open) setTimeout(send, 50)
    })
  ]
  return () => {
    stop()
    offs.forEach((off) => off())
  }
}
