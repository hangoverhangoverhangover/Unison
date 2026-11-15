// Shared track persistence for service tracks (Spotify, SoundCloud) and reading any
// track back into the shared `Track` shape. Local files are written by library/store.ts.
import type { EntityRef, Track, TrackAvailability } from '@shared/types'
import type { Db } from './index'

/** Columns every query that maps to `Track` must select (use `TRACK_COLUMNS`). */
export interface TrackRow {
  id: string
  provider: Track['provider']
  native_id: string
  title: string
  artists: string
  album: string | null
  duration_ms: number
  artwork_url: string | null
  isrc: string | null
  local_path: string | null
  source_sc_id: string | null
  availability: string | null
  url: string | null
  /** JSON EntityRef[]. */
  artist_refs: string | null
  /** JSON EntityRef. */
  album_ref: string | null
}

/** Prefix with a table alias when joining, e.g. `trackColumns('t')`. */
export function trackColumns(alias?: string): string {
  const p = alias ? `${alias}.` : ''
  return [
    'id',
    'provider',
    'native_id',
    'title',
    'artists',
    'album',
    'duration_ms',
    'artwork_url',
    'isrc',
    'local_path',
    'source_sc_id',
    'availability',
    'url',
    'artist_refs',
    'album_ref'
  ]
    .map((c) => `${p}${c}`)
    .join(', ')
}

const AVAILABILITY = new Set<TrackAvailability>(['full', 'preview', 'blocked', 'drm'])

function parseArtists(json: string): string[] {
  try {
    const v: unknown = JSON.parse(json)
    return Array.isArray(v) ? v.filter((a): a is string => typeof a === 'string') : []
  } catch {
    return []
  }
}

function isRef(v: unknown): v is EntityRef {
  if (!v || typeof v !== 'object') return false
  const r = v as Record<string, unknown>
  return (
    typeof r.id === 'string' &&
    typeof r.name === 'string' &&
    (r.url === undefined || typeof r.url === 'string')
  )
}

function parseJson(json: string | null): unknown {
  if (!json) return undefined
  try {
    return JSON.parse(json)
  } catch {
    return undefined
  }
}

function parseRefs(json: string | null): EntityRef[] | undefined {
  const v = parseJson(json)
  return Array.isArray(v) && v.length > 0 && v.every(isRef) ? v : undefined
}

function parseRef(json: string | null): EntityRef | undefined {
  const v = parseJson(json)
  return isRef(v) ? v : undefined
}

export function rowToTrack(r: TrackRow): Track {
  const t: Track = {
    id: r.id,
    provider: r.provider,
    nativeId: r.native_id,
    title: r.title,
    artists: parseArtists(r.artists),
    durationMs: r.duration_ms
  }
  const artistRefs = parseRefs(r.artist_refs)
  if (artistRefs) t.artistRefs = artistRefs
  if (r.album) t.album = r.album
  const albumRef = parseRef(r.album_ref)
  if (albumRef) t.albumRef = albumRef
  if (r.url) t.url = r.url
  if (r.artwork_url) t.artworkUrl = r.artwork_url
  if (r.isrc) t.isrc = r.isrc
  if (r.local_path) t.localPath = r.local_path
  if (r.source_sc_id) t.sourceScId = r.source_sc_id
  if (
    r.availability &&
    AVAILABILITY.has(r.availability as TrackAvailability) &&
    r.availability !== 'full'
  )
    t.availability = r.availability as TrackAvailability
  return t
}

/**
 * Insert or refresh Spotify/SoundCloud tracks (metadata the services may change: title,
 * artwork, availability). Links (url, artist/album refs) are only overwritten when the
 * new track has them, so a track seen without links keeps the ones it had. Local tracks are skipped: the scanner owns those rows.
 * Call inside a transaction for large batches (it opens its own otherwise).
 */
export function upsertServiceTracks(db: Db, tracks: readonly Track[]): void {
  const rows = tracks.filter((t) => t.provider !== 'local')
  if (rows.length === 0) return
  const stmt = db.prepare(
    `INSERT INTO tracks (id, provider, native_id, title, artists, album, duration_ms,
                         artwork_url, isrc, availability, url, artist_refs, album_ref)
     VALUES (@id, @provider, @nativeId, @title, @artists, @album, @durationMs,
             @artworkUrl, @isrc, @availability, @url, @artistRefs, @albumRef)
     ON CONFLICT (id) DO UPDATE SET
       title = excluded.title, artists = excluded.artists, album = excluded.album,
       duration_ms = excluded.duration_ms, artwork_url = excluded.artwork_url,
       isrc = excluded.isrc, availability = excluded.availability,
       url = COALESCE(excluded.url, tracks.url),
       artist_refs = COALESCE(excluded.artist_refs, tracks.artist_refs),
       album_ref = COALESCE(excluded.album_ref, tracks.album_ref),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
  )
  const run = (): void => {
    for (const t of rows) {
      stmt.run({
        id: t.id,
        provider: t.provider,
        nativeId: t.nativeId,
        title: t.title,
        artists: JSON.stringify(t.artists ?? []),
        album: t.album ?? null,
        durationMs: Math.max(0, Math.round(t.durationMs || 0)),
        artworkUrl: t.artworkUrl ?? null,
        isrc: t.isrc ?? null,
        availability: t.availability ?? null,
        url: t.url ?? null,
        artistRefs: t.artistRefs?.length ? JSON.stringify(t.artistRefs) : null,
        albumRef: t.albumRef ? JSON.stringify(t.albumRef) : null
      })
    }
  }
  if (db.inTransaction) run()
  else db.transaction(run)()
}
