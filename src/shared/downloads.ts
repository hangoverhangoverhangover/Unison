// Downloader contracts (Phase 7). Owned by the main agent.
import type { Track } from './types'

export type DownloadStatus = 'queued' | 'running' | 'done' | 'failed'
/** 'official': the artist-enabled original file. 'ytdlp': the stream, via yt-dlp. */
export type DownloadMethod = 'official' | 'ytdlp'

/** One row of the downloads table, joined with the SoundCloud track it came from. */
export interface DownloadItem {
  id: number
  /** SoundCloud native id of the original. */
  scTrackId: string
  /** The SoundCloud track (title, artist, artwork) as it was when queued. */
  track: Track
  status: DownloadStatus
  /** Set once the method is known (running or later). */
  method?: DownloadMethod
  /** 0..1. For yt-dlp HLS downloads this is an estimate. */
  progress: number
  /** The saved file, once done. */
  filePath?: string
  /** The local library track created for the file, once done. */
  localTrackId?: string
  /** Readable reason, when failed. */
  error?: string
  /** ISO 8601. */
  createdAt: string
  finishedAt?: string
}

/** Live progress for a running download (sent often; the full list only on status changes). */
export interface DownloadProgress {
  id: number
  progress: number
}

export type ToolState = 'missing' | 'copying' | 'ready' | 'updating' | 'error'

export interface DownloaderStatus {
  /** yt-dlp and ffmpeg in userData/bin. */
  tools: ToolState
  /** yt-dlp --version, when known. */
  ytdlpVersion?: string
  /** Where downloads are saved. */
  folder: string
  /** Why tools are in 'error' (copy failed, update failed). */
  error?: string
}

/** Downloads that run at the same time. */
export const MAX_CONCURRENT_DOWNLOADS = 2
