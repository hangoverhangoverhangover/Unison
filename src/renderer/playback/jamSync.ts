// Jam sync engine. While a Jam is connected the ROOM is authoritative for everyone, host
// included: the current room entry is loaded on its own (the local queue is not used),
// play/pause is mirrored and drift over DRIFT_MS is corrected with a seek.
//
// Local controls: while a Jam is active this patches the controller's transport methods
// in place (play, pause, toggle, seek, next, previous, playTracks, playNext, addToQueue,
// cycleRepeat, restore) and puts the originals back when the Jam ends. Every caller (the
// PlayBar, the OS media session / media keys, keyboard shortcuts, the mini player, the
// tray) already calls `playback.<method>()` at call time, so they all go through the Jam
// with no changes:
// - host: play/pause/seek/next/previous become room commands (with an optimistic local
//   pause/play/seek so the button feels instant; the next room state confirms it).
// - guests: transport controls do nothing. Volume and mute stay local for everyone.
// - anyone: "play this track" / "add to queue" / "play next" add the track(s) to the Jam
//   queue instead (local files are refused with a notice).
// The engine itself drives playback through the original methods it saved at bind time.

import type { FindResult } from '@shared/match'
import type { PlaybackState, PlaybackStatus, RepeatMode } from '@shared/playback'
import type { Track } from '@shared/types'
import {
  fromJamTrack,
  toJamTrack,
  type JamCapabilities,
  type JamCommand,
  type JamEntry,
  type JamRoomState,
  type JamStatus,
  type JamUnplayable
} from '@shared/jam'
import type { PlaybackController } from './controller'

/** Local position further than this from the room's is corrected with a seek. */
export const DRIFT_MS = 2000
/** How often drift and play/pause are checked. */
export const SYNC_EVERY_MS = 2000
/** previous() restarts the current track past this position (as the controller does). */
export const RESTART_MS = 3000
/** A new track is loaded and then seeked to the room position when it is past this. */
const SEEK_AFTER_LOAD_MIN_MS = 1000
/** Host: a skipped entry counts as ended this long after its duration (relay clock). */
const SKIP_END_GRACE_MS = 0

export const LOCAL_FILE_NOTICE = "Local files can't be added to a Jam."

export type JamSyncControllerKeys =
  | 'playTracks'
  | 'play'
  | 'pause'
  | 'toggle'
  | 'seek'
  | 'next'
  | 'previous'
  | 'playNext'
  | 'addToQueue'
  | 'cycleRepeat'
  | 'restore'
  | 'getState'
  | 'getPositionMs'
  | 'subscribe'
export type JamSyncController = Pick<PlaybackController, JamSyncControllerKeys>

/** What the sync engine tells the UI (kept in the Jam store). */
export interface JamSyncReport {
  /** The current entry is playing as another service's version. */
  substitute: { entryId: string; track: Track; reason: string } | null
  /** The current entry can't be played here; silent until the next one. */
  skipped: { entryId: string; reason: string } | null
  /** A one-off message, e.g. a local file was refused or a command failed. */
  notice: string | null
}

export interface JamSyncDeps {
  getStatus(): JamStatus
  subscribeStatus(listener: (s: JamStatus) => void): () => void
  send(command: JamCommand): Promise<void>
  setCapabilities(canPlay: JamCapabilities): Promise<void> | void
  findOn(track: Track, service: 'spotify' | 'soundcloud'): Promise<FindResult>
  /** What this app can play right now (Spotify connected; SoundCloud always). */
  getCapabilities(): JamCapabilities
  subscribeCapabilities(listener: () => void): () => void
  getUnplayable(): JamUnplayable
  subscribeUnplayable(listener: () => void): () => void
  report(patch: Partial<JamSyncReport>): void
  now?: () => number
  setInterval?: (fn: () => void, ms: number) => unknown
  clearInterval?: (id: unknown) => void
}

type Service = 'spotify' | 'soundcloud'
const LABEL: Record<Service, string> = { spotify: 'Spotify', soundcloud: 'SoundCloud' }
const other = (s: Service): Service => (s === 'spotify' ? 'soundcloud' : 'spotify')
const message = (err: unknown): string =>
  (err instanceof Error ? err.message : String(err)).replace(
    /^Error invoking remote method '[^']+': (?:\w*Error: )?/,
    ''
  )

