// Genius as a backup lyrics source (QoL 4): asked only when LRCLIB finds no lyrics at
// all, and only with the user's own API token. The API finds the song and its page;
// the lyrics themselves are only on that web page, so they're read from its HTML (the
// `data-lyrics-container` blocks). Genius lyrics aren't synced: they show as plain
// lyrics that can be synced in the editor. Built from the commonly known API shape
// (api.genius.com/search with a Bearer token); the docs couldn't be checked from here,
// so everything fails quietly to "no lyrics".
import type { Track } from '@shared/types'
import { artistMatches, cleanTitle, comparableTitle, normalize, titlesMatch } from '../music/match'

export const GENIUS_API = 'https://api.genius.com'

type Fetch = (url: string, init?: RequestInit) => Promise<Response>

interface Hit {
  type?: string
  result?: {
    title?: string
    url?: string
    lyrics_state?: string
    primary_artist?: { name?: string }
  }
}

/** The best search hit for this song: same artist and title, with lyrics. */
export function pickHit(hits: unknown, track: Pick<Track, 'title' | 'artists'>): string | null {
  if (!Array.isArray(hits)) return null
  const artist = track.artists[0] ?? ''
  const want = normalize(comparableTitle(track.title, track.artists))
  for (const h of hits as Hit[]) {
    const r = h?.result
    if (h?.type !== 'song' || !r?.url || !r.title) continue
    if (r.lyrics_state && r.lyrics_state !== 'complete') continue
    if (!r.url.startsWith('https://genius.com/')) continue
    const by = r.primary_artist?.name ?? ''
    const sameArtist = artistMatches(by, [artist]) || artistMatches(artist, [by])
    if (sameArtist && titlesMatch(want, normalize(comparableTitle(r.title, [by])))) return r.url
  }
  return null
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
}

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#')
      return String.fromCodePoint(
        e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      )
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

/** Remove an element and everything inside it, counting nested tags of the same name. */
function dropElements(html: string, open: RegExp): string {
  let out = html
  for (;;) {
    const m = open.exec(out)
    if (!m) return out
    const tag = m[1]!.toLowerCase()
    const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi')
    re.lastIndex = m.index + m[0].length
    let depth = 1
    let end = out.length
    for (let t = re.exec(out); t; t = re.exec(out)) {
      depth += t[1] ? -1 : 1
      if (depth === 0) {
        end = t.index + t[0].length
        break
      }
    }
    out = out.slice(0, m.index) + out.slice(end)
  }
}

/** Inner HTML of every `data-lyrics-container` element, in order. */
function containers(html: string): string[] {
  const out: string[] = []
  const open = /<div\b[^>]*data-lyrics-container="true"[^>]*>/gi
  for (let m = open.exec(html); m; m = open.exec(html)) {
    const re = /<(\/?)div\b[^>]*>/gi
    re.lastIndex = m.index + m[0].length
    let depth = 1
    for (let t = re.exec(html); t; t = re.exec(html)) {
      depth += t[1] ? -1 : 1
      if (depth === 0) {
        out.push(html.slice(m.index + m[0].length, t.index))
        open.lastIndex = t.index
        break
      }
    }
  }
  return out
}

/**
 * Plain lyrics from a Genius song page: line breaks kept, section headers like
 * "[Chorus]" dropped (the user asked for none), blank runs squeezed. Null when the
 * page has no lyrics blocks.
 */
export function lyricsFromPage(html: string): string | null {
  const blocks = containers(html)
  if (blocks.length === 0) return null
  const text = blocks
    .map((b) =>
      decode(
        dropElements(b, /<(\w+)\b[^>]*data-exclude-from-selection="true"[^>]*>/i)
          // Newlines in the HTML source are only spaces; <br> is the line break.
          .replace(/\s*\n\s*/g, ' ')
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<[^>]+>/g, '')
      )
    )
    .join('\n')
  const lines = text
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => !/^\[[^\]]*\]$/.test(l))
  const squeezed: string[] = []
  for (const l of lines) if (l || (squeezed.length && squeezed.at(-1) !== '')) squeezed.push(l)
  while (squeezed.at(-1) === '') squeezed.pop()
  return squeezed.length ? squeezed.join('\n') : null
}

/**
 * Look the song up. { plain, url } when found, 'none' when Genius has no match,
 * null when it couldn't answer (offline, bad token, rate limited): don't cache that.
 */
export async function geniusLyrics(
  fetchFn: Fetch,
  token: string,
  track: Track,
  userAgent: string
): Promise<{ plain: string; url: string } | 'none' | null> {
  const artist = track.artists[0]?.trim()
  const title = cleanTitle(track.title).trim()
  if (!artist || !title) return 'none'
  try {
    const res = await fetchFn(
      `${GENIUS_API}/search?${new URLSearchParams({ q: `${artist} ${title}` }).toString()}`,
      { headers: { Authorization: `Bearer ${token}`, 'User-Agent': userAgent } }
    )
    if (!res.ok) return null
    const json = (await res.json()) as { response?: { hits?: unknown } }
    const url = pickHit(json.response?.hits, track)
    if (!url) return 'none'
    const page = await fetchFn(url, { headers: { 'User-Agent': userAgent } })
    if (!page.ok) return null
    const plain = lyricsFromPage(await page.text())
    return plain ? { plain, url } : 'none'
  } catch {
    return null
  }
}
