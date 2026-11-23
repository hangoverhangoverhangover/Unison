// Shared domain types. Owned by the main agent: subagents code against these
// and report back if they need a change instead of editing them.

export type Provider = 'spotify' | 'soundcloud' | 'discography' | 'local'

/** Every track, whatever its source, becomes this shape. */
export interface Track {
  /** `${provider}:${nativeId}` */
  id: string
  provider: Provider
  nativeId: string
  title: string
  artists: string[]
  /**
   * Links for `artists`, same order, when the service gives them. Ids are app ids
   * (`spotify:<id>` / `soundcloud:<userId>`). Local tracks have none.
   */
  artistRefs?: EntityRef[]
  album?: string
  /** The album this track is on (Spotify), app id `spotify:<albumId>`. */
  albumRef?: EntityRef
  /** Public https page for the track on its service. */
  url?: string
  durationMs: number
  artworkUrl?: string
  isrc?: string
  /** Set for local files and downloads. */
  localPath?: string
  /** Set on downloaded SoundCloud files; links back to the original. */
  sourceScId?: string
  /**
   * Missing or 'full': plays normally. 'preview': the service only serves a short
   * snippet. 'blocked': not streamable (policy BLOCK, geo, or removed). 'drm': only
   * encrypted streams exist; they play through Widevine (castLabs ECS). The UI labels
   * preview and blocked tracks and the queue skips them.
   */
  availability?: TrackAvailability
  /** SoundCloud: the account that uploaded it (may differ from the shown artist). */
  uploader?: string
  /**
   * SoundCloud, set when the title was tidied (QoL 4): the title as uploaded, and why
   * it changed. `titleGuess` medium means a guess from how the uploader names songs.
   */
  originalTitle?: string
  originalArtist?: string
  titleNote?: string
  titleGuess?: 'high' | 'medium' | 'user'
}

export type TrackAvailability = 'full' | 'preview' | 'blocked' | 'drm'

/** A link to an artist or album: app id plus display name. */
export interface EntityRef {
  /** `${provider}:${nativeId}` */
  id: string
  name: string
  /** Public https page on the service, when known. */
  url?: string
}

/** An artist (Spotify) or user profile (SoundCloud). */
export interface Artist {
  /** `${provider}:${nativeId}` */
  id: string
  provider: 'spotify' | 'soundcloud'
  nativeId: string
  name: string
  imageUrl?: string
  /** Wide banner for the page header (SoundCloud visuals), when there is one. */
  bannerUrl?: string
  /** SoundCloud only: Spotify removed followers in 2026. */
  followers?: number
  verified?: boolean
  /** Public https page on the service. */
  url?: string
}

/**
 * Spotify album types, plus SoundCloud set types. 'ep' is inferred for Spotify.
 * 'playlist': a SoundCloud set that isn't an album (opened from a profile).
 */
export type AlbumType = 'album' | 'single' | 'ep' | 'compilation' | 'playlist'

/** An album, single or EP (Spotify album; SoundCloud set with is_album). */
export interface Album {
  /** `${provider}:${nativeId}` */
  id: string
  provider: 'spotify' | 'soundcloud'
  nativeId: string
  name: string
  type: AlbumType
  artists: EntityRef[]
  artworkUrl?: string
  /** ISO date or year ('2026', '2026-03-27'). */
  releaseDate?: string
  trackCount: number
  url?: string
}

export interface ArtistPage {
  artist: Artist
  /**
   * Spotify: best search matches for the artist (the top-tracks endpoint was removed
   * in Feb 2026). SoundCloud: the user's top tracks.
   */
  topTracks: Track[]
  /** Albums, EPs and singles, newest first. */
  releases: Album[]
  /** SoundCloud only: the user's own playlists that aren't albums. */
  playlists: Playlist[]
  /** SoundCloud only: total uploads (for "All tracks" and Download all). */
  trackCount?: number
}

export interface AlbumPage {
  album: Album
  tracks: Track[]
  /** Spotify copyright lines (C and P), shown under the track list. */
  copyrights: string[]
}

/** Can this track be played through the app? DRM-only tracks play through Widevine. */
export function isPlayable(track: Track): boolean {
  return track.availability !== 'preview' && track.availability !== 'blocked'
}

/**
 * Where a playlist lives. `app` playlists exist only in this app and may mix
 * all three providers; service playlists are edited within their own service.
 */
export type PlaylistSource = 'spotify' | 'soundcloud' | 'app'

export interface Playlist {
  /** `${source}:${nativeId}` */
  id: string
  source: PlaylistSource
  nativeId: string
  name: string
  description?: string
  artworkUrl?: string
  ownerName?: string
  trackCount?: number
  /** False for followed playlists owned by someone else. */
  canEdit: boolean
  /** App playlists: the cover was picked by the user (playlists:chooseCover). */
  customArtwork?: boolean
}

export interface LikedTrack {
  track: Track
  /** ISO 8601 timestamp from the service. */
  likedAt: string
}

export function trackId(provider: Provider, nativeId: string): string {
  return `${provider}:${nativeId}`
}
