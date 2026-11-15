import type { Album, AlbumPage, Artist, ArtistPage, LikedTrack, Playlist, Track } from './types'

/**
 * Spotify and both SoundCloud implementations sit behind this interface.
 * The rest of the app never knows which one it's talking to.
 */
export interface MusicProvider {
  search(query: string, page: number): Promise<Track[]>
  getLikes(): Promise<LikedTrack[]>
  like(track: Track): Promise<void>
  unlike(track: Track): Promise<void>
  getPlaylists(): Promise<Playlist[]>
  getPlaylistTracks(id: string): Promise<Track[]>
}

/** Artist and album pages (Spotify and SoundCloud). Ids are native ids. */
export interface CatalogProvider {
  getArtist(nativeId: string): Promise<ArtistPage>
  getAlbum(nativeId: string): Promise<AlbumPage>
  /**
   * Every track the artist has (SoundCloud: all uploads, paged to the end;
   * Spotify: every track on every release, deduped). Used by "All tracks" and
   * "Download all", so it may be large.
   */
  getArtistTracks(nativeId: string): Promise<Track[]>
  /** Artists (Spotify) or user profiles (SoundCloud) matching a search, best first, max 10. */
  searchArtists(query: string): Promise<Artist[]>
}

/**
 * Optional: create a playlist you own on the service with these tracks (all from this
 * service), in order. Used by "copy a playlist to the other service".
 */
export interface PlaylistCreator {
  createPlaylist(name: string, tracks: Track[]): Promise<Playlist>
}

/** Optional: fresh track metadata by native id (missing or removed tracks are left out). */
export interface TrackLookup {
  getTracks(nativeIds: string[]): Promise<Track[]>
}

/** Optional: bulk like check, keyed by native id. */
export interface LikeChecker {
  isLiked(nativeIds: string[]): Promise<Record<string, boolean>>
}

/**
 * Optional: edit a playlist on the service. `playlistId` is the full app id
 * (`spotify:<id>` / `soundcloud:<id>`); every track belongs to that same service.
 * Only playlists with `canEdit` are passed in.
 */
export interface PlaylistEditor {
  addToPlaylist(playlistId: string, tracks: Track[]): Promise<void>
  /** Removes every occurrence of these tracks from the playlist. */
  removeFromPlaylist(playlistId: string, tracks: Track[]): Promise<void>
}

export interface CommentAuthor {
  id: string
  username: string
  avatarUrl?: string
}

export interface TrackComment {
  id: string
  body: string
  /** Position in the track the comment is pinned to. */
  timestampMs: number
  /** ISO 8601. */
  createdAt: string
  author: CommentAuthor
  /** Replies to this comment, oldest first (top-level comments only). */
  replies?: TrackComment[]
}

export interface StreamInfo {
  url: string
  protocol: 'hls' | 'progressive'
  mimeType: string
  /** Epoch ms after which the URL must be re-fetched, when known. */
  expiresAt?: number
  /** True when the service only serves a short preview of the track. */
  preview: boolean
  /** Set for encrypted streams: play through EME with this key system and license server. */
  drm?: StreamDrm
}

export interface StreamDrm {
  keySystem: 'com.widevine.alpha'
  /** License server URL, already carrying any per-stream token. */
  licenseUrl: string
}

/** Thrown by getStreamUrl when the track can't be streamed in full. */
export class UnplayableTrackError extends Error {
  constructor(
    public readonly availability: 'preview' | 'blocked' | 'drm',
    message: string
  ) {
    super(message)
    this.name = 'UnplayableTrackError'
  }
}

export interface OfficialDownload {
  url: string
  filename?: string
}

/** Extra capabilities both SoundCloud adapters (official and web session) provide. */
export interface SoundCloudProvider extends MusicProvider {
  getComments(trackNativeId: string): Promise<TrackComment[]>
  /** Comments cannot be deleted through the API; callers must confirm first. */
  postComment(trackNativeId: string, body: string, timestampMs: number): Promise<TrackComment>
  /** Peak samples normalized to 0..1. */
  getWaveform(trackNativeId: string): Promise<number[]>
  getStreamUrl(trackNativeId: string): Promise<StreamInfo>
  /** Artist-enabled download, or null when the artist hasn't enabled one. */
  getOfficialDownload(trackNativeId: string): Promise<OfficialDownload | null>
  /**
   * Public sets matching a search: playlists and albums (`type` tells them apart),
   * best first, max 10. Works logged out. Open them with music:getAlbum.
   */
  searchSets(query: string): Promise<Album[]>
}