export function currentEntry(room: JamRoomState | undefined): JamEntry | undefined {
  if (!room || room.currentIndex < 0) return undefined
  return room.queue[room.currentIndex]
}

/** Where the room is now, in ms into the current entry. */
export function desiredPosition(room: JamRoomState, relayNow: number): number {
  return Math.max(0, room.positionMs + (room.playing ? relayNow - room.positionAt : 0))
}

type Mode = 'idle' | 'loading' | 'playing' | 'substitute' | 'skipped'

export function bindJamSync(controller: JamSyncController, deps: JamSyncDeps): () => void {
  const now = deps.now ?? Date.now
  const setIntervalFn = deps.setInterval ?? ((fn, ms) => setInterval(fn, ms))
  const clearIntervalFn =
    deps.clearInterval ?? ((id) => clearInterval(id as ReturnType<typeof setInterval>))

  // The real methods, used by the engine itself (and put back when the Jam ends).
  const orig = {
    playTracks: controller.playTracks,
    play: controller.play,
    pause: controller.pause,
    toggle: controller.toggle,
    seek: controller.seek,
    next: controller.next,
    previous: controller.previous,
    playNext: controller.playNext,
    addToQueue: controller.addToQueue,
    cycleRepeat: controller.cycleRepeat,
    restore: controller.restore
  }

  let status: JamStatus = deps.getStatus()
  let active = false
  let mode: Mode = 'idle'
  let loadedEntryId: string | null = null
  /** Bumped per load; async work from older loads is dropped. */
  let token = 0
  /** The local copy of this entry reached its end (waiting for the room to move on). */
  let endedEntryId: string | null = null
  /** Host: entry we already reported `ended` for. */
  let endedSent: string | null = null
  let savedRepeat: RepeatMode | null = null
  let blockSent: string | null = null
  let lastCaps: JamCapabilities | null = null
  /** Spotify refused playback for this account (e.g. not Premium). */
  let spotifyRefused = false
  let lastBaseSpotify = deps.getCapabilities().spotify
  let prevLocal: PlaybackStatus = controller.getState().status
  let disposed = false

  const isHost = (): boolean => status.role === 'host'
  const relayNow = (): number => now() + status.clockOffsetMs
  const desired = (): number => (status.room ? desiredPosition(status.room, relayNow()) : 0)
  const caps = (): JamCapabilities => {
    const base = deps.getCapabilities()
    return { spotify: base.spotify && !spotifyRefused, soundcloud: base.soundcloud }
  }

  const notice = (err: unknown): void => deps.report({ notice: message(err) })
  const send = (command: JamCommand): void => void deps.send(command).catch(notice)

  const pushCaps = (): void => {
    const c = caps()
    if (lastCaps && lastCaps.spotify === c.spotify && lastCaps.soundcloud === c.soundcloud) return
    lastCaps = c
    void Promise.resolve()
      .then(() => deps.setCapabilities(c))
      .catch(() => undefined)
  }

  const syncBlock = (): void => {
    const room = status.room
    if (!active || status.state !== 'connected' || !isHost() || !room) return
    const want = deps.getUnplayable() === 'block'
    const key = `${room.code}:${want}`
    // Already right: nothing pending. Otherwise send once per room and value.
    if (room.blockUnplayable === want) {
      blockSent = null
      return
    }
    if (blockSent === key) return
    blockSent = key
    send({ type: 'setBlockUnplayable', on: want })
  }

  const sendEnded = (entryId: string): void => {
    if (!isHost() || endedSent === entryId) return
    endedSent = entryId
    void deps.send({ type: 'ended', entryId }).catch(() => {
      endedSent = null
    })
  }

  // -------------------------------------------------------------------------------------
  // Loading entries

  /** Loads `track` alone and lines it up with the room. Resolves to an error or null. */
  const playLocal = async (track: Track, my: number): Promise<string | null> => {
    const startPaused = status.room ? !status.room.playing : false
    let pending: Promise<void>
    try {
      pending = orig.playTracks([track], 0)
      if (startPaused) orig.pause()
      await pending
    } catch (err) {
      return message(err)
    }
    if (my !== token) return null
    const s = controller.getState()
    if (s.status === 'error') return s.error ?? "This track can't be played."
    const room = status.room
    if (room) {
      const d = desired()
      if (d > SEEK_AFTER_LOAD_MIN_MS) orig.seek(d)
      if (room.playing && s.status !== 'playing') await orig.play()
      else if (!room.playing && controller.getState().status === 'playing') orig.pause()
    }
    return null
  }

  const skip = (entry: JamEntry, reason: string): void => {
    mode = 'skipped'
    orig.pause()
    deps.report({ skipped: { entryId: entry.entryId, reason }, substitute: null })
  }

  const handleUnplayable = async (entry: JamEntry, reason: string, my: number): Promise<void> => {
    if (my !== token) return
    const from = entry.track.provider
    const to = other(from)
    if (deps.getUnplayable() === 'match' && caps()[to]) {
      mode = 'loading'
      let result: FindResult | null
      try {
        result = await deps.findOn(fromJamTrack(entry.track), to)
      } catch {
        result = null
      }
      if (my !== token) return
      const match = result?.matches[0]
      if (match) {
        const err = await playLocal(match.track, my)
        if (my !== token) return
        if (err === null) {
          mode = 'substitute'
          deps.report({
            substitute: {
              entryId: entry.entryId,
              track: match.track,
              reason: `${reason} Playing the ${LABEL[to]} version instead.`
            },
            skipped: null
          })
          return
        }
        reason = `${reason} The ${LABEL[to]} version didn't play either.`
      } else {
        reason = `${reason} No match on ${LABEL[to]}.`
      }
    }
    skip(entry, reason)
  }

  const loadEntry = async (entry: JamEntry): Promise<void> => {
    const my = ++token
    loadedEntryId = entry.entryId
    mode = 'loading'
    endedEntryId = null
    deps.report({ substitute: null, skipped: null })
    const track = fromJamTrack(entry.track)
    const provider = entry.track.provider
    if (!caps()[provider]) {
      await handleUnplayable(entry, `You can't play ${LABEL[provider]} tracks right now.`, my)
      return
    }
    const err = await playLocal(track, my)
    if (my !== token) return
    if (err === null) {
      mode = 'playing'
      return
    }
    if (provider === 'spotify' && /premium/i.test(err)) {
      spotifyRefused = true
      pushCaps()
    }
    await handleUnplayable(entry, err, my)
  }

  // -------------------------------------------------------------------------------------
  // Following the room

  const correct = (room: JamRoomState, entry: JamEntry): void => {
    const local = controller.getState()
    if (local.status === 'loading') return
    if (local.status === 'error') {
      if (mode === 'playing')
        void handleUnplayable(entry, local.error ?? "This track can't be played.", token)
      else skip(entry, local.error ?? "This track can't be played.")
      return
    }
    const d = desired()
    if (endedEntryId === entry.entryId) {
      const duration = local.durationMs || entry.track.durationMs
      // The host seeked back into the track: follow again.
      if (d < duration - 5000) endedEntryId = null
      else return
    }
    if (room.playing && local.status !== 'playing') void orig.play()
    else if (!room.playing && local.status === 'playing') orig.pause()
    if (Math.abs(controller.getPositionMs() - d) > DRIFT_MS) orig.seek(d)
  }

  const reconcile = (): void => {
    const room = status.room
    if (!active || status.state !== 'connected' || !room) return
    const entry = currentEntry(room)
    if (!entry) {
      if (loadedEntryId !== null) {
        token++
        loadedEntryId = null
        mode = 'idle'
        orig.pause()
        deps.report({ substitute: null, skipped: null })
      }
      return
    }
    if (entry.entryId !== loadedEntryId) {
      void loadEntry(entry)
      return
    }
    if (mode === 'playing' || mode === 'substitute') correct(room, entry)
    else if (mode === 'skipped' && isHost() && room.playing) {
      // Nobody here plays it, so the host's clock decides when it's over.
      if (desired() >= entry.track.durationMs + SKIP_END_GRACE_MS) sendEnded(entry.entryId)
    }
  }

  const onLocal = (s: PlaybackState): void => {
    const prev = prevLocal
    prevLocal = s.status
    if (!active || (mode !== 'playing' && mode !== 'substitute') || !loadedEntryId) return
    // The controller stops at the end of its one-track queue: paused, back at 0.
    if (prev === 'playing' && s.status === 'paused' && s.positionMs === 0 && s.current) {
      endedEntryId = loadedEntryId
      sendEnded(loadedEntryId)
    }
  }

  // -------------------------------------------------------------------------------------
  // Local controls during a Jam

  const commandPosition = (): number =>
    Math.round(mode === 'playing' || mode === 'substitute' ? controller.getPositionMs() : desired())
  const hearing = (): boolean => mode === 'playing' || mode === 'substitute'

  const addToJam = (tracks: Track[]): void => {
    const jam = tracks.map(toJamTrack).filter((t) => t !== null)
    if (jam.length < tracks.length) deps.report({ notice: LOCAL_FILE_NOTICE })
    if (jam.length > 0) send({ type: 'add', tracks: jam })
  }

  const jamPlay = async (): Promise<void> => {
    if (!isHost()) return
    send({ type: 'resume', positionMs: commandPosition() })
    if (hearing()) await orig.play()
  }
  const jamPause = (): void => {
    if (!isHost()) return
    send({ type: 'pause', positionMs: commandPosition() })
    if (hearing()) orig.pause()
  }
  const jamSeek = (ms: number): void => {
    if (!isHost() || !Number.isFinite(ms)) return
    const to = Math.max(0, Math.round(ms))
    send({ type: 'seek', positionMs: to })
    if (hearing()) orig.seek(to)
  }

  const patched: Partial<JamSyncController> = {
    play: jamPlay,
    pause: jamPause,
    toggle: async () => {
      if (status.room?.playing) jamPause()
      else await jamPlay()
    },
    seek: jamSeek,
    next: async () => {
      if (isHost()) send({ type: 'next' })
    },
    previous: async () => {
      if (!isHost()) return
      if (commandPosition() > RESTART_MS) jamSeek(0)
      else send({ type: 'previous' })
    },
    playTracks: async (tracks, startIndex) => {
      const t = tracks[startIndex]
      if (t) addToJam([t])
    },
    playNext: (tracks) => addToJam(tracks),
    addToQueue: (tracks) => addToJam(tracks),
    // Repeat stays off during a Jam so a track's end is seen; the room decides what's next.
    cycleRepeat: () => undefined,
    restore: async () => undefined
  }

  const install = (): void => void Object.assign(controller, patched)
  const uninstall = (): void => {
    for (const key of Object.keys(patched) as (keyof typeof orig)[]) {
      if (controller[key] === patched[key]) (controller as Record<string, unknown>)[key] = orig[key]
    }
  }

  // -------------------------------------------------------------------------------------
  // Entering and leaving

  const enter = (): void => {
    active = true
    savedRepeat = controller.getState().repeat
    for (let i = 0; i < 3 && controller.getState().repeat !== 'off'; i++) orig.cycleRepeat()
    // Whatever was playing from the local queue stops; the room's entry takes over.
    orig.pause()
    install()
    pushCaps()
  }

  const exit = (): void => {
    active = false
    token++
    uninstall()
    orig.pause()
    if (savedRepeat !== null)
      for (let i = 0; i < 3 && controller.getState().repeat !== savedRepeat; i++) orig.cycleRepeat()
    savedRepeat = null
    loadedEntryId = null
    mode = 'idle'
    endedEntryId = null
    endedSent = null
    blockSent = null
    deps.report({ substitute: null, skipped: null, notice: null })
  }

  const onStatus = (s: JamStatus): void => {
    if (disposed) return
    status = s
    const inJam = s.state === 'connected' || (active && s.state === 'reconnecting')
    if (inJam && !active) enter()
    else if (!inJam && active) exit()
    if (active && s.state === 'connected') {
      syncBlock()
      reconcile()
    }
  }

  const offs = [
    deps.subscribeStatus(onStatus),
    controller.subscribe(onLocal),
    deps.subscribeCapabilities(() => {
      const base = deps.getCapabilities().spotify
      if (base && !lastBaseSpotify) spotifyRefused = false
      lastBaseSpotify = base
      pushCaps()
    }),
    deps.subscribeUnplayable(syncBlock)
  ]
  const timer = setIntervalFn(() => {
    if (active) reconcile()
  }, SYNC_EVERY_MS)

  pushCaps()
  onStatus(status)

  return () => {
    if (disposed) return
    clearIntervalFn(timer)
    offs.forEach((off) => off())
    if (active) exit()
    disposed = true
  }
}
