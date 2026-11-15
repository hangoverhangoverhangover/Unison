// Pure room logic for the Jam relay. No Workers APIs here (only standard JS globals such as
// crypto.getRandomValues, URL and TextEncoder), so it runs under plain Vitest in Node.
// The protocol types come straight from the app's contract so they cannot drift.
import {
  HOST_ONLY,
  JAM_CODE_ALPHABET,
  JAM_CODE_LENGTH,
  JAM_LIMITS,
  type JamCapabilities,
  type JamClientMessage,
  type JamCommand,
  type JamEntry,
  type JamParticipant,
  type JamRoomState,
  type JamTrack
} from '../../src/shared/jam'

export const HELLO_TIMEOUT_MS = 10_000
export const HOST_GRACE_MS = 5 * 60_000
export const EMPTY_ROOM_MS = 5 * 60_000
export const RATE_WINDOW_MS = 10_000
export const MAX_TEXT = 500
export const MAX_ARTISTS = 20

const PROVIDER_LABEL = { spotify: 'Spotify', soundcloud: 'SoundCloud' } as const

export type ApplyResult = { state: JamRoomState } | { error: string } | { end: true }

export interface ApplyDeps {
  /** Makes a unique queue entry id. */
  newId: () => string
}

const defaultDeps: ApplyDeps = { newId: () => crypto.randomUUID() }

// ---------- ids, codes, secrets ----------

type RandomFill = (bytes: Uint8Array) => Uint8Array

const cryptoFill: RandomFill = (b) => crypto.getRandomValues(b)

/** A room code: JAM_CODE_LENGTH characters from JAM_CODE_ALPHABET, uniformly (rejection sampling). */
export function generateCode(fill: RandomFill = cryptoFill): string {
  const n = JAM_CODE_ALPHABET.length
  const limit = 256 - (256 % n)
  let out = ''
  while (out.length < JAM_CODE_LENGTH) {
    const bytes = fill(new Uint8Array(JAM_CODE_LENGTH * 2))
    for (const b of bytes) {
      if (b >= limit) continue
      out += JAM_CODE_ALPHABET[b % n]
      if (out.length === JAM_CODE_LENGTH) break
    }
  }
  return out
}

const CODE_RE = new RegExp(`^[${JAM_CODE_ALPHABET}]{${JAM_CODE_LENGTH}}$`)

export function isValidCode(code: string): boolean {
  return CODE_RE.test(code)
}

function hex(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += b.toString(16).padStart(2, '0')
  return s
}

/** 32 random bytes, hex encoded (64 chars). */
export function generateSecret(fill: RandomFill = cryptoFill): string {
  return hex(fill(new Uint8Array(32)))
}

/** Short random participant id. */
export function generateParticipantId(fill: RandomFill = cryptoFill): string {
  return hex(fill(new Uint8Array(8)))
}

/** Compares two strings without an early exit on the first differing character. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// ---------- text ----------

// C0 and C1 control characters plus DEL.
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/g

export function stripControl(s: string): string {
  return s.replace(CONTROL_RE, '')
}

/** Trimmed, control characters removed, at most nameLength code points; "Guest" if empty. */
export function sanitizeName(raw: unknown): string {
  const s = typeof raw === 'string' ? stripControl(raw).trim() : ''
  const cut = Array.from(s).slice(0, JAM_LIMITS.nameLength).join('').trim()
  return cut || 'Guest'
}

// ---------- validation ----------

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isText(v: unknown, allowEmpty = true): v is string {
  return typeof v === 'string' && v.length <= MAX_TEXT && (allowEmpty || v.length > 0)
}

function isHttpsUrl(v: unknown): v is string {
  if (!isText(v, false)) return false
  try {
    return new URL(v).protocol === 'https:'
  } catch {
    return false
  }
}

