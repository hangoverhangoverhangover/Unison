// Cover art for local files on Discord: MusicBrainz recording search, then the
// Cover Art Archive front image of the best release group. When that finds nothing,
// the connected services' own search (Spotify, then SoundCloud) is tried. Discord
// can't load local art, so this gives local tracks a public https image. Cached in the db.
// Docs checked 2026-11-11: musicbrainz.org/doc/MusicBrainz_API/Search,
// .../Rate_Limiting (about 1 request per second per IP, User-Agent required),
// musicbrainz.org/doc/Cover_Art_Archive/API (307 to archive.org, 404 when none).
import type { Track } from '@shared/types'
import type { Db } from '../db'
import { artistMatches, cleanTitle, normalize } from '../music/match'

export { cleanTitle, normalize }

export const MB_SEARCH = 'https://musicbrainz.org/ws/2/recording'
export const CAA = 'https://coverartarchive.org/release-group'
/** Gap between MusicBrainz requests (their limit is about 1 per second). */
export const MB_GAP_MS = 1100
/** A miss is retried after this long; a hit is kept. */
export const MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** Lowest MusicBrainz search score accepted. */
export const MIN_SCORE = 90
/** Release groups tried on the Cover Art Archive per lookup. */
const MAX_CANDIDATES = 3

export interface ArtQuery {
  title: string
  artists: string[]
  album?: string
}

