// SoundCloud-specific contracts (Phase 3). Owned by the main agent.
// Reference: docs/research/soundcloud-api.md

import type { Album, Artist, Track } from './types'

/** A SoundCloud track's own page: what soundcloud.com shows around the player. */
export interface ScTrackPage {
  track: Track
  /** The uploader's free-text description (may be long, keeps line breaks). */
  description?: string
  /** ISO 8601 upload time. */
  createdAt?: string
  genre?: string
  tags: string[]
  plays?: number
  likes?: number
  reposts?: number
  /** All comments, replies included. */
  commentCount?: number
  uploader: Artist & { trackCount?: number }
}

/** Electron session partition holding the soundcloud.com login (cookies). */
export const SOUNDCLOUD_PARTITION = 'persist:soundcloud'

export type SoundCloudAdapter = 'web' | 'official'

export type SoundCloudStatus =
  | { state: 'disconnected' }
  /** The saved web login stopped working (token refresh failed): log in again. */
  | { state: 'expired' }
  | { state: 'connected'; username: string; userId: string; adapter: SoundCloudAdapter }

/**
 * Why a SoundCloud track can't be played in full here. Shown as a label in lists;
 * the queue skips these tracks.
 */
export const UNPLAYABLE_REASON = {
  preview: 'Preview only',
  blocked: 'Not available',
  drm: "Can't play here (protected)"
} as const

/** One entry in the SoundCloud feed (stream) or a profile's reposts. */
export interface FeedItem {
  /** Unique per entry (the same track can appear as a post and a repost). */
  id: string
  kind: 'track' | 'playlist'
  /** 'post' = uploaded by the person you follow; 'repost' = they reposted it. */
  type: 'post' | 'repost'
  /** ISO 8601 time of the post or repost. */
  createdAt: string
  /** Who posted or reposted it. */
  by: { id: string; name: string; avatarUrl?: string }
  /** Set for tracks. */
  track?: Track
  /** Set for playlists and albums (open with music:getAlbum). */
  set?: Album
}

export interface FeedPage {
  items: FeedItem[]
  /** Opaque cursor for the next page; absent at the end. */
  next?: string
}
