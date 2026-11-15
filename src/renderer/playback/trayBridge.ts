// Sends a small now-playing summary to the tray whenever it changes.
import type { NowPlaying, PlaybackState } from '@shared/playback'

export function toNowPlaying(s: PlaybackState): NowPlaying | null {
  const t = s.current?.track
  if (!t) return null
  return {
    title: t.title,
    artists: t.artists.join(', '),
    playing: s.status === 'playing' || s.status === 'loading'
  }
}

export function bindTray(
  controller: { getState(): PlaybackState; subscribe(l: (s: PlaybackState) => void): () => void },
  send: (n: NowPlaying | null) => void = (n) =>
    void window.api.invoke('tray:nowPlaying', n).catch(() => undefined)
): () => void {
  let last = ''
  const apply = (s: PlaybackState): void => {
    const n = toNowPlaying(s)
    const k = JSON.stringify(n)
    if (k === last) return
    last = k
    send(n)
  }
  apply(controller.getState())
  return controller.subscribe(apply)
}
