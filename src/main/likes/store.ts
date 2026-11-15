// Local mirror of the likes on Spotify and SoundCloud. Pure DB, no Electron.
// No local-only likes (see Decision Log): rows land here only from a service reconcile
// or right after a like/unlike succeeded on the service.
import type { ServiceProvider } from '@shared/ipc'
import { trackId, type LikedTrack, type Track } from '@shared/types'
import type { Db } from '../db'
import { rowToTrack, trackColumns, upsertServiceTracks, type TrackRow } from '../db/tracks'

export interface LikesStore {
  /** Every liked service track, newest like first (ties by title). */
  getAll(): LikedTrack[]
  /** `track_id -> liked_at` for one provider (or all), for change detection. */
  snapshot(provider?: ServiceProvider): Map<string, string>
  /**
   * Make the stored likes for `provider` exactly `liked`, in one transaction. Entries
   * for another provider or with a malformed id are ignored. Returns true if anything
   * in the likes table changed.
   */
  replaceForProvider(provider: ServiceProvider, liked: readonly LikedTrack[]): boolean
  /** Record a like the service just accepted. Returns true if it was new. */
  add(track: Track, likedAt?: string): boolean
  /** Forget a like the service just removed. Returns true if one was stored. */
  remove(trackId: string): boolean
  has(trackId: string): boolean
}

export function isServiceProvider(v: unknown): v is ServiceProvider {
  return v === 'spotify' || v === 'soundcloud'
}

/** Only well-formed service tracks may be liked (local rows are never touched). */
export function isLikeableTrack(track: Track | null | undefined): track is Track & {
  provider: ServiceProvider
} {
  return (
    !!track &&
    typeof track === 'object' &&
    isServiceProvider(track.provider) &&
    typeof track.nativeId === 'string' &&
    track.nativeId.length > 0 &&
    track.id === trackId(track.provider, track.nativeId)
  )
}

/** ISO 8601 in one fixed format so string order is time order across services. */
function normalizeIso(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

export function createLikesStore(db: Db, now: () => Date = () => new Date()): LikesStore {
  const selectAll = db.prepare<[], TrackRow & { liked_at: string }>(
    `SELECT ${trackColumns('t')}, l.liked_at
       FROM likes l JOIN tracks t ON t.id = l.track_id
      ORDER BY l.liked_at DESC, t.title COLLATE NOCASE, t.id`
  )
  const selectSnapshot = db.prepare<
    { provider: string | null },
    { track_id: string; liked_at: string }
  >(`SELECT track_id, liked_at FROM likes WHERE @provider IS NULL OR provider = @provider`)
  const upsertLike = db.prepare<{
    trackId: string
    provider: string
    likedAt: string | null
    now: string
  }>(
    `INSERT INTO likes (track_id, provider, liked_at, synced_at)
     VALUES (@trackId, @provider, COALESCE(@likedAt, @now), @now)
     ON CONFLICT (track_id) DO UPDATE SET
       provider = excluded.provider,
       liked_at = COALESCE(@likedAt, likes.liked_at),
       synced_at = excluded.synced_at`
  )
  const insertLike = db.prepare<{
    trackId: string
    provider: string
    likedAt: string
    now: string
  }>(
    `INSERT INTO likes (track_id, provider, liked_at, synced_at)
     VALUES (@trackId, @provider, @likedAt, @now)
     ON CONFLICT (track_id) DO NOTHING`
  )
  const deleteLike = db.prepare<[string]>(`DELETE FROM likes WHERE track_id = ?`)
  const selectHas = db.prepare<[string], 1>(`SELECT 1 FROM likes WHERE track_id = ?`).pluck()

  function snapshot(provider?: ServiceProvider): Map<string, string> {
    const out = new Map<string, string>()
    for (const r of selectSnapshot.all({ provider: provider ?? null }))
      out.set(r.track_id, r.liked_at)
    return out
  }

  const replace = db.transaction(
    (provider: ServiceProvider, liked: readonly LikedTrack[]): boolean => {
      const nowIso = now().toISOString()
      // First occurrence wins if a service lists a track twice.
      const wanted = new Map<string, { track: Track; likedAt: string | null }>()
      for (const entry of liked) {
        const track = entry?.track
        if (!isLikeableTrack(track) || track.provider !== provider) continue
        if (!wanted.has(track.id))
          wanted.set(track.id, { track, likedAt: normalizeIso(entry.likedAt) })
      }
      const before = snapshot(provider)
      upsertServiceTracks(
        db,
        [...wanted.values()].map((w) => w.track)
      )
      for (const id of before.keys()) if (!wanted.has(id)) deleteLike.run(id)
      for (const [id, w] of wanted)
        upsertLike.run({ trackId: id, provider, likedAt: w.likedAt, now: nowIso })
      return !sameLikes(before, snapshot(provider))
    }
  )

  return {
    getAll() {
      return selectAll.all().map((r) => ({ track: rowToTrack(r), likedAt: r.liked_at }))
    },
    snapshot,
    replaceForProvider(provider, liked) {
      if (!isServiceProvider(provider)) throw new Error(`Not a music service: ${String(provider)}`)
      return replace(provider, Array.isArray(liked) ? liked : [])
    },
    add(track, likedAt) {
      if (!isLikeableTrack(track))
        throw new Error('Only Spotify and SoundCloud tracks can be liked.')
      const nowIso = now().toISOString()
      return db.transaction(() => {
        upsertServiceTracks(db, [track])
        return (
          insertLike.run({
            trackId: track.id,
            provider: track.provider,
            likedAt: normalizeIso(likedAt) ?? nowIso,
            now: nowIso
          }).changes > 0
        )
      })()
    },
    remove(id) {
      return deleteLike.run(id).changes > 0
    },
    has(id) {
      return selectHas.get(id) !== undefined
    }
  }
}

export function sameLikes(a: Map<string, string>, b: Map<string, string>): boolean {
  if (a.size !== b.size) return false
  for (const [id, at] of a) if (b.get(id) !== at) return false
  return true
}
