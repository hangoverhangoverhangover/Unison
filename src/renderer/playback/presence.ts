// Discord presence bridge: turns the playback state stream into the few updates
// Discord needs (track change, resume, seek, and a clear on pause or stop). Main does the rest.
import type { PresenceTrack, PresenceUpdate } from '@shared/discord'
import type { PlaybackState } from '@shared/playback'
import type { Track } from '@shared/types'

/** A start-time shift beyond this counts as a seek (normal drift stays below it). */
export const SEEK_THRESHOLD_MS = 2000

export interface PresenceMemory {
  trackId: string | null
  state: PresenceUpdate['state']
  startedAtMs: number
}

export const INITIAL_MEMORY: PresenceMemory = { trackId: null, state: 'stopped', startedAtMs: 0 }

function presenceTrack(t: Track): PresenceTrack {
  return {
    title: t.title,
    artists: t.artists,
    ...(t.album ? { album: t.album } : {}),
    provider: t.provider,
    ...(t.artworkUrl ? { artworkUrl: t.artworkUrl } : {}),
    ...(t.url ? { url: t.url } : {}),
    ...(t.artistRefs?.[0]?.url ? { artistUrl: t.artistRefs[0].url } : {})
  }
}

/**
 * The update to send for this state, or null when Discord already shows the right
 * thing. Pure, so it's testable; `positionMs` is the live position, `now` epoch ms.
 */
export function nextPresence(
  s: PlaybackState,
  positionMs: number,
  now: number,
  last: PresenceMemory
): { update: PresenceUpdate; memory: PresenceMemory } | null {
  const track = s.current?.track
  // Paused clears the presence too: Discord shows nothing while nothing is playing.
  if (!track || s.status === 'idle' || s.status === 'error' || s.status === 'paused') {
    if (last.state === 'stopped') return null
    return { update: { state: 'stopped' }, memory: INITIAL_MEMORY }
  }
  // While a track is loading, keep showing what was there until it actually plays.
  if (s.status === 'loading' && last.trackId !== track.id) return null

  // playing (or buffering mid-track)
  const startedAtMs = Math.round(now - Math.max(0, positionMs))
  const same =
    last.state === 'playing' &&
    last.trackId === track.id &&
    Math.abs(startedAtMs - last.startedAtMs) < SEEK_THRESHOLD_MS
  if (same) return null
  return {
    update: {
      state: 'playing',
      track: presenceTrack(track),
      startedAtMs,
      durationMs: Math.max(0, Math.round(s.durationMs || track.durationMs || 0))
    },
    memory: { trackId: track.id, state: 'playing', startedAtMs }
  }
}

interface PresenceSource {
  subscribe(listener: (s: PlaybackState) => void): () => void
  getState(): PlaybackState
  getPositionMs(): number
}

/** Wire a playback controller to main's discord:update. Returns an unbind function. */
export function bindPresence(
  controller: PresenceSource,
  send: (u: PresenceUpdate) => void = (u) => void window.api.invoke('discord:update', u),
  now: () => number = () => Date.now()
): () => void {
  let memory = INITIAL_MEMORY
  const onState = (s: PlaybackState): void => {
    const next = nextPresence(s, controller.getPositionMs(), now(), memory)
    if (!next) return
    memory = next.memory
    send(next.update)
  }
  onState(controller.getState())
  return controller.subscribe(onState)
}
