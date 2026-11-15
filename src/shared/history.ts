// Play history and listening stats (QoL round 2). Owned by the main agent.
import type { Track } from './types'

/** Sent by the renderer once a track has played long enough to count. */
export interface PlayReport {
  track: Track
  /** How long it actually played, ms (seeks excluded). */
  playedMs: number
  /** Epoch ms when it started. */
  startedAt: number
}

/** A play counts after this much listening, or half the track if shorter. */
export const PLAY_COUNT_MIN_MS = 30_000

export interface RecentPlay {
  track: Track
  /** ISO 8601. */
  playedAt: string
}

/** Playlists built from history. */
export type SmartPlaylistKind = 'recent' | 'on-repeat' | 'forgotten'

export interface SmartPlaylist {
  kind: SmartPlaylistKind
  /** "Recently played", "On repeat", "Forgotten favourites". */
  name: string
  /** One line on how it's built. */
  description: string
  tracks: Track[]
}

export type StatsRange = 'week' | 'month' | 'year' | 'all'

export interface ArtistStat {
  name: string
  plays: number
  /** Total listening time, ms. */
  playedMs: number
  /** A track by them with artwork, for the card. */
  artworkUrl?: string
  /** App id when the artist is known on a service. */
  artistId?: string
}

export interface TrackStat {
  track: Track
  plays: number
  playedMs: number
}

export interface ListeningStats {
  range: StatsRange
  totalPlays: number
  totalMs: number
  /** Plays per source. */
  bySource: Record<'spotify' | 'soundcloud' | 'local', number>
  topArtists: ArtistStat[]
  topTracks: TrackStat[]
}