export interface CoverArtLookup {
  /** The cached result: a URL, null for a cached miss, undefined when not looked up yet. */
  cached(q: ArtQuery): string | null | undefined
  /** Look the track up (deduped, rate limited). Resolves null when nothing is found. */
  find(q: ArtQuery): Promise<string | null>
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>

export interface CoverArtOptions {
  db: Db
  userAgent: string
  fetch?: Fetch
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  log?(message: string, err?: unknown): void
  /** Tried in order after MusicBrainz finds nothing (the app's Spotify/SoundCloud search). */
  fallbacks?: ArtFallback[]
}

export interface ArtFallback {
  name: string
  search(query: string): Promise<Track[]>
}

/** Lucene phrase: quotes and backslashes escaped. */
function phrase(s: string): string {
  return `"${s.replace(/[\\"]/g, '\\$&')}"`
}

export function cacheKey(q: ArtQuery): string | null {
  const title = normalize(cleanTitle(q.title))
  const artist = normalize(q.artists[0] ?? '')
  if (!title || !artist) return null
  return `${artist}|${title}`
}

export function searchUrl(q: ArtQuery): string {
  const query = [
    `recording:${phrase(cleanTitle(q.title))}`,
    `artist:${phrase(q.artists[0]!.trim())}`,
    'status:official',
    'NOT secondarytype:live',
    'NOT secondarytype:compilation'
  ].join(' AND ')
  const params = new URLSearchParams({ query, fmt: 'json', limit: '25' })
  return `${MB_SEARCH}?${params}`
}

interface MbRecording {
  score?: number
  title?: string
  disambiguation?: string
  'artist-credit'?: { name?: string; artist?: { name?: string } }[]
  releases?: {
    title?: string
    status?: string
    'release-group'?: { id?: string; 'primary-type'?: string; 'secondary-types'?: string[] }
  }[]
}

const TYPE_WEIGHT: Record<string, number> = { Album: 3, EP: 2, Single: 2 }

/** Best release group ids for the track, most likely first. */
export function rankReleaseGroups(q: ArtQuery, recordings: MbRecording[]): string[] {
  const title = normalize(cleanTitle(q.title))
  const album = q.album ? normalize(q.album) : ''
  const scores = new Map<string, number>()
  for (const r of recordings) {
    if ((r.score ?? 0) < MIN_SCORE) continue
    if (normalize(cleanTitle(r.title ?? '')) !== title) continue
    const credits = (r['artist-credit'] ?? []).map((c) => c.name ?? c.artist?.name ?? '')
    if (!artistMatches(q.artists[0] ?? '', credits)) continue
    // Live takes and karaoke versions carry a disambiguation; the studio recording usually doesn't.
    const base = r.disambiguation ? 1 : 3
    for (const rel of r.releases ?? []) {
      const rg = rel['release-group']
      if (!rg?.id || rel.status !== 'Official') continue
      if ((rg['secondary-types'] ?? []).length > 0) continue
      let s = base + (TYPE_WEIGHT[rg['primary-type'] ?? ''] ?? 0)
      if (album && normalize(rel.title ?? '') === album) s += 10
      scores.set(rg.id, (scores.get(rg.id) ?? 0) + s)
    }
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)
}

/**
 * Artwork from a service search result that is the same song: the cleaned titles
 * match (or one contains the other, for SoundCloud's "Artist - Title" uploads) and
 * the artist matches a credited artist or appears in the title.
 */
export function pickTrackArt(q: ArtQuery, results: Track[]): string | null {
  const title = normalize(cleanTitle(q.title))
  const artist = normalize(q.artists[0] ?? '')
  if (!title || !artist) return null
  for (const t of results) {
    const url = t.artworkUrl
    if (!url?.startsWith('https://') || url.length > 256) continue
    const rt = normalize(cleanTitle(t.title))
    if (!rt || !(rt === title || rt.includes(title) || (rt.length >= 4 && title.includes(rt))))
      continue
    if (artistMatches(q.artists[0] ?? '', t.artists, t.title)) return url
  }
  return null
}

export function createCoverArtLookup(opts: CoverArtOptions): CoverArtLookup {
  const fetchFn: Fetch = opts.fetch ?? ((url, init) => fetch(url, init))
  const now = opts.now ?? Date.now
  const sleep = opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)))
  const log = opts.log ?? ((): void => undefined)
  const headers = { 'User-Agent': opts.userAgent, Accept: 'application/json' }
  const pending = new Map<string, Promise<string | null>>()
  /** MusicBrainz calls run one at a time with a gap between them. */
  let mbQueue: Promise<unknown> = Promise.resolve()
  let lastMbAt = -Infinity

  const get = opts.db.prepare('SELECT url, checked_at FROM cover_art_cache WHERE key = ?')
  const put = opts.db.prepare(
    `INSERT INTO cover_art_cache (key, url, checked_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET url = excluded.url, checked_at = excluded.checked_at`
  )

  function cachedByKey(key: string): string | null | undefined {
    const row = get.get(key) as { url: string | null; checked_at: number } | undefined
    if (!row) return undefined
    if (row.url) return row.url
    return now() - row.checked_at < MISS_TTL_MS ? null : undefined
  }

  function mbSearch(url: string): Promise<MbRecording[]> {
    const run = mbQueue.then(async () => {
      const wait = lastMbAt + MB_GAP_MS - now()
      if (wait > 0) await sleep(wait)
      lastMbAt = now()
      const res = await fetchFn(url, { headers })
      if (!res.ok) throw new Error(`MusicBrainz search failed: HTTP ${res.status}`)
      const body = (await res.json()) as { recordings?: MbRecording[] }
      return body.recordings ?? []
    })
    mbQueue = run.catch(() => undefined)
    return run
  }

  /** The archive.org URL the Cover Art Archive redirects to, or null when there's no front image. */
  async function frontImage(releaseGroupId: string): Promise<string | null> {
    const res = await fetchFn(`${CAA}/${releaseGroupId}/front-500`, {
      method: 'HEAD',
      redirect: 'manual',
      headers: { 'User-Agent': opts.userAgent }
    })
    if (res.status === 404) return null
    const location = res.headers.get('location')
    if (res.status >= 300 && res.status < 400 && location) {
      const url = new URL(location, CAA)
      url.protocol = 'https:'
      return url.href
    }
    if (res.ok) return `${CAA}/${releaseGroupId}/front-500`
    throw new Error(`Cover Art Archive failed: HTTP ${res.status}`)
  }

  async function fromMusicBrainz(q: ArtQuery): Promise<string | null> {
    const groups = rankReleaseGroups(q, await mbSearch(searchUrl(q))).slice(0, MAX_CANDIDATES)
    for (const id of groups) {
      const found = await frontImage(id)
      if (found) return found
    }
    return null
  }

  async function lookup(key: string, q: ArtQuery): Promise<string | null> {
    const sources: { name: string; find(): Promise<string | null> }[] = [
      { name: 'MusicBrainz', find: () => fromMusicBrainz(q) },
      ...(opts.fallbacks ?? []).map((f) => ({
        name: f.name,
        find: async () =>
          pickTrackArt(q, await f.search(`${q.artists[0]!.trim()} ${cleanTitle(q.title)}`))
      }))
    ]
    let failed = false
    for (const source of sources) {
      try {
        const found = await source.find()
        if (found) {
          put.run(key, found, now())
          log(`[discord] cover art for "${key}" from ${source.name}: ${found}`)
          return found
        }
      } catch (err) {
        failed = true
        log(`[discord] cover art lookup on ${source.name} failed`, err)
      }
    }
    // Only a clean miss is cached; after an error the next play tries again.
    if (!failed) put.run(key, null, now())
    log(`[discord] cover art for "${key}": none found`)
    return null
  }

  return {
    cached(q) {
      const key = cacheKey(q)
      return key ? cachedByKey(key) : null
    },
    find(q) {
      const key = cacheKey(q)
      if (!key) {
        log(`[discord] no cover art lookup for "${q.title}": no artist tag`)
        return Promise.resolve(null)
      }
      const hit = cachedByKey(key)
      if (hit !== undefined) return Promise.resolve(hit)
      let p = pending.get(key)
      if (!p) {
        p = lookup(key, q).finally(() => pending.delete(key))
        pending.set(key, p)
      }
      return p
    }
  }
}
