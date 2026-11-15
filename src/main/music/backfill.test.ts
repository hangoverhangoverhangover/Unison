import { describe, expect, it, vi } from 'vitest'
import type { Track } from '@shared/types'
import { openDb } from '../db'
import { rowToTrack, trackColumns, upsertServiceTracks, type TrackRow } from '../db/tracks'
import { createLinkBackfill } from './backfill'

const bare = (provider: 'spotify' | 'soundcloud', id: string): Track => ({
  id: `${provider}:${id}`,
  provider,
  nativeId: id,
  title: `T${id}`,
  artists: ['A'],
  durationMs: 1
})
const linked = (t: Track): Track => ({
  ...t,
  artistRefs: [{ id: `${t.provider}:artist`, name: 'A' }],
  url: `https://example.com/${t.nativeId}`
})

describe('link backfill', () => {
  it('looks up only unlinked service tracks, once, and saves the links', async () => {
    const db = openDb(':memory:')
    const sp = bare('spotify', '1')
    const sc = bare('soundcloud', '2')
    upsertServiceTracks(db, [sp, sc])
    const spotify = {
      getTracks: vi.fn(async (ids: string[]) => ids.map((id) => linked(bare('spotify', id))))
    }
    const soundcloud = {
      getTracks: vi.fn(async (ids: string[]) => ids.map((id) => linked(bare('soundcloud', id))))
    }
    const fill = createLinkBackfill({
      db,
      getLookup: (s) => (s === 'spotify' ? spotify : soundcloud)
    })
    const local: Track = { ...bare('spotify', 'x'), id: 'local:x', provider: 'local' }
    expect(await fill.fill([sp, sc, linked(bare('spotify', '3')), local])).toBe(true)
    expect(spotify.getTracks).toHaveBeenCalledWith(['1'])
    expect(soundcloud.getTracks).toHaveBeenCalledWith(['2'])
    const row = db
      .prepare(`SELECT ${trackColumns()} FROM tracks WHERE id = ?`)
      .get('spotify:1') as TrackRow
    expect(rowToTrack(row).artistRefs?.[0]?.id).toBe('spotify:artist')
    expect(await fill.fill([sp, sc])).toBe(false)
    expect(spotify.getTracks).toHaveBeenCalledTimes(1)
  })

  it('retries later when the service is offline or the lookup fails', async () => {
    const db = openDb(':memory:')
    const sp = bare('spotify', '1')
    let lookup: { getTracks: (ids: string[]) => Promise<Track[]> } | undefined
    const fill = createLinkBackfill({ db, getLookup: () => lookup })
    expect(await fill.fill([sp])).toBe(false)
    lookup = {
      getTracks: async () => {
        throw new Error('429')
      }
    }
    expect(await fill.fill([sp])).toBe(false)
    lookup = { getTracks: async (ids) => ids.map((id) => linked(bare('spotify', id))) }
    expect(await fill.fill([sp])).toBe(true)
  })
})
