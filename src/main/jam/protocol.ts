// Pure helpers for the Jam client: room codes, relay URLs, frame checks, track cleaning.
import {
  JAM_CODE_ALPHABET,
  JAM_CODE_LENGTH,
  type JamCommand,
  type JamCreated,
  type JamRoomState,
  type JamServerMessage,
  type JamTrack
} from '@shared/jam'

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

const CODE_CHARS = new Set(JAM_CODE_ALPHABET)

/** Uppercase, spaces and dashes removed; null unless it is a valid room code. */
export function normalizeCode(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const code = input.toUpperCase().replace(/[\s-]+/g, '')
  if (code.length !== JAM_CODE_LENGTH) return null
  for (const c of code) if (!CODE_CHARS.has(c)) return null
  return code
}

/** `{relay}/rooms` for creating a room. */
export function roomsUrl(relay: string): string {
  return `${relay.replace(/\/+$/, '')}/rooms`
}

/** `ws(s)://…/rooms/{code}/ws`, plus `?secret=` for the host. Never log the result. */
export function socketUrl(relay: string, code: string, secret?: string): string {
  const base = relay.replace(/\/+$/, '').replace(/^http(s?):\/\//i, (_m, s: string) => `ws${s}://`)
  const url = `${base}/rooms/${encodeURIComponent(code)}/ws`
  return secret ? `${url}?secret=${encodeURIComponent(secret)}` : url
}

export function parseCreated(body: unknown): JamCreated | null {
  if (!isObject(body)) return null
  const code = normalizeCode(body.code)
  const secret = body.hostSecret
  if (!code || typeof secret !== 'string' || secret === '' || secret.length > 512) return null
  return { code, hostSecret: secret }
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** A minimal shape check: enough that the renderer can index into it without crashing. */
export function isRoomState(v: unknown): v is JamRoomState {
  return (
    isObject(v) &&
    typeof v.code === 'string' &&
    Array.isArray(v.participants) &&
    Array.isArray(v.queue) &&
    v.queue.every((e) => isObject(e) && typeof e.entryId === 'string' && isObject(e.track)) &&
    finite(v.currentIndex) &&
    typeof v.playing === 'boolean' &&
    finite(v.positionMs) &&
    finite(v.positionAt) &&
    typeof v.blockUnplayable === 'boolean' &&
    finite(v.version)
  )
}

/** Parses one relay frame; null for anything malformed or unknown. */
export function parseServerMessage(data: unknown): JamServerMessage | null {
  if (typeof data !== 'string') return null
  let msg: unknown
  try {
    msg = JSON.parse(data)
  } catch {
    return null
  }
  if (!isObject(msg)) return null
  switch (msg.type) {
    case 'welcome':
      return typeof msg.you === 'string' && isRoomState(msg.state)
        ? { type: 'welcome', you: msg.you, state: msg.state }
        : null
    case 'state':
      return isRoomState(msg.state) ? { type: 'state', state: msg.state } : null
    case 'error':
      return typeof msg.message === 'string' ? { type: 'error', message: msg.message } : null
    case 'pong':
      return finite(msg.t) && finite(msg.serverTime)
        ? { type: 'pong', t: msg.t, serverTime: msg.serverTime }
        : null
    case 'closed':
      return { type: 'closed', reason: typeof msg.reason === 'string' ? msg.reason : '' }
    default:
      return null
  }
}

export const LOCAL_FILE_ERROR = "Local files can't be added to a Jam."

/**
 * Copies only the JamTrack fields (so no file path or other extra field can reach the
 * relay). Throws for local files and anything that isn't a Spotify/SoundCloud track.
 */
export function cleanJamTrack(t: unknown): JamTrack {
  if (!isObject(t)) throw new Error('Not a valid track.')
  if (t.provider === 'local' || typeof t.localPath === 'string') throw new Error(LOCAL_FILE_ERROR)
  if (t.provider !== 'spotify' && t.provider !== 'soundcloud')
    throw new Error('Only Spotify and SoundCloud tracks can be added to a Jam.')
  if (
    typeof t.nativeId !== 'string' ||
    t.nativeId === '' ||
    typeof t.title !== 'string' ||
    !Array.isArray(t.artists) ||
    !t.artists.every((a) => typeof a === 'string') ||
    !finite(t.durationMs)
  )
    throw new Error('Not a valid track.')
  const out: JamTrack = {
    id: `${t.provider}:${t.nativeId}`,
    provider: t.provider,
    nativeId: t.nativeId,
    title: t.title,
    artists: [...(t.artists as string[])],
    durationMs: t.durationMs
  }
  if (typeof t.artworkUrl === 'string' && t.artworkUrl.startsWith('https://'))
    out.artworkUrl = t.artworkUrl
  if (typeof t.isrc === 'string' && t.isrc) out.isrc = t.isrc
  if (typeof t.url === 'string' && t.url.startsWith('https://')) out.url = t.url
  return out
}

const COMMAND_TYPES = new Set<unknown>([
  'add',
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

/** Checks a command from the renderer and rebuilds it field by field. Throws if invalid. */
export function cleanCommand(c: unknown): JamCommand {
  if (!isObject(c) || !COMMAND_TYPES.has(c.type)) throw new Error('Not a valid Jam command.')
  const pos = (): number => {
    if (!finite(c.positionMs) || c.positionMs < 0) throw new Error('Position must be 0 or more.')
    return Math.round(c.positionMs)
  }
  const id = (): string => {
    if (typeof c.entryId !== 'string' || c.entryId === '') throw new Error('Missing entry id.')
    return c.entryId
  }
  switch (c.type) {
    case 'add': {
      if (!Array.isArray(c.tracks) || c.tracks.length === 0) throw new Error('Nothing to add.')
      return { type: 'add', tracks: c.tracks.map(cleanJamTrack) }
    }
    case 'play': {
      if (!finite(c.index) || !Number.isInteger(c.index) || c.index < 0)
        throw new Error('Not a valid queue position.')
      return c.positionMs === undefined
        ? { type: 'play', index: c.index }
        : { type: 'play', index: c.index, positionMs: pos() }
    }
    case 'pause':
      return { type: 'pause', positionMs: pos() }
    case 'resume':
      return { type: 'resume', positionMs: pos() }
    case 'seek':
      return { type: 'seek', positionMs: pos() }
    case 'remove':
      return { type: 'remove', entryId: id() }
    case 'ended':
      return { type: 'ended', entryId: id() }
    case 'move': {
      if (!finite(c.toIndex) || !Number.isInteger(c.toIndex) || c.toIndex < 0)
        throw new Error('Not a valid queue position.')
      return { type: 'move', entryId: id(), toIndex: c.toIndex }
    }
    case 'setBlockUnplayable':
      if (typeof c.on !== 'boolean') throw new Error('Block setting must be true or false.')
      return { type: 'setBlockUnplayable', on: c.on }
    default:
      return { type: c.type as 'next' | 'previous' | 'end' }
  }
}
