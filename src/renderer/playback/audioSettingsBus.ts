// Tiny pub/sub for live audio settings: Settings publishes, the audio engine listens.
import type { AudioSettings } from '@shared/playback'

const listeners = new Set<(s: AudioSettings) => void>()
let latest: AudioSettings | null = null

export function publishAudioSettings(s: AudioSettings): void {
  latest = s
  for (const l of listeners) l(s)
}

/** Calls back now with the latest settings (if any) and on every change. */
export function onAudioSettings(listener: (s: AudioSettings) => void): () => void {
  listeners.add(listener)
  if (latest) listener(latest)
  return () => {
    listeners.delete(listener)
  }
}
