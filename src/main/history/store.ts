// Play history (QoL round 2): the `plays` table, smart playlists and listening stats.
import type {
  ArtistStat,
  ListeningStats,
  PlayReport,
  RecentPlay,
  SmartPlaylist,
  SmartPlaylistKind,
  StatsRange,
  TrackStat
} from '@shared/history'
import type { Track } from '@shared/types'
import type { Db } from '../db'
import { rowToTrack, trackColumns, upsertServiceTracks, type TrackRow } from '../db/tracks'

const DAY_MS = 24 * 60 * 60 * 1000
/** Last ms that still gives a fixed-width ISO string (year 9999), so string order = time order. */
const MAX_TIME_MS = 253_402_300_799_999

export const RECENT_DEFAULT_LIMIT = 50
export const RECENT_MAX_LIMIT = 500
export const SMART_RECENT_MAX = 50
export const ON_REPEAT_DAYS = 30
export const ON_REPEAT_MIN_PLAYS = 3
export const ON_REPEAT_MAX = 30
export const FORGOTTEN_DAYS = 60
export const FORGOTTEN_MIN_PLAYS = 5
export const FORGOTTEN_MAX = 30
export const STATS_TOP = 10

const RANGE_DAYS: Record<StatsRange, number | null> = {
  week: 7,
  month: 30,
  year: 365,
  all: null
}

const PROVIDERS = new Set<unknown>(['spotify', 'soundcloud', 'discography', 'local'])

/** Checks the track that came over IPC (same fields as the router's check, plus the id shape). */
export function isPlayableTrack(t: unknown): t is Track {
  if (!t || typeof t !== 'object') return false
  const x = t as Partial<Track>
  return (
    typeof x.id === 'string' &&
    PROVIDERS.has(x.provider) &&
    typeof x.nativeId === 'string' &&
    x.nativeId !== '' &&
    x.id === `${x.provider}:${x.nativeId}` &&
    typeof x.title === 'string' &&
    Array.isArray(x.artists) &&
    x.artists.every((a) => typeof a === 'string') &&
    typeof x.durationMs === 'number' &&
    Number.isFinite(x.durationMs) &&
    (x.isrc === undefined || typeof x.isrc === 'string')
  )
}

/** Throws on a report that isn't the PlayReport shape. */
export function validateReport(report: unknown): PlayReport {
  if (!report || typeof report !== 'object') throw new Error('Not a valid play report.')
  const r = report as Partial<PlayReport>
  if (!isPlayableTrack(r.track)) throw new Error('Not a valid track.')
  if (typeof r.playedMs !== 'number' || !Number.isFinite(r.playedMs) || r.playedMs < 0)
    throw new Error('playedMs must be a finite number of milliseconds, 0 or more.')
  if (
    typeof r.startedAt !== 'number' ||
    !Number.isFinite(r.startedAt) ||
    r.startedAt < 0 ||
    r.startedAt > MAX_TIME_MS
  )
    throw new Error('startedAt must be a finite epoch time in milliseconds.')
  return { track: r.track, playedMs: r.playedMs, startedAt: r.startedAt }
}

/** Integer clamp to 1..500; anything not a number gives the default. */
export function clampLimit(limit: unknown): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return RECENT_DEFAULT_LIMIT
  return Math.min(RECENT_MAX_LIMIT, Math.max(1, Math.floor(limit)))
}

type AggRow = TrackRow & { plays: number; played_ms: number; last_played: string }

const SMART_META: Record<SmartPlaylistKind, { name: string; description: string }> = {
  recent: {
    name: 'Recently played',
    description: `The last ${SMART_RECENT_MAX} different tracks you played, newest first.`
  },
  'on-repeat': {
    name: 'On repeat',
    description: `Tracks you played at least ${ON_REPEAT_MIN_PLAYS} times in the last ${ON_REPEAT_DAYS} days, most played first.`
  },
  forgotten: {
    name: 'Forgotten favourites',
    description: `Tracks you played at least ${FORGOTTEN_MIN_PLAYS} times but not in the last ${FORGOTTEN_DAYS} days, most played first.`
  }
}

export interface HistoryStore {
  /** Returns true when a play was stored (false: local track without a row). */
  record(report: unknown): boolean
  recent(limit: unknown): RecentPlay[]
  smart(kind: unknown): SmartPlaylist
  stats(range: unknown): ListeningStats
  clear(): void
}

