// discography.stream JSON -> the app's Track.
import { DISCOGRAPHY_ORIGIN } from '@shared/discography'
import type { Track } from '@shared/types'
import type { DgTrack } from './api'

/**
 * Artwork paths come relative to /api (`/public/artwork/...`). Absolute https URLs on
 * the site are kept; anything else is dropped.
 */
export function artworkUrl(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined
  if (raw.startsWith('/')) return `${DISCOGRAPHY_ORIGIN}/api${raw}`
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' && u.hostname.endsWith('discography.stream') ? raw : undefined
  } catch {
    return undefined
  }
}

/** Seconds since epoch in a signed stream URL's `exp`, as epoch ms (undefined if none). */
export function streamExpiry(url: string): number | undefined {
  try {
    const exp = Number(new URL(url).searchParams.get('exp'))
    return Number.isFinite(exp) && exp > 0 ? exp * 1000 : undefined
  } catch {
    return undefined
  }
}

export function toTrack(t: DgTrack): Track | null {
  if (!t || typeof t.id !== 'string' || !t.id || typeof t.title !== 'string') return null
  const artists = (Array.isArray(t.artists) ? t.artists : [])
    .filter((a): a is string => typeof a === 'string' && a.trim() !== '')
    .map((a) => a.trim())
  const track: Track = {
    id: `discography:${t.id}`,
    provider: 'discography',
    nativeId: t.id,
    title: t.title.trim() || 'Untitled',
    artists,
    durationMs: typeof t.duration === 'number' && t.duration > 0 ? Math.round(t.duration * 1000) : 0
  }
  if (t.album) track.album = t.album
  if (t.available === false) track.availability = 'blocked'
  const art = artworkUrl(t.media_artwork_url ?? t.artwork_url)
  if (art) track.artworkUrl = art
  return track
}
