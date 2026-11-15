// Same-song matching across services: title and artist normalisation (shared with
// Discord cover art) and the ranking behind music:findOn. Pure, no I/O.
import type { TrackMatch } from '@shared/match'
import type { MatchConfidence } from '@shared/transfer'
import { isPlayable, type Track } from '@shared/types'

/** Results music:findOn returns at most. */
export const MAX_MATCHES = 10
/** Durations this close (ms) count as the same recording when ranking. */
export const DURATION_SLACK_MS = 3000
/** For "one title contains the other", the shorter must be at least this share of the longer. */
export const MIN_CONTAINED_RATIO = 0.6

/** Lowercase, no accents, punctuation folded to spaces. */
export function normalize(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** Drop "(feat. X)", "[Official Video]", "- Remastered 2011" and similar from a title. */
export function cleanTitle(title: string): string {
  return title
    .replace(
      /\s*[([](?:feat\.?|ft\.?|featuring|with|prod\.?|official|lyrics?|audio|video|visuali[sz]er|remaster(?:ed)?|explicit|clean)\b[^)\]]*[)\]]/gi,
      ''
    )
    .replace(/\s+-\s+(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?(?:\s+version)?\s*$/i, '')
    .replace(/\s+(?:feat\.?|ft\.?)\s.*$/i, '')
    .trim()
}

/**
 * Whether two normalized artist names are the same artist: equal, or one contains
 * the other when both are at least 2 characters ("the weeknd" / "weeknd").
 */
function sameArtist(a: string, b: string): boolean {
  if (!a || !b) return false
  if (a === b) return true
  return a.length >= 2 && b.length >= 2 && (a.includes(b) || b.includes(a))
}

/**
 * Whether `artist` (raw) is one of the credited artists (raw), or appears as whole
 * words in `title` (SoundCloud "Artist - Title" uploads by someone else).
 */
export function artistMatches(artist: string, credits: string[], title = ''): boolean {
  const a = normalize(artist)
  if (!a) return false
  if (credits.some((c) => sameArtist(normalize(c), a))) return true
  const t = normalize(title)
  return a.length >= 2 && ` ${t} `.includes(` ${a} `)
}

/** `"<prefix> - <rest>"` (hyphen, en or em dash with spaces around it), or null. */
export function splitDashPrefix(title: string): { prefix: string; rest: string } | null {
  const m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(title.trim())
  return m ? { prefix: m[1]!.trim(), rest: m[2]!.trim() } : null
}

/**
 * The artists named in an "A & B - Title" prefix, normalized: split on commas, "&",
 * "+", "/", " x ", " and ", " feat. ", " vs ", " with ". The whole prefix comes first.
 */
export function prefixArtists(prefix: string): string[] {
  const whole = normalize(prefix)
  if (!whole) return []
  const parts = prefix
    .split(/\s*(?:[,&+/]|\s(?:x|and|feat\.?|ft\.?|vs\.?|with)\s)\s*/i)
    .map(normalize)
    .filter(Boolean)
  return [...new Set([whole, ...parts])]
}

/**
 * "Artist - Title" becomes "Title" when the part before the dash (or one of the artists
 * in an "A & B - Title" prefix) is one of `artists`.
 */
export function stripArtistPrefix(title: string, artists: string[]): string {
  const split = splitDashPrefix(title)
  if (!split) return title.trim()
  const named = prefixArtists(split.prefix)
  const credits = artists.map(normalize)
  return credits.some((c) => named.some((p) => sameArtist(c, p))) ? split.rest : title.trim()
}

/** Title used for comparing: artist prefix stripped, suffixes cleaned, normalized. */
export function comparableTitle(title: string, artists: string[]): string {
  return normalize(cleanTitle(stripArtistPrefix(title, artists)))
}

/** Normalized titles equal, or one contains the other and is at least 60% of its length. */
export function titlesMatch(a: string, b: string): boolean {
  if (!a || !b) return false
  if (a === b) return true
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  return long.includes(short) && short.length >= MIN_CONTAINED_RATIO * long.length
}

/** A valid ISRC (CC-XXX-YY-NNNNN, dashes and spaces dropped, uppercased), or null. */
export function normalizeIsrc(isrc: unknown): string | null {
  if (typeof isrc !== 'string') return null
  const s = isrc.replace(/[\s-]/g, '').toUpperCase()
  return /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(s) ? s : null
}

/** What to type into the other service's search: "<first artist> <cleaned title>". */
export function searchQuery(track: Pick<Track, 'title' | 'artists'>): string | null {
  const artist = track.artists[0]?.trim() ?? ''
  const title = cleanTitle(stripArtistPrefix(track.title, track.artists))
  if (!artist || !title) return null
  return `${artist} ${title}`
}

/**
 * Same-song candidates from a search of the other service, best first.
 * `results` are in the service's order (ISRC search results first, then the
 * title-plus-artist search). A result is an 'isrc' match when its ISRC equals the
 * source's, else a 'title-artist' match when the titles and an artist match.
 * Order: ISRC matches; then exact title, duration within 3 s, service order;
 * previews and blocked tracks last. Deduped by id, the source itself excluded.
 */
