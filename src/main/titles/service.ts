// Tidies SoundCloud archive titles as tracks are mapped (QoL 4). Your own fixes win;
// otherwise the guess from shared/scTitle, using artists the app already knows and
// how each uploader names their songs.
import { artistKey, isArchiveUploader, parseScTitle, splitArtists } from '@shared/scTitle'
import type { Track } from '@shared/types'
import type { TitleOverride } from '@shared/scTitle'
import type { SettingsStore } from '../spotify/tokens'

export type { TitleOverride }

const OVERRIDE_KEY = 'titles.override:'
/** Known artists are re-read this often (they change as the library grows). */
export const KNOWN_REFRESH_MS = 5 * 60 * 1000
/** Titles kept per uploader to judge whether they're an archive account. */
const TITLES_PER_UPLOADER = 60

export function createTitles(deps: {
  settings: SettingsStore
  enabled(): boolean
  /** Every artist name the app has (library, likes, playlists, plays). */
  loadKnown(): string[]
  now?: () => number
}): {
  clean(track: Track): Track
  getOverride(trackId: string): TitleOverride | 'original' | null
  setOverride(trackId: string, value: TitleOverride | 'original' | null): void
} {
  const now = deps.now ?? Date.now
  let known = new Set<string>()
  let knownAt = -Infinity
  const uploads = new Map<string, string[]>()

  const knownSet = (): Set<string> => {
    if (now() - knownAt >= KNOWN_REFRESH_MS) {
      knownAt = now()
      known = new Set<string>()
      for (const name of deps.loadKnown())
        for (const part of [name, ...splitArtists(name)]) {
          const k = artistKey(part)
          if (k.length >= 2) known.add(k)
        }
    }
    return known
  }

  const remember = (uploader: string, title: string): string[] => {
    const list = uploads.get(uploader) ?? []
    if (!list.includes(title)) {
      list.push(title)
      if (list.length > TITLES_PER_UPLOADER) list.shift()
      uploads.set(uploader, list)
    }
    return list
  }

  const getOverride = (trackId: string): TitleOverride | 'original' | null => {
    const raw = deps.settings.get(OVERRIDE_KEY + trackId)
    if (!raw) return null
    try {
      const v = JSON.parse(raw) as unknown
      if (v === 'original') return 'original'
      const o = v as Partial<TitleOverride>
      if (typeof o?.title === 'string' && Array.isArray(o.artists))
        return { title: o.title, artists: o.artists.filter((a) => typeof a === 'string') }
    } catch {
      // ignore a broken entry
    }
    return null
  }

  const apply = (
    track: Track,
    title: string,
    artists: string[],
    guess: Track['titleGuess'],
    note: string
  ): Track => {
    const out: Track = {
      ...track,
      title,
      artists,
      originalTitle: track.title,
      titleGuess: guess,
      titleNote: note
    }
    if (track.artists[0]) out.originalArtist = track.artists[0]
    // The artist link goes to the uploader's page; keep it only for the same name.
    if (artistKey(artists[0] ?? '') !== artistKey(track.artists[0] ?? '')) delete out.artistRefs
    return out
  }

  return {
    clean(track) {
      if (track.provider !== 'soundcloud') return track
      const uploader = track.uploader ?? ''
      const titles = uploader ? remember(uploader, track.title) : []
      const override = getOverride(track.id)
      if (override === 'original') return track
      if (override) return apply(track, override.title, override.artists, 'user', 'Fixed by you')
      if (!deps.enabled()) return track
      const guess = parseScTitle(
        { title: track.title, artist: track.artists[0] ?? '', uploader },
        { has: (n) => knownSet().has(artistKey(n)) },
        !!uploader && isArchiveUploader(uploader, titles)
      )
      if (guess.confidence === 'none') return track
      return apply(track, guess.title, guess.artists, guess.confidence, guess.reason)
    },
    getOverride,
    setOverride(trackId, value) {
      if (value === null) deps.settings.delete(OVERRIDE_KEY + trackId)
      else deps.settings.set(OVERRIDE_KEY + trackId, JSON.stringify(value))
    }
  }
}
