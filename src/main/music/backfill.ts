// Fills artist/album links (Track.artistRefs, albumRef, url) on service tracks the app
// saved before those links existed (migration 7). App playlists read tracks straight
// from the db, so without this their artist and album names stay unclickable.
import type { TrackLookup } from '@shared/provider'
import type { Track } from '@shared/types'
import type { Db } from '../db'
import { upsertServiceTracks } from '../db/tracks'

type Service = 'spotify' | 'soundcloud'

export interface LinkBackfillOptions {
  db: Db
  /** The provider for a service, when it supports lookups (and is connected). */
  getLookup(service: Service): TrackLookup | undefined
  log?(message: string, err?: unknown): void
}

export interface LinkBackfill {
  /**
   * Look up the tracks in this list that lack links and save the fresh copies.
   * Resolves true when any row changed (callers then refetch). Each track is tried
   * once per session, so a removed track isn't fetched again and again.
   */
  fill(tracks: readonly Track[]): Promise<boolean>
}

/** Narrow a provider to TrackLookup when it implements one. */
export function asLookup(p: unknown): TrackLookup | undefined {
  return p && typeof (p as Partial<TrackLookup>).getTracks === 'function'
    ? (p as TrackLookup)
    : undefined
}

export function needsLinks(t: Track): t is Track & { provider: Service } {
  return (t.provider === 'spotify' || t.provider === 'soundcloud') && !t.artistRefs?.length
}

export function createLinkBackfill(opts: LinkBackfillOptions): LinkBackfill {
  const tried = new Set<string>()
  const log = opts.log ?? ((): void => undefined)
  return {
    async fill(tracks) {
      const byService: Record<Service, string[]> = { spotify: [], soundcloud: [] }
      for (const t of tracks) {
        if (!needsLinks(t) || tried.has(t.id)) continue
        tried.add(t.id)
        byService[t.provider].push(t.nativeId)
      }
      let changed = false
      for (const service of ['spotify', 'soundcloud'] as const) {
        const ids = byService[service]
        if (ids.length === 0) continue
        const lookup = opts.getLookup(service)
        if (!lookup) {
          // Not connected yet: allow another try later.
          for (const id of ids) tried.delete(`${service}:${id}`)
          continue
        }
        try {
          const fresh = (await lookup.getTracks(ids)).filter((t) => t.artistRefs?.length)
          if (fresh.length > 0) {
            upsertServiceTracks(opts.db, fresh)
            changed = true
          }
          log(`[music] filled links for ${fresh.length} of ${ids.length} ${service} track(s)`)
        } catch (err) {
          for (const id of ids) tried.delete(`${service}:${id}`)
          log(`[music] link backfill for ${service} failed`, err)
        }
      }
      return changed
    }
  }
}
