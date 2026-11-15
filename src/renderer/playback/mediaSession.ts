// OS media session: hardware media keys and the Windows media overlay. In
// Electron these work through navigator.mediaSession with no extra wiring.

import type { PlaybackState } from '@shared/playback'
import type { PlaybackController } from './controller'

const SEEK_STEP_S = 10

type Actions = Partial<Record<MediaSessionAction, MediaSessionActionHandler>>

export function bindMediaSession(controller: PlaybackController): () => void {
  const session = typeof navigator === 'undefined' ? undefined : navigator.mediaSession
  if (!session) return () => {}

  const setHandler = (
    action: MediaSessionAction,
    handler: MediaSessionActionHandler | null
  ): void => {
    try {
      session.setActionHandler(action, handler)
    } catch {
      // action not supported by this Chromium
    }
  }

  const seekBy = (deltaMs: number): void => {
    const s = controller.getState()
    const max = s.durationMs > 0 ? s.durationMs : Number.POSITIVE_INFINITY
    controller.seek(Math.min(max, Math.max(0, controller.getPositionMs() + deltaMs)))
  }

  const actions: Actions = {
    play: () => void controller.play(),
    pause: () => controller.pause(),
    previoustrack: () => void controller.previous(),
    nexttrack: () => void controller.next(),
    seekto: (d) => {
      if (d.seekTime != null && Number.isFinite(d.seekTime)) controller.seek(d.seekTime * 1000)
    },
    seekbackward: (d) => seekBy(-(d.seekOffset ?? SEEK_STEP_S) * 1000),
    seekforward: (d) => seekBy((d.seekOffset ?? SEEK_STEP_S) * 1000)
  }
  for (const [action, handler] of Object.entries(actions)) {
    setHandler(action as MediaSessionAction, handler ?? null)
  }

  // Main takes the hardware keys system-wide while a track is loaded (see main/mediaKeys.ts).
  let keysActive = false
  const setKeysActive = (active: boolean): void => {
    if (active === keysActive) return
    keysActive = active
    void window.api.invoke('media:setActive', active).catch(() => undefined)
  }
  const offKey = window.api.on('media:key', (key) => {
    if (key === 'playpause') void controller.toggle()
    else if (key === 'next') void controller.next()
    else if (key === 'previous') void controller.previous()
    else controller.pause()
  })

  let lastTrackUid: string | null = null
  let lastArtwork: string | undefined

  const apply = (s: PlaybackState): void => {
    const track = s.current?.track
    // Metadata only changes with the track (or late-arriving artwork).
    if ((s.current?.uid ?? null) !== lastTrackUid || track?.artworkUrl !== lastArtwork) {
      lastTrackUid = s.current?.uid ?? null
      lastArtwork = track?.artworkUrl
      try {
        session.metadata =
          track && typeof MediaMetadata !== 'undefined'
            ? new MediaMetadata({
                title: track.title,
                artist: track.artists.join(', '),
                album: track.album ?? '',
                artwork: track.artworkUrl ? [{ src: track.artworkUrl }] : []
              })
            : null
      } catch {
        // ignore bad artwork URLs etc.
      }
    }

    setKeysActive(!!s.current)
    session.playbackState =
      s.status === 'playing' || s.status === 'loading' ? 'playing' : s.current ? 'paused' : 'none'

    try {
      const duration = s.durationMs / 1000
      if (track && Number.isFinite(duration) && duration > 0) {
        const position = Math.min(duration, Math.max(0, controller.getPositionMs() / 1000))
        session.setPositionState({
          duration,
          position: Number.isFinite(position) ? position : 0,
          playbackRate: 1
        })
      } else {
        session.setPositionState()
      }
    } catch {
      // setPositionState throws on invalid values in some builds
    }
  }

  apply(controller.getState())
  const unsubscribe = controller.subscribe(apply)

  return () => {
    unsubscribe()
    offKey()
    setKeysActive(false)
    for (const action of Object.keys(actions)) setHandler(action as MediaSessionAction, null)
    try {
      session.metadata = null
      session.playbackState = 'none'
    } catch {
      // ignore
    }
  }
}
