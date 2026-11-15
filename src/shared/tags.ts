// Local file tag editor (QoL round 2). Owned by the main agent.

/** Fields the editor writes. Omitted = unchanged; empty string = clear. */
export interface TagEdit {
  title?: string
  artist?: string
  album?: string
  albumArtist?: string
  trackNo?: number | null
  year?: string
  genre?: string
  /**
   * Cover art: a token from `tags:pickCover` sets the picked image as the embedded
   * cover; null removes the embedded cover. Omitted = unchanged.
   */
  cover?: string | null
}

/** An image picked for cover art (main keeps the path; the renderer gets a token). */
export interface PickedCover {
  token: string
  /** data: URL preview, at most ~300 KB. */
  previewUrl: string
  /** File name, for display. */
  name: string
}

/** File extensions whose cover art the editor can write. */
export const COVER_FORMATS = ['.mp3', '.m4a', '.mp4', '.flac'] as const

export interface TagFileResult {
  /** Local track id (`local:<nativeId>`). */
  trackId: string
  ok: boolean
  error?: string
}

/** One proposed change from "fill from file name". */
export interface FilenameTagProposal {
  trackId: string
  /** The file name without extension. */
  fileName: string
  artist?: string
  title?: string
  /** Why nothing was proposed ("no ' - ' in the name"). */
  skipped?: string
}