/** Returns a clean copy of the track (unknown fields dropped) or an error message. */
export function validateTrack(raw: unknown): JamTrack | string {
  if (!isObj(raw)) return 'A track must be an object.'
  const { provider, nativeId, id, title, artists, durationMs } = raw
  if (provider !== 'spotify' && provider !== 'soundcloud') {
    return 'Only Spotify and SoundCloud tracks can be shared.'
  }
  if (!isText(nativeId, false)) return 'A track has a bad nativeId.'
  if (id !== `${provider}:${nativeId}`) return 'A track id must be provider:nativeId.'
  if (!isText(title)) return 'A track title is missing or too long.'
  if (!Array.isArray(artists) || artists.length > MAX_ARTISTS || !artists.every((a) => isText(a))) {
    return 'A track has bad artists.'
  }
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) {
    return 'A track has a bad duration.'
  }
  const out: JamTrack = {
    id,
    provider,
    nativeId: stripControl(nativeId),
    title: stripControl(title),
    artists: (artists as string[]).map(stripControl),
    durationMs
  }
  // The id must still match after stripping; refuse ids that contained control characters.
  if (out.nativeId !== nativeId) return 'A track has a bad nativeId.'
  if (raw.artworkUrl !== undefined) {
    if (!isHttpsUrl(raw.artworkUrl)) return 'Artwork URLs must be https.'
    out.artworkUrl = raw.artworkUrl
  }
  if (raw.url !== undefined) {
    if (!isHttpsUrl(raw.url)) return 'Track URLs must be https.'
    out.url = raw.url
  }
  if (raw.isrc !== undefined) {
    if (!isText(raw.isrc)) return 'A track has a bad ISRC.'
    out.isrc = stripControl(raw.isrc)
  }
  return out
}

export function parseCapabilities(v: unknown): JamCapabilities | null {
  if (!isObj(v) || typeof v.spotify !== 'boolean' || typeof v.soundcloud !== 'boolean') return null
  return { spotify: v.spotify, soundcloud: v.soundcloud }
}

function isIndex(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0
}

function isPosition(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0
}

/** Shape check for a command; the deeper rules live in applyCommand. */
export function parseCommand(v: unknown): JamCommand | string {
  if (!isObj(v) || typeof v.type !== 'string') return 'Bad command.'
  switch (v.type) {
    case 'add':
      return Array.isArray(v.tracks) ? { type: 'add', tracks: v.tracks as JamTrack[] } : 'Bad add.'
    case 'play':
      if (!isIndex(v.index)) return 'Bad play index.'
      if (v.positionMs !== undefined && !isPosition(v.positionMs)) return 'Bad position.'
      return v.positionMs === undefined
        ? { type: 'play', index: v.index }
        : { type: 'play', index: v.index, positionMs: v.positionMs }
    case 'pause':
    case 'resume':
    case 'seek':
      if (!isPosition(v.positionMs)) return 'Bad position.'
      return { type: v.type, positionMs: v.positionMs }
    case 'next':
    case 'previous':
    case 'end':
      return { type: v.type }
    case 'remove':
    case 'ended':
      if (!isText(v.entryId, false)) return 'Bad entry id.'
      return { type: v.type, entryId: v.entryId }
    case 'move':
      if (!isText(v.entryId, false)) return 'Bad entry id.'
      if (!isIndex(v.toIndex)) return 'Bad index.'
      return { type: 'move', entryId: v.entryId, toIndex: v.toIndex }
    case 'setBlockUnplayable':
      if (typeof v.on !== 'boolean') return 'Bad setting.'
      return { type: 'setBlockUnplayable', on: v.on }
    default:
      return 'Unknown command.'
  }
}

/** Byte length of a frame as received (UTF-8 for strings). */
export function frameBytes(raw: string | ArrayBuffer): number {
  if (typeof raw !== 'string') return raw.byteLength
  // Every UTF-16 code unit is at least one UTF-8 byte; skip encoding obvious oversize frames.
  if (raw.length > JAM_LIMITS.frameBytes) return raw.length
  return new TextEncoder().encode(raw).byteLength
}

export type ParseResult = { message: JamClientMessage } | { error: string }