export function createHistoryStore(db: Db, now: () => number = Date.now): HistoryStore {
  const iso = (ms: number): string => new Date(ms).toISOString()
  const daysAgo = (days: number): string => iso(now() - days * DAY_MS)
  const cols = trackColumns('t')

  const insertPlay = db.prepare(
    'INSERT INTO plays (track_id, provider, played_at, played_ms) VALUES (?, ?, ?, ?)'
  )
  const hasTrack = db.prepare('SELECT 1 FROM tracks WHERE id = ?').pluck()

  /** Per-track aggregates over plays whose track row still exists. */
  function aggregate(opts: {
    since?: string
    having?: string
    orderBy: string
    limit: number
    params?: unknown[]
  }): AggRow[] {
    const where = opts.since ? 'WHERE p.played_at >= ?' : ''
    const sql = `
      SELECT ${cols}, COUNT(*) AS plays, COALESCE(SUM(p.played_ms), 0) AS played_ms,
             MAX(p.played_at) AS last_played
      FROM plays p JOIN tracks t ON t.id = p.track_id
      ${where}
      GROUP BY t.id
      ${opts.having ? `HAVING ${opts.having}` : ''}
      ORDER BY ${opts.orderBy}
      ${opts.limit > 0 ? 'LIMIT ?' : ''}`
    const params: unknown[] = []
    if (opts.since) params.push(opts.since)
    params.push(...(opts.params ?? []))
    if (opts.limit > 0) params.push(opts.limit)
    return db.prepare(sql).all(...params) as AggRow[]
  }

  function smartTracks(kind: SmartPlaylistKind): Track[] {
    switch (kind) {
      case 'recent':
        return aggregate({
          orderBy: 'last_played DESC, MAX(p.id) DESC',
          limit: SMART_RECENT_MAX
        }).map(rowToTrack)
      case 'on-repeat':
        return aggregate({
          since: daysAgo(ON_REPEAT_DAYS),
          having: 'COUNT(*) >= ?',
          params: [ON_REPEAT_MIN_PLAYS],
          orderBy: 'plays DESC, last_played DESC',
          limit: ON_REPEAT_MAX
        }).map(rowToTrack)
      case 'forgotten':
        return aggregate({
          having: 'COUNT(*) >= ? AND MAX(p.played_at) < ?',
          params: [FORGOTTEN_MIN_PLAYS, daysAgo(FORGOTTEN_DAYS)],
          orderBy: 'plays DESC, last_played DESC',
          limit: FORGOTTEN_MAX
        }).map(rowToTrack)
    }
  }

  function topArtists(rows: readonly AggRow[]): ArtistStat[] {
    const byKey = new Map<string, ArtistStat & { order: number }>()
    let order = 0
    // Rows come most played first, so names and artwork come from an artist's top track.
    for (const row of rows) {
      const track = rowToTrack(row)
      const seen = new Set<string>()
      for (const raw of track.artists) {
        const name = raw.trim()
        const key = name.toLowerCase()
        if (!key || seen.has(key)) continue
        seen.add(key)
        let stat = byKey.get(key)
        if (!stat) {
          stat = { name, plays: 0, playedMs: 0, order: order++ }
          byKey.set(key, stat)
        }
        stat.plays += row.plays
        stat.playedMs += row.played_ms
        if (!stat.artworkUrl && track.artworkUrl) stat.artworkUrl = track.artworkUrl
        if (!stat.artistId) {
          const ref = track.artistRefs?.find((r) => r.name.trim().toLowerCase() === key)
          if (ref) stat.artistId = ref.id
        }
      }
    }
    return [...byKey.values()]
      .sort((a, b) => b.plays - a.plays || b.playedMs - a.playedMs || a.order - b.order)
      .slice(0, STATS_TOP)
      .map((s) => {
        const stat: ArtistStat = { name: s.name, plays: s.plays, playedMs: s.playedMs }
        if (s.artworkUrl) stat.artworkUrl = s.artworkUrl
        if (s.artistId) stat.artistId = s.artistId
        return stat
      })
  }

  return {
    record(report) {
      const r = validateReport(report)
      const { track } = r
      let stored = false
      db.transaction(() => {
        if (track.provider === 'local') {
          if (hasTrack.get(track.id) === undefined) return
        } else {
          upsertServiceTracks(db, [track])
        }
        insertPlay.run(track.id, track.provider, iso(r.startedAt), Math.round(r.playedMs))
        stored = true
      })()
      return stored
    },

    recent(limit) {
      const rows = db
        .prepare(
          `SELECT ${cols}, p.played_at AS played_at
           FROM plays p JOIN tracks t ON t.id = p.track_id
           ORDER BY p.played_at DESC, p.id DESC
           LIMIT ?`
        )
        .all(clampLimit(limit)) as (TrackRow & { played_at: string })[]
      return rows.map((row) => ({ track: rowToTrack(row), playedAt: row.played_at }))
    },

    smart(kind) {
      if (typeof kind !== 'string' || !(kind in SMART_META))
        throw new Error(`Not a smart playlist: ${String(kind)}`)
      const k = kind as SmartPlaylistKind
      return { kind: k, ...SMART_META[k], tracks: smartTracks(k) }
    },

    stats(range) {
      if (typeof range !== 'string' || !(range in RANGE_DAYS))
        throw new Error(`Not a stats range: ${String(range)}`)
      const r = range as StatsRange
      const days = RANGE_DAYS[r]
      const since = days === null ? undefined : daysAgo(days)
      const where = since ? 'WHERE played_at >= ?' : ''
      const params = since ? [since] : []

      const totals = db
        .prepare(`SELECT COUNT(*) AS plays, COALESCE(SUM(played_ms), 0) AS ms FROM plays ${where}`)
        .get(...params) as { plays: number; ms: number }
      const bySource: ListeningStats['bySource'] = { spotify: 0, soundcloud: 0, local: 0 }
      const sources = db
        .prepare(`SELECT provider, COUNT(*) AS n FROM plays ${where} GROUP BY provider`)
        .all(...params) as { provider: keyof ListeningStats['bySource']; n: number }[]
      for (const s of sources) if (s.provider in bySource) bySource[s.provider] = s.n

      const rows = aggregate({
        since,
        orderBy: 'plays DESC, played_ms DESC, last_played DESC',
        limit: 0
      })
      const topTracks: TrackStat[] = rows.slice(0, STATS_TOP).map((row) => ({
        track: rowToTrack(row),
        plays: row.plays,
        playedMs: row.played_ms
      }))

      return {
        range: r,
        totalPlays: totals.plays,
        totalMs: totals.ms,
        bySource,
        topArtists: topArtists(rows),
        topTracks
      }
    },

    clear() {
      db.prepare('DELETE FROM plays').run()
    }
  }
}
