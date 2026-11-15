// Wires the Jam sync engine to the app: the Jam store, the Spotify store, prefs and IPC.
// Call once at startup, after the service stores are bound: startJam(playback).
import { DEFAULT_APP_PREFS } from '@shared/config'
import type { JamUnplayable } from '@shared/jam'
import { bindJamEvents, useJam } from '@renderer/state/jam'
import { useSpotify } from '@renderer/state/services'
import type { PlaybackController } from './controller'
import { bindJamSync } from './jamSync'

export function startJam(controller: PlaybackController): () => void {
  const offEvents = bindJamEvents()

  let unplayable: JamUnplayable = DEFAULT_APP_PREFS.jamUnplayable
  const prefListeners = new Set<() => void>()
  const setUnplayable = (v: JamUnplayable): void => {
    if (v === unplayable) return
    unplayable = v
    for (const l of [...prefListeners]) l()
  }
  void window.api
    .invoke('prefs:get')
    .then((p) => setUnplayable(p.jamUnplayable))
    .catch(() => undefined)
  const offPrefs = window.api.on('prefs:changed', (p) => setUnplayable(p.jamUnplayable))

  const offSync = bindJamSync(controller, {
    getStatus: () => useJam.getState().status,
    subscribeStatus: (listener) =>
      useJam.subscribe((s, prev) => {
        if (s.status !== prev.status) listener(s.status)
      }),
    send: (command) => window.api.invoke('jam:send', command),
    setCapabilities: (canPlay) => window.api.invoke('jam:setCapabilities', canPlay),
    findOn: (track, service) => window.api.invoke('music:findOn', track, service),
    getCapabilities: () => ({
      spotify: useSpotify.getState().status?.state === 'connected',
      soundcloud: true
    }),
    subscribeCapabilities: (listener) =>
      useSpotify.subscribe((s, prev) => {
        if (s.status !== prev.status) listener()
      }),
    getUnplayable: () => unplayable,
    subscribeUnplayable: (listener) => {
      prefListeners.add(listener)
      return () => prefListeners.delete(listener)
    },
    report: (patch) => useJam.setState(patch)
  })

  return () => {
    offSync()
    offPrefs()
    offEvents()
    prefListeners.clear()
  }
}