/** Parses and shape-checks one client frame. Binary frames are refused. */
export function parseClientMessage(raw: string | ArrayBuffer): ParseResult {
  if (typeof raw !== 'string') return { error: 'Send JSON text frames.' }
  let v: unknown
  try {
    v = JSON.parse(raw)
  } catch {
    return { error: 'That was not valid JSON.' }
  }
  if (!isObj(v) || typeof v.type !== 'string') return { error: 'Bad message.' }
  switch (v.type) {
    case 'hello': {
      const canPlay = parseCapabilities(v.canPlay)
      if (!canPlay) return { error: 'hello needs canPlay.' }
      return { message: { type: 'hello', name: sanitizeName(v.name), canPlay } }
    }
    case 'capabilities': {
      const canPlay = parseCapabilities(v.canPlay)
      if (!canPlay) return { error: 'Bad capabilities.' }
      return { message: { type: 'capabilities', canPlay } }
    }
    case 'ping':
      if (typeof v.t !== 'number' || !Number.isFinite(v.t)) return { error: 'Bad ping.' }
      return { message: { type: 'ping', t: v.t } }
    case 'command': {
      const command = parseCommand(v.command)
      if (typeof command === 'string') return { error: command }
      return { message: { type: 'command', command } }
    }
    default:
      return { error: 'Unknown message type.' }
  }
}

// ---------- rate limiting ----------

/**
 * Sliding-window limiter. `log` holds the timestamps of recent accepted frames.
 * Returns whether this frame is allowed and the log to keep.
 */
export function rateCheck(
  log: readonly number[],
  now: number,
  max: number = JAM_LIMITS.commandsPer10s,
  windowMs: number = RATE_WINDOW_MS
): { allowed: boolean; log: number[] } {
  const recent = log.filter((t) => now - t < windowMs)
  if (recent.length >= max) return { allowed: false, log: recent }
  recent.push(now)
  return { allowed: true, log: recent }
}

// ---------- room state ----------

export function createRoomState(code: string, now: number): JamRoomState {
  return {
    code,
    participants: [],
    queue: [],
    currentIndex: -1,
    playing: false,
    positionMs: 0,
    positionAt: now,
    blockUnplayable: false,
    version: 1
  }
}

function bump(state: JamRoomState, patch: Partial<JamRoomState>): { state: JamRoomState } {
  return { state: { ...state, ...patch, version: state.version + 1 } }
}

export function addParticipant(
  state: JamRoomState,
  p: JamParticipant
): { state: JamRoomState } | { error: string } {
  const existing = state.participants.findIndex((x) => x.id === p.id)
  if (existing >= 0) {
    const participants = state.participants.slice()
    participants[existing] = p
    return bump(state, { participants })
  }
  // The host is never refused: a full room of guests must not lock the host out.
  if (!p.isHost && state.participants.length >= JAM_LIMITS.participants) {
    return { error: `This Jam is full (${JAM_LIMITS.participants} people).` }
  }
  return bump(state, { participants: [...state.participants, p] })
}

export function removeParticipant(state: JamRoomState, id: string): JamRoomState {
  if (!state.participants.some((p) => p.id === id)) return state
  return bump(state, { participants: state.participants.filter((p) => p.id !== id) }).state
}

export function setCapabilities(
  state: JamRoomState,
  id: string,
  canPlay: JamCapabilities
): JamRoomState {
  const i = state.participants.findIndex((p) => p.id === id)
  const p = state.participants[i]
  if (!p) return state
  if (p.canPlay.spotify === canPlay.spotify && p.canPlay.soundcloud === canPlay.soundcloud) {
    return state
  }
  const participants = state.participants.slice()
  participants[i] = { ...p, canPlay }
  return bump(state, { participants }).state
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  const shown = names.slice(0, 3)
  const more = names.length - shown.length
  return more > 0
    ? `${shown.join(', ')} and ${more} more`
    : `${shown.slice(0, -1).join(', ')} and ${shown[2]}`
}

/** Moves to the entry after the current one, or stops (paused, position 0) at the end. */
function advance(state: JamRoomState, now: number): { state: JamRoomState } {
  const next = state.currentIndex + 1
  if (next < state.queue.length) {
    return bump(state, { currentIndex: next, positionMs: 0, positionAt: now })
  }
  return bump(state, { playing: false, positionMs: 0, positionAt: now })
}

/**
 * Applies one command from `participantId`. Returns the new state (version bumped), the
 * same state object when the command was a harmless no-op, an error for the sender, or
 * `{end: true}` when the room should close.
 */
