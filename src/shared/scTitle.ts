// SoundCloud title cleanup (QoL 4). Archive uploads often put the real artist in the
// title ("thuggpint - neglected ass kid…") or repeat it there ("*67 - funnycat313_").
// This works out the artist and title, and how sure it is. It only splits on a dash
// with spaces round it, so names like "Hi-C" stay whole, and it leaves version tags
// ("Song - Prod. X", "Song - Slowed") alone.

export type TitleConfidence = 'none' | 'high' | 'medium'

export interface TitleGuess {
  title: string
  artists: string[]
  confidence: TitleConfidence
  /** Why it changed (shown in Details). Empty when nothing changed. */
  reason: string
}

/** Your own fix for a track's title and artists. */
export interface TitleOverride {
  title: string
  artists: string[]
}

export interface KnownArtists {
  has(name: string): boolean
}

/** Compare names ignoring case, spaces and punctuation ("Hi-C" = "hi c"). */
export function artistKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

const DASH = /^(.+?)\s+[-–—]\s+(.+)$/

/** Right side of "X - Y" that is a version or credit, not a song title. */
const VERSION_TAG =
  /^[([]?\s*(?:prod(?:uced)?\b\.?|remix\b|slowed\b|sped\s*up\b|nightcore\b|reverb\b|edit\b|mix\b|version\b|v\d+\b|live\b|demo\b|snippet\b|leak(?:ed)?\b|unreleased\b|flip\b|cover\b|instrumental\b|acapella\b|a\s*cappella\b|cdq\b|og\b|bootleg\b|remaster(?:ed)?\b|extended\b|clean\b|explicit\b)/i

export function parseScTitle(
  track: { title: string; artist: string; uploader: string },
  known: KnownArtists,
  archiveUploader = false
): TitleGuess {
  const keep: TitleGuess = {
    title: track.title,
    artists: track.artist ? [track.artist] : [],
    confidence: 'none',
    reason: ''
  }
  const m = DASH.exec(track.title.trim())
  if (!m) return keep
  const left = m[1]!.trim()
  const right = m[2]!.trim()
  const lk = artistKey(left)
  if (!lk) return keep

  if (lk === artistKey(track.artist) || lk === artistKey(track.uploader))
    return {
      title: right,
      artists: keep.artists.length ? keep.artists : [left],
      confidence: 'high',
      reason: 'The title repeated the artist'
    }
  if (VERSION_TAG.test(right)) return keep
  if (known.has(left))
    return {
      title: right,
      artists: [left],
      confidence: 'high',
      reason: `Artist from title: ${left}`
    }
  if (known.has(right))
    return {
      title: left,
      artists: [right],
      confidence: 'high',
      reason: `Artist from title (after the dash): ${right}`
    }
  if (archiveUploader)
    return {
      title: right,
      artists: [left],
      confidence: 'medium',
      reason: `Artist from title: ${track.uploader} uploads as "Artist - Title"`
    }
  return keep
}

/** "Hi C X DOMD" → ["Hi C", "DOMD"], for showing each name on its own. */
export function splitArtists(s: string): string[] {
  return s
    .split(/\s+(?:x|&|and|feat\.?|ft\.?|with)\s+|\s*,\s*/i)
    .map((p) => p.trim())
    .filter(Boolean)
}

/** Archive labels that don't belong in a scrobble ("(unreleased)", "[CDQ]", "*snippet*"). */
const NOISE =
  /\s*(?:\(|\[|\*)\s*(?:unreleased|leak(?:ed)?|cdq|hq|lq|snippet|og\s*file|og|full\s*(?:song|version|leak)|clean\s*cdq)\s*(?:\)|\]|\*)/gi

export function stripArchiveNoise(title: string): string {
  return (
    title
      .replace(NOISE, '')
      .replace(/\s{2,}/g, ' ')
      .trim() || title
  )
}

/**
 * Many "X - Y" uploads by different X, none of them the uploader: an archive account,
 * whose uploads are probably "Artist - Title".
 */
export function isArchiveUploader(uploader: string, titles: string[]): boolean {
  const own = artistKey(uploader)
  const lefts = titles
    .map((t) => DASH.exec(t.trim())?.[1])
    .filter((l): l is string => !!l)
    .map(artistKey)
    .filter((k) => k && k !== own)
  return lefts.length >= 3 && lefts.length / titles.length >= 0.6 && new Set(lefts).size >= 2
}
