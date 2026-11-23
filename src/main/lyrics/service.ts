// Lyrics: the user's own (saved locally, never uploaded) or LRCLIB's (free, no key).
// LRCLIB answers are cached, "not found" included, so a song is looked up once a week
// at most. https://lrclib.net/docs
import { parseLrc, type LyricsResult } from '@shared/lyrics'
import type { Track } from '@shared/types'
import type { SettingsStore } from '../spotify/tokens'
import { geniusLyrics } from './genius'

const API = 'https://lrclib.net/api'
const USER_PREFIX = 'lyrics.user:'
const CACHE_PREFIX = 'lyrics.cache:'
/** Re-check LRCLIB for songs it didn't have after this long. */
const MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** LRCLIB matches by length; accept search results this close. */
const DURATION_SLACK_S = 3

interface LrclibRecord {
  duration?: number
  instrumental?: boolean
  plainLyrics?: string | null
  syncedLyrics?: string | null
}

interface Cached {
  at: number
  result: LyricsResult
  /** Genius was asked too (it answered, even if with nothing). */
  genius?: boolean
}

const NONE: LyricsResult = { source: 'none', synced: null, plain: null, instrumental: false }

export interface LyricsDeps {
  settings: SettingsStore
  fetch: typeof fetch
  /** LRCLIB asks clients to name themselves. */
  userAgent: string
  now?: () => number
  /** Your Genius API token (QoL 4); Genius is only asked when LRCLIB has no lyrics. */
  geniusToken?: () => string | null
}

function fromRecord(r: LrclibRecord): LyricsResult {
  const synced = r.syncedLyrics ? parseLrc(r.syncedLyrics) : []
  const plain = r.plainLyrics?.trim() || null
  if (!synced.length && !plain && !r.instrumental) return NONE
  return {
    source: 'lrclib',
    synced: synced.length ? synced : null,
    plain,
    instrumental: !!r.instrumental
  }
}

/** The user's text: LRC if it has time stamps, otherwise plain lyrics to sync later. */
function fromUser(text: string): LyricsResult {
  const synced = parseLrc(text)
  const plain = synced.length
    ? synced
        .map((l) => l.text)
        .filter(Boolean)
        .join('\n')
    : text.trim()
  return { source: 'user', synced: synced.length ? synced : null, plain, instrumental: false }
}

export function createLyrics(deps: LyricsDeps): {
  get(track: Track): Promise<LyricsResult>
  save(track: Track, text: string): void
  remove(track: Track): void
} {
  const now = deps.now ?? Date.now

  const request = async (
    path: string,
    params: Record<string, string>
  ): Promise<{ status: number; body: unknown }> => {
    const res = await deps.fetch(`${API}/${path}?${new URLSearchParams(params).toString()}`, {
      headers: { 'User-Agent': deps.userAgent }
    })
    const json = (res.headers.get('content-type') ?? '').includes('json')
    return { status: res.status, body: json ? await res.json().catch(() => null) : null }
  }

  /** Ask LRCLIB. Returns null when it couldn't answer (busy, offline): don't cache that. */
  const lookup = async (track: Track): Promise<LyricsResult | null> => {
    const artist = track.artists[0]?.trim()
    const title = track.title.trim()
    if (!artist || !title) return NONE
    const seconds = Math.round(track.durationMs / 1000)
    const params: Record<string, string> = { track_name: title, artist_name: artist }
    if (track.album?.trim()) params.album_name = track.album.trim()
    if (seconds >= 1 && seconds <= 3600) params.duration = String(seconds)
    try {
      const got = await request('get', params)
      if (got.status === 200 && got.body) return fromRecord(got.body as LrclibRecord)
      if (got.status !== 404) return null
      const found = await request('search', { track_name: title, artist_name: artist })
      if (found.status !== 200 || !Array.isArray(found.body))
        return found.status === 404 ? NONE : null
      const records = found.body as LrclibRecord[]
      const best = records
        .filter((r) => !seconds || Math.abs((r.duration ?? 0) - seconds) <= DURATION_SLACK_S)
        .sort(
          (a, b) =>
            Number(!!b.syncedLyrics) - Number(!!a.syncedLyrics) ||
            Math.abs((a.duration ?? 0) - seconds) - Math.abs((b.duration ?? 0) - seconds)
        )[0]
      return best ? fromRecord(best) : NONE
    } catch {
      return null
    }
  }

  /** Genius, when LRCLIB found nothing: the result and whether Genius answered. */
  const backup = async (
    track: Track,
    token: string | null
  ): Promise<{ result: LyricsResult; asked: boolean }> => {
    if (!token) return { result: NONE, asked: false }
    const g = await geniusLyrics(deps.fetch, token, track, deps.userAgent, (m) => console.warn(m))
    if (g === null) return { result: NONE, asked: false }
    if (g === 'none') return { result: NONE, asked: true }
    return {
      result: { source: 'genius', synced: null, plain: g.plain, instrumental: false, url: g.url },
      asked: true
    }
  }
  const remember = (
    track: Track,
    b: { result: LyricsResult; asked: boolean },
    at: number
  ): LyricsResult => {
    const cached: Cached = { at: b.result.source === 'none' ? at : now(), result: b.result }
    if (b.asked) cached.genius = true
    deps.settings.set(CACHE_PREFIX + track.id, JSON.stringify(cached))
    return b.result
  }

  return {
    async get(track) {
      const mine = deps.settings.get(USER_PREFIX + track.id)
      if (mine) {
        try {
          return fromUser(JSON.parse(mine) as string)
        } catch {
          // fall through to LRCLIB
        }
      }
      const raw = deps.settings.get(CACHE_PREFIX + track.id)
      const token = deps.geniusToken?.() ?? null
      if (raw) {
        try {
          const cached = JSON.parse(raw) as Cached
          const fresh = cached.result.source !== 'none' || now() - cached.at < MISS_TTL_MS
          // A cached miss from before a Genius token was added still asks Genius once.
          if (fresh && !(cached.result.source === 'none' && token && !cached.genius))
            return cached.result
          if (fresh) return remember(track, await backup(track, token), cached.at)
        } catch {
          // stale or corrupt: look it up again
        }
      }
      const result = await lookup(track)
      if (!result) return NONE
      if (result.source === 'none' && token)
        return remember(track, await backup(track, token), now())
      deps.settings.set(CACHE_PREFIX + track.id, JSON.stringify({ at: now(), result }))
      return result
    },

    save(track, text) {
      if (!text.trim()) throw new Error('There are no lyrics to save.')
      if (text.length > 100_000) throw new Error('Those lyrics are too long to save.')
      deps.settings.set(USER_PREFIX + track.id, JSON.stringify(text))
    },

    remove(track) {
      deps.settings.delete(USER_PREFIX + track.id)
    }
  }
}
