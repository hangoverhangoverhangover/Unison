import type { Track } from '@shared/types'

/**
 * How a track list should be drawn: source dots only when it mixes services, and the
 * Album column only when some track has an album.
 */
export function listShape(tracks: Track[]): { mixed: boolean; hasAlbums: boolean } {
  const providers = new Set(tracks.map((t) => t.provider))
  return { mixed: providers.size > 1, hasAlbums: tracks.some((t) => !!t.album) }
}
