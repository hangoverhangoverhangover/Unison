// duplicates:find / duplicates:dismiss: same-song groups across Liked Songs and local
// files. Never merges or hides anything by itself; the user confirms every group.
import type { AlreadyInPlaylist, DuplicateGroup, MatchConfidence } from '@shared/transfer'
import type { Track } from '@shared/types'
import type { Db } from '../db'
import { rowToTrack, trackColumns, type TrackRow } from '../db/tracks'
import { compareShapes, confidenceRank, songShape, weakerConfidence } from '../music/match'

/** settings key: JSON array of dismissed group keys, oldest first. */
export const DISMISSED_KEY = 'duplicates.dismissed'
export const DISMISSED_MAX = 5000
export const MAX_GROUPS = 500
/** Longest group key accepted by dismiss (keys are ids joined by KEY_SEPARATOR). */
export const KEY_MAX_LENGTH = 20_000
export const KEY_SEPARATOR = '|'

const PROVIDER_ORDER: Record<Track['provider'], number> = { spotify: 0, soundcloud: 1, local: 2 }

/**
 * Songs in `adding` that `existing` already has: the same track, or the same song
 * (ISRC or matching title and artist, like the Duplicates tab, but not "close" guesses).
 */
export function findAlreadyIn(
  adding: readonly Track[],
  existing: readonly Track[]
): AlreadyInPlaylist[] {
  const byId = new Map(existing.map((t) => [t.id, t]))
  const shapes = existing.map((t) => ({ t, s: songShape(t) }))
  const out: AlreadyInPlaylist[] = []
  for (const track of adding) {
    const same = byId.get(track.id)
    if (same) {
      out.push({ track, match: same, sameTrack: true })
      continue
    }
    const shape = songShape(track)
    const hit = shapes.find(({ s }) => {
      const c = compareShapes(shape, s)
      return c === 'isrc' || c === 'exact'
    })
    if (hit) out.push({ track, match: hit.t, sameTrack: false })
  }
  return out
}

/** Stable group key: the sorted track ids joined. */
export function groupKey(tracks: readonly Pick<Track, 'id'>[]): string {
  return tracks
    .map((t) => t.id)
    .sort()
    .join(KEY_SEPARATOR)
}

/** The longest word of a title: where a track is looked up in the word index. */
function anchorWord(title: string): string | null {
  let best: string | null = null
  for (const w of title.split(' ')) if (w && (!best || w.length > best.length)) best = w
  return best
}

class UnionFind {
  private readonly parent: number[]
  /** Weakest link that joined each root's component (null = single track). */
  readonly confidence: (MatchConfidence | null)[]
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i)
    this.confidence = new Array<MatchConfidence | null>(n).fill(null)
  }
  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]!]!
      i = this.parent[i]!
    }
    return i
  }
  union(a: number, b: number, c: MatchConfidence): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra === rb) return
    let conf = c
    for (const x of [this.confidence[ra], this.confidence[rb]])
      if (x) conf = weakerConfidence(conf, x)
    this.parent[rb] = ra
    this.confidence[ra] = conf
  }
}

/**
 * Groups tracks that look like the same song (see compareShapes for the confidences).
 * Pairs are only compared when they share an ISRC or the longest word of one title
 * appears in the other, so ~4,000 tracks stay well under a second. Components join
 * strongest links first, so a group's confidence is its weakest necessary link.
 * Kept: groups with tracks from different sources, or two ids on one service (liked
 * twice); groups of only local files are left out. Dismissed keys are skipped.
 * Order: confidence, then title. At most `max` groups.
 */
