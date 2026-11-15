// Jam (shared listening) contracts. Owned by the main agent.
// The relay (relay/) and the app (src/main/jam, src/renderer/playback/jam*) both import
// this file, so it must stay free of Electron and Node imports.
import type { Track } from './types'

/** What a Jam shares about a track: never local files, never paths or tokens. */
export interface JamTrack {
  /** `${provider}:${nativeId}` */
  id: string
  provider: 'spotify' | 'soundcloud'
  nativeId: string
  title: string
  artists: string[]
  durationMs: number
  artworkUrl?: string
  isrc?: string
  url?: string
}

export interface JamEntry {
  /** Unique per queue entry (the same track can be queued twice). */
  entryId: string
  track: JamTrack
  /** Participant id of who added it. */
  addedBy: string
}

/** Which services this participant can play right now. */
export interface JamCapabilities {
  spotify: boolean
  soundcloud: boolean
}

export interface JamParticipant {
  id: string
  name: string
  isHost: boolean
  canPlay: JamCapabilities
}

export interface JamRoomState {
  code: string
  participants: JamParticipant[]
  queue: JamEntry[]
  /** Index into `queue` of the playing entry, or -1 before anything plays. */
  currentIndex: number
  playing: boolean
  /** Position at `positionAt` (relay clock, epoch ms); extrapolate while playing. */
  positionMs: number
  positionAt: number
  /** Host setting: reject adding tracks that someone in the room can't play. */
  blockUnplayable: boolean
  /** Bumped on every change. */
  version: number
}

/** Commands a participant sends. Host-only ones are rejected for guests. */
export type JamCommand =
  | { type: 'add'; tracks: JamTrack[] }
  | { type: 'play'; index: number; positionMs?: number }
  | { type: 'pause'; positionMs: number }
  | { type: 'resume'; positionMs: number }
  | { type: 'seek'; positionMs: number }
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'remove'; entryId: string }
  | { type: 'move'; entryId: string; toIndex: number }
  | { type: 'setBlockUnplayable'; on: boolean }
  /** Host: the current entry finished; advance (ignored if it isn't current). */
  | { type: 'ended'; entryId: string }
  | { type: 'end' }

export const HOST_ONLY: ReadonlySet<JamCommand['type']> = new Set([
  'play',
  'pause',
  'resume',
  'seek',
  'next',
  'previous',
  'remove',
  'move',
  'setBlockUnplayable',
  'ended',
  'end'
])

/** Client → relay frames. */
export type JamClientMessage =
  | { type: 'hello'; name: string; canPlay: JamCapabilities }
  | { type: 'command'; command: JamCommand }
  | { type: 'capabilities'; canPlay: JamCapabilities }
  | { type: 'ping'; t: number }

/** Relay → client frames. */
export type JamServerMessage =
  | { type: 'welcome'; you: string; state: JamRoomState }
  | { type: 'state'; state: JamRoomState }
  | { type: 'error'; message: string }
  | { type: 'pong'; t: number; serverTime: number }
  /** The host ended the Jam (or the room expired). */
  | { type: 'closed'; reason: string }

/** POST {relay}/rooms → this. WebSocket: {relay}/rooms/{code}/ws (+ ?secret= for the host). */
export interface JamCreated {
  code: string
  hostSecret: string
}

/**
 * Built-in Jam relay (the owner's Cloudflare Worker). Not a secret: everyone in a Jam
 * must use the same relay. JAM_RELAY_URL in .env/config.json or Settings → Jam override it.
 */
export const DEFAULT_JAM_RELAY_URL = 'https://combined-player-jam.exxen.workers.dev'

/** Room codes: 6 characters from an alphabet without look-alikes. */
export const JAM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const JAM_CODE_LENGTH = 6
export const JAM_LIMITS = {
  participants: 20,
  queue: 500,
  nameLength: 40,
  /** Max size of one client frame, bytes. */
  frameBytes: 64 * 1024,
  /** Commands per participant per 10 s. */
  commandsPer10s: 40
} as const

/** What the app shows and the renderer reacts to. */
export interface JamStatus {
  state: 'off' | 'connecting' | 'connected' | 'reconnecting'
  role?: 'host' | 'guest'
  /** Your participant id in the room. */
  you?: string
  room?: JamRoomState
  /** relay clock − local clock, ms (from ping/pong); add to Date.now() for relay time. */
  clockOffsetMs: number
  error?: string
}

/** Settings → "When someone can't play a track". */
export type JamUnplayable = 'match' | 'skip' | 'block'

export function toJamTrack(t: Track): JamTrack | null {
  if (t.provider !== 'spotify' && t.provider !== 'soundcloud') return null
  const out: JamTrack = {
    id: t.id,
    provider: t.provider,
    nativeId: t.nativeId,
    title: t.title,
    artists: t.artists,
    durationMs: t.durationMs
  }
  if (t.artworkUrl?.startsWith('https://')) out.artworkUrl = t.artworkUrl
  if (t.isrc) out.isrc = t.isrc
  if (t.url) out.url = t.url
  return out
}

export function fromJamTrack(t: JamTrack): Track {
  return { ...t }
}