export function applyCommand(
  state: JamRoomState,
  participantId: string,
  command: JamCommand,
  now: number,
  deps: ApplyDeps = defaultDeps
): ApplyResult {
  const me = state.participants.find((p) => p.id === participantId)
  if (!me) return { error: 'You are not in this Jam.' }
  if (HOST_ONLY.has(command.type) && !me.isHost) return { error: 'Only the host can do that.' }

  switch (command.type) {
    case 'add': {
      if (command.tracks.length === 0) return { error: 'Nothing to add.' }
      if (state.queue.length + command.tracks.length > JAM_LIMITS.queue) {
        return { error: `The queue is full (${JAM_LIMITS.queue} tracks).` }
      }
      const tracks: JamTrack[] = []
      for (const raw of command.tracks) {
        const t = validateTrack(raw)
        if (typeof t === 'string') return { error: t }
        tracks.push(t)
      }
      if (state.blockUnplayable) {
        for (const provider of ['spotify', 'soundcloud'] as const) {
          if (!tracks.some((t) => t.provider === provider)) continue
          const cant = state.participants.filter((p) => !p.canPlay[provider]).map((p) => p.name)
          if (cant.length > 0) {
            return {
              error: `${joinNames(cant)} can't play ${PROVIDER_LABEL[provider]} tracks, and the host has blocked unplayable tracks.`
            }
          }
        }
      }
      const added: JamEntry[] = tracks.map((track) => ({
        entryId: deps.newId(),
        track,
        addedBy: participantId
      }))
      return bump(state, { queue: [...state.queue, ...added] })
    }

    case 'play': {
      if (command.index >= state.queue.length) return { error: 'There is no track at that spot.' }
      return bump(state, {
        currentIndex: command.index,
        playing: true,
        positionMs: command.positionMs ?? 0,
        positionAt: now
      })
    }

    case 'pause':
      return bump(state, { playing: false, positionMs: command.positionMs, positionAt: now })

    case 'resume':
      if (!state.queue[state.currentIndex]) return { error: 'Nothing to resume.' }
      return bump(state, { playing: true, positionMs: command.positionMs, positionAt: now })

    case 'seek':
      return bump(state, { positionMs: command.positionMs, positionAt: now })

    case 'next':
      if (state.queue.length === 0) return { state }
      return advance(state, now)

    case 'ended': {
      const current = state.queue[state.currentIndex]
      if (!current || current.entryId !== command.entryId) return { state }
      return advance(state, now)
    }

    case 'previous':
      if (state.currentIndex < 0) return { state }
      return bump(state, {
        currentIndex: Math.max(0, state.currentIndex - 1),
        positionMs: 0,
        positionAt: now
      })

    case 'remove': {
      const i = state.queue.findIndex((e) => e.entryId === command.entryId)
      if (i < 0) return { error: 'That track is not in the queue.' }
      const queue = state.queue.filter((_, j) => j !== i)
      if (i < state.currentIndex)
        return bump(state, { queue, currentIndex: state.currentIndex - 1 })
      if (i > state.currentIndex) return bump(state, { queue })
      // Removing the current entry: the following one (now at index i) takes over and the
      // playing state is kept. With nothing after it, stop on the new last entry.
      if (i < queue.length) return bump(state, { queue, positionMs: 0, positionAt: now })
      return bump(state, {
        queue,
        currentIndex: queue.length - 1,
        playing: false,
        positionMs: 0,
        positionAt: now
      })
    }

    case 'move': {
      const from = state.queue.findIndex((e) => e.entryId === command.entryId)
      if (from < 0) return { error: 'That track is not in the queue.' }
      const to = Math.min(command.toIndex, state.queue.length - 1)
      if (to === from) return { state }
      const currentId = state.queue[state.currentIndex]?.entryId
      const queue = state.queue.slice()
      const [entry] = queue.splice(from, 1)
      queue.splice(to, 0, entry as JamEntry)
      const currentIndex =
        currentId === undefined
          ? state.currentIndex
          : queue.findIndex((e) => e.entryId === currentId)
      return bump(state, { queue, currentIndex })
    }

    case 'setBlockUnplayable':
      if (state.blockUnplayable === command.on) return { state }
      return bump(state, { blockUnplayable: command.on })

    case 'end':
      return { end: true }
  }
}