export function rankMatches(source: Track, results: Track[]): TrackMatch[] {
  const isrc = normalizeIsrc(source.isrc)
  const artist = source.artists[0] ?? ''
  const title = comparableTitle(source.title, source.artists)
  const seen = new Set<string>([source.id])
  const scored: { match: TrackMatch; key: number[] }[] = []

  results.forEach((t, index) => {
    if (!t || typeof t.id !== 'string' || seen.has(t.id)) return
    let match: TrackMatch | null = null
    let exact = false
    if (isrc && normalizeIsrc(t.isrc) === isrc) {
      match = { track: t, reason: 'isrc' }
    } else if (title && artist) {
      const rt = comparableTitle(t.title ?? '', [artist, ...(t.artists ?? [])])
      if (titlesMatch(title, rt) && artistMatches(artist, t.artists ?? [], t.title ?? '')) {
        match = { track: t, reason: 'title-artist' }
        exact = rt === title
      }
    }
    if (!match) return
    seen.add(t.id)
    const closeDuration =
      source.durationMs > 0 &&
      t.durationMs > 0 &&
      Math.abs(source.durationMs - t.durationMs) <= DURATION_SLACK_MS
    // Lower sorts first.
    scored.push({
      match,
      key: [
        isPlayable(t) ? 0 : 1,
        match.reason === 'isrc' ? 0 : 1,
        match.reason === 'isrc' || exact ? 0 : 1,
        match.reason === 'isrc' || closeDuration ? 0 : 1,
        index
      ]
    })
  })

  return scored
    .sort((a, b) => {
      for (let i = 0; i < a.key.length; i++) if (a.key[i] !== b.key[i]) return a.key[i]! - b.key[i]!
      return 0
    })
    .slice(0, MAX_MATCHES)
    .map((s) => s.match)
}

/**
 * One way of reading a track's artist and title. Every track has its tagged reading;
 * a title like "Artist - Title" whose prefix isn't one of the track's own artists
 * (a SoundCloud archive upload by someone else) also gets the reading "Artist" + "Title".
 */
export interface SongReading {
  /** Normalized artists, first artist first. */
  artists: string[]
  /** comparableTitle of the title in this reading. */
  title: string
}

/** What same-song comparison needs from a track, precomputed once per track. */
export interface SongShape {
  isrc: string | null
  readings: SongReading[]
  /** Normalized full title (for "artist named in the title"). */
  rawTitle: string
}

export function songShape(track: Pick<Track, 'title' | 'artists' | 'isrc'>): SongShape {
  const title = typeof track.title === 'string' ? track.title : ''
  const credits = Array.isArray(track.artists) ? track.artists : []
  const artists = credits.map(normalize).filter(Boolean)
  const readings: SongReading[] = [{ artists, title: comparableTitle(title, credits) }]
  const split = splitDashPrefix(title)
  if (split && stripArtistPrefix(title, credits) === title.trim()) {
    const named = prefixArtists(split.prefix)
    // Whole prefix first, then its parts ("A & B" -> "a and b", "a", "b").
    const reading = { artists: named, title: normalize(cleanTitle(split.rest)) }
    if (reading.title && named.length > 0) readings.push(reading)
  }
  return { isrc: normalizeIsrc(track.isrc), readings, rawTitle: normalize(title) }
}

const CONFIDENCE_RANK: Record<MatchConfidence, number> = { isrc: 0, exact: 1, close: 2 }

/** Lower is stronger: isrc 0, exact 1, close 2. */
export function confidenceRank(c: MatchConfidence): number {
  return CONFIDENCE_RANK[c]
}

/** The weaker of two confidences. */
export function weakerConfidence(a: MatchConfidence, b: MatchConfidence): MatchConfidence {
  return CONFIDENCE_RANK[a] >= CONFIDENCE_RANK[b] ? a : b
}

function namedInTitle(artists: string[], rawTitle: string): boolean {
  const t = ` ${rawTitle} `
  return artists.some((a) => a.length >= 2 && t.includes(` ${a} `))
}

/**
 * How sure we are two tracks are the same song, or null when they don't look alike.
 * - isrc: both have the same ISRC.
 * - exact: same cleaned title and same first artist (in some reading of each track, so
 *   "Artist - Title" uploaded by someone else equals "Title" by Artist).
 * - close: one title contains the other (at least 60% of it) and an artist matches
 *   loosely (one contains the other, or is named in the other's title).
 * Never decisive on its own: the UI asks the user to confirm every match.
 */
export function compareShapes(a: SongShape, b: SongShape): MatchConfidence | null {
  if (a.isrc && a.isrc === b.isrc) return 'isrc'
  let best: MatchConfidence | null = null
  for (const ra of a.readings) {
    for (const rb of b.readings) {
      if (!titlesMatch(ra.title, rb.title)) continue
      const first = ra.artists[0]
      if (ra.title === rb.title && first && first === rb.artists[0]) return 'exact'
      if (best) continue
      const loose =
        ra.artists.some((x) => rb.artists.some((y) => sameArtist(x, y))) ||
        namedInTitle(ra.artists, b.rawTitle) ||
        namedInTitle(rb.artists, a.rawTitle)
      if (loose) best = 'close'
    }
  }
  return best
}

/** compareShapes for two tracks. */
export function matchConfidence(
  a: Pick<Track, 'title' | 'artists' | 'isrc'>,
  b: Pick<Track, 'title' | 'artists' | 'isrc'>
): MatchConfidence | null {
  return compareShapes(songShape(a), songShape(b))
}