export function findDuplicateGroups(
  tracks: readonly Track[],
  dismissed: ReadonlySet<string> = new Set(),
  max = MAX_GROUPS
): DuplicateGroup[] {
  const list: Track[] = []
  const ids = new Set<string>()
  for (const t of tracks) {
    if (!t || typeof t.id !== 'string' || ids.has(t.id)) continue
    ids.add(t.id)
    list.push(t)
  }
  const shapes = list.map(songShape)

  const byIsrc = new Map<string, number[]>()
  const byWord = new Map<string, number[]>()
  shapes.forEach((s, i) => {
    if (s.isrc) {
      const bucket = byIsrc.get(s.isrc)
      if (bucket) bucket.push(i)
      else byIsrc.set(s.isrc, [i])
    }
    const words = new Set<string>()
    for (const r of s.readings) for (const w of r.title.split(' ')) if (w) words.add(w)
    for (const w of words) {
      const bucket = byWord.get(w)
      if (bucket) bucket.push(i)
      else byWord.set(w, [i])
    }
  })

  const edges: { a: number; b: number; c: MatchConfidence }[] = []
  for (const bucket of byIsrc.values())
    for (let k = 1; k < bucket.length; k++) edges.push({ a: bucket[0]!, b: bucket[k]!, c: 'isrc' })

  // A contained title's longest word is (almost always) a whole word of the longer
  // title, so looking each track up by its anchors finds every pair from at least one
  // side. A pair found from both sides just adds the same edge twice (harmless).
  const seen = new Set<number>()
  shapes.forEach((s, i) => {
    seen.clear()
    for (const r of s.readings) {
      const anchor = anchorWord(r.title)
      if (!anchor) continue
      for (const j of byWord.get(anchor) ?? []) {
        if (j === i || seen.has(j)) continue
        seen.add(j)
        const c = compareShapes(s, shapes[j]!)
        // Same-ISRC pairs are already linked above.
        if (c && c !== 'isrc') edges.push({ a: i, b: j, c })
      }
    }
  })

  const uf = new UnionFind(list.length)
  edges.sort((x, y) => confidenceRank(x.c) - confidenceRank(y.c))
  for (const e of edges) uf.union(e.a, e.b, e.c)

  const members = new Map<number, number[]>()
  for (let i = 0; i < list.length; i++) {
    const root = uf.find(i)
    const m = members.get(root)
    if (m) m.push(i)
    else members.set(root, [i])
  }

  const groups: DuplicateGroup[] = []
  for (const [root, idx] of members) {
    if (idx.length < 2) continue
    const groupTracks = idx.map((i) => list[i]!)
    if (groupTracks.every((t) => t.provider === 'local')) continue
    const key = groupKey(groupTracks)
    if (dismissed.has(key)) continue
    groupTracks.sort(
      (a, b) => PROVIDER_ORDER[a.provider] - PROVIDER_ORDER[b.provider] || (a.id < b.id ? -1 : 1)
    )
    groups.push({ key, confidence: uf.confidence[root] ?? 'close', tracks: groupTracks })
  }

  const index = new Map(list.map((t, i) => [t.id, i]))
  const titles = new Map(
    groups.map((g) => [g.key, shapes[index.get(g.tracks[0]!.id)!]!.rawTitle] as const)
  )
  return groups
    .sort(
      (a, b) =>
        confidenceRank(a.confidence) - confidenceRank(b.confidence) ||
        titles.get(a.key)!.localeCompare(titles.get(b.key)!) ||
        (a.key < b.key ? -1 : 1)
    )
    .slice(0, max)
}

/** Liked Songs (both services) and every local file, as tracks. */
export function loadDuplicateSources(db: Db): Track[] {
  const rows = db
    .prepare(
      `SELECT ${trackColumns('t')} FROM likes l JOIN tracks t ON t.id = l.track_id
       UNION
       SELECT ${trackColumns()} FROM tracks WHERE provider = 'local'`
    )
    .all() as TrackRow[]
  return rows.map(rowToTrack)
}

export function readDismissed(db: Db): string[] {
  const value = db.prepare('SELECT value FROM settings WHERE key = ?').pluck().get(DISMISSED_KEY)
  if (typeof value !== 'string') return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : []
  } catch {
    return []
  }
}

/** Remember a "not duplicates" answer. Newest last; the oldest drop past DISMISSED_MAX. */
export function dismissDuplicate(db: Db, key: string): void {
  if (typeof key !== 'string' || !key || key.length > KEY_MAX_LENGTH)
    throw new Error('Not a duplicate group key.')
  const keys = readDismissed(db).filter((k) => k !== key)
  keys.push(key)
  const kept = keys.slice(-DISMISSED_MAX)
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`
  ).run(DISMISSED_KEY, JSON.stringify(kept))
}

export function findDuplicates(db: Db): DuplicateGroup[] {
  return findDuplicateGroups(loadDuplicateSources(db), new Set(readDismissed(db)))
}
