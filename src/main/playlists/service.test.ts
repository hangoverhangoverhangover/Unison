import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServiceProvider } from '@shared/ipc'
import type { PlaylistPrefs } from '@shared/library'
import type { Playlist, Track } from '@shared/types'
import { openDb, type Db } from '../db'
import { validatePrefs } from './prefs'
import {
  COVER_APP_ONLY_MESSAGE,
  createPlaylistService,
  crossServiceMessage,
  EDIT_CHECK_TTL_MS,
  REORDER_MESSAGE,
  type EditableProvider,
  type PlaylistService
} from './service'
import { AppPlaylistStore } from './store'

function svc(provider: 'spotify' | 'soundcloud', id: string): Track {
  return {
    id: `${provider}:${id}`,
    provider,
    nativeId: id,
    title: `Song ${id}`,
    artists: [],
    durationMs: 1
  }
}

function playlist(source: ServiceProvider, id: string, canEdit: boolean): Playlist {
  return { id: `${source}:${id}`, source, nativeId: id, name: id, canEdit }
}

function fakeProvider(
  playlists: Playlist[],
  editor = true
): EditableProvider & {
  addToPlaylist: ReturnType<typeof vi.fn>
  removeFromPlaylist: ReturnType<typeof vi.fn>
  getPlaylists: ReturnType<typeof vi.fn>
} {
  const p = {
    search: vi.fn(),
    getLikes: vi.fn(),
    like: vi.fn(),
    unlike: vi.fn(),
    getPlaylists: vi.fn(async () => playlists),
    getPlaylistTracks: vi.fn(),
    addToPlaylist: vi.fn(async () => {}),
    removeFromPlaylist: vi.fn(async () => {})
  }
  if (!editor) {
    delete (p as Partial<typeof p>).addToPlaylist
    delete (p as Partial<typeof p>).removeFromPlaylist
  }
  return p
}

let db: Db
let store: AppPlaylistStore
let events: (string | null)[]
let providers: Partial<Record<ServiceProvider, EditableProvider>>
let serviceTracks: Track[]
let now: number
let service: PlaylistService

beforeEach(() => {
  db = openDb(':memory:')
  store = new AppPlaylistStore(db)
  events = []
  now = 1_000
  serviceTracks = []
  providers = {
    spotify: fakeProvider([
      playlist('spotify', 'mine', true),
      playlist('spotify', 'theirs', false)
    ]),
    soundcloud: fakeProvider([playlist('soundcloud', '5', true)])
  }
  service = createPlaylistService({
    store,
    getProvider: (s) => providers[s],
    getServicePlaylistTracks: async () => serviceTracks,
    notify: (id) => events.push(id),
    now: () => now
  })
})
afterEach(() => db.close())

describe('playlist service: app playlists', () => {
  it('emits list events for create, rename and delete', () => {
    const p = service.create('Mix')
    service.rename(p.id, 'Mix 2')
    expect(service.getApp().map((x) => x.name)).toEqual(['Mix 2'])
    service.delete(p.id)
    expect(events).toEqual([null, null, null])
  })

  it('takes tracks from any provider and emits item + list events', async () => {
    const p = service.create('Mix')
    events.length = 0
    await service.addTracks(p.id, [
      svc('spotify', 'a'),
      svc('soundcloud', '1'),
      svc('spotify', 'b')
    ])
    expect(events).toEqual([p.id, null])
    await service.removeAt(p.id, [0])
    service.move(p.id, 0, 1)
    service.move(p.id, 1, 1) // no-op: no event
    expect(store.getTracks(p.id).map((t) => t.id)).toEqual(['spotify:b', 'soundcloud:1'])
    expect(events).toEqual([p.id, null, p.id, null, p.id, null])
  })

  it('rejects when every local track was skipped', async () => {
    const p = service.create('Mix')
    const ghost: Track = { ...svc('spotify', 'x'), id: 'local:x', provider: 'local' }
    await expect(service.addTracks(p.id, [ghost])).rejects.toThrow(/isn't in your library/)
  })

  it('rejects bad ids', async () => {
    expect(() => service.rename('spotify:mine', 'x')).toThrow(/Invalid playlist id/)
    await expect(service.addTracks('nope', [])).rejects.toThrow(/Invalid playlist id/)
    expect(() => service.move('weird:1', 0, 1)).toThrow(/Invalid playlist id/)
  })
})

describe('playlist service: service playlists', () => {
  it('adds through the provider editor and emits the playlist id', async () => {
    const tracks = [svc('spotify', 'a'), svc('spotify', 'b')]
    await service.addTracks('spotify:mine', tracks)
    expect(providers.spotify!.addToPlaylist).toHaveBeenCalledWith('spotify:mine', tracks)
    expect(events).toEqual(['spotify:mine'])
  })

  it('rejects tracks from another service', async () => {
    await expect(
      service.addTracks('spotify:mine', [svc('spotify', 'a'), svc('soundcloud', '1')])
    ).rejects.toThrow(crossServiceMessage('spotify'))
    await expect(service.addTracks('soundcloud:5', [svc('spotify', 'a')])).rejects.toThrow(
      'Only SoundCloud tracks can be added to a SoundCloud playlist.'
    )
    const local: Track = { ...svc('spotify', 'x'), id: 'local:x', provider: 'local' }
    await expect(service.addTracks('spotify:mine', [local])).rejects.toThrow(
      'Only Spotify tracks can be added to a Spotify playlist.'
    )
    expect(providers.spotify!.addToPlaylist).not.toHaveBeenCalled()
  })

  it("rejects playlists the user can't edit, unknown playlists and non-editors", async () => {
    await expect(service.addTracks('spotify:theirs', [svc('spotify', 'a')])).rejects.toThrow(
      /only edit Spotify playlists you own/
    )
    await expect(service.addTracks('spotify:gone', [svc('spotify', 'a')])).rejects.toThrow(
      /isn't in your library/
    )
    providers.soundcloud = fakeProvider([playlist('soundcloud', '5', true)], false)
    await expect(service.addTracks('soundcloud:5', [svc('soundcloud', '1')])).rejects.toThrow(
      "SoundCloud playlists can't be edited from this app."
    )
    delete providers.spotify
    await expect(service.addTracks('spotify:mine', [svc('spotify', 'a')])).rejects.toThrow(
      /isn't connected/
    )
    expect(events).toEqual([])
  })

  it('reuses the playlist list for the edit check, and refetches after the TTL', async () => {
    const sp = providers.spotify as ReturnType<typeof fakeProvider>
    await service.addTracks('spotify:mine', [svc('spotify', 'a')])
    await service.addTracks('spotify:mine', [svc('spotify', 'a')])
    expect(sp.getPlaylists).toHaveBeenCalledTimes(1)
    now += EDIT_CHECK_TTL_MS
    await service.addTracks('spotify:mine', [svc('spotify', 'a')])
    expect(sp.getPlaylists).toHaveBeenCalledTimes(2)
  })

  it('maps removeAt positions to tracks (deduped) and removes them', async () => {
    serviceTracks = [svc('spotify', 'a'), svc('spotify', 'b'), svc('spotify', 'a')]
    await service.removeAt('spotify:mine', [2, 0, 1])
    const call = providers.spotify!.removeFromPlaylist as ReturnType<typeof vi.fn>
    expect(call).toHaveBeenCalledWith('spotify:mine', [serviceTracks[2], serviceTracks[1]])
    expect(events).toEqual(['spotify:mine'])
  })

  it('rejects out-of-range removeAt positions without touching the service', async () => {
    serviceTracks = [svc('soundcloud', '1')]
    await expect(service.removeAt('soundcloud:5', [1])).rejects.toThrow(/out of range/)
    expect(providers.soundcloud!.removeFromPlaylist).not.toHaveBeenCalled()
  })

  it('refuses to reorder service playlists', () => {
    expect(() => service.move('spotify:mine', 0, 1)).toThrow(REORDER_MESSAGE)
    expect(() => service.move('soundcloud:5', 0, 1)).toThrow(REORDER_MESSAGE)
  })
})

describe('playlist service: covers and prefs', () => {
  const HASH = '0123456789abcdef0123456789abcdef01234567'
  let pick: ReturnType<typeof vi.fn<() => Promise<string | null>>>
  let importCover: ReturnType<typeof vi.fn<(path: string) => Promise<string>>>
  let prefsData: PlaylistPrefs

  beforeEach(() => {
    pick = vi.fn(async () => 'C:/pics/cover.png')
    importCover = vi.fn(async () => HASH)
    prefsData = { order: [], hidden: [] }
    service = createPlaylistService({
      store,
      getProvider: (s) => providers[s],
      getServicePlaylistTracks: async () => serviceTracks,
      notify: (id) => events.push(id),
      covers: { pick, importCover },
      prefs: {
        read: () => prefsData,
        write: (p) => (prefsData = validatePrefs(p)),
        forget: (id) =>
          void (prefsData = {
            order: prefsData.order.filter((x) => x !== id),
            hidden: prefsData.hidden.filter((x) => x !== id)
          })
      }
    })
  })

  it('chooseCover stores the picked image and emits list + playlist events', async () => {
    const p = service.create('Mix', [svc('spotify', 'a')])
    events.length = 0
    const out = await service.chooseCover(p.id)
    expect(importCover).toHaveBeenCalledWith('C:/pics/cover.png')
    expect(out).toMatchObject({ id: p.id, artworkUrl: `media://art/${HASH}`, customArtwork: true })
    expect(service.getApp()[0]).toMatchObject({ customArtwork: true })
    expect(events).toEqual([p.id, null])
  })

  it('chooseCover returns null when the dialog is cancelled', async () => {
    const p = service.create('Mix')
    events.length = 0
    pick.mockResolvedValueOnce(null)
    await expect(service.chooseCover(p.id)).resolves.toBeNull()
    expect(importCover).not.toHaveBeenCalled()
    expect(events).toEqual([])
  })

  it('chooseCover passes import errors through and changes nothing', async () => {
    const p = service.create('Mix')
    importCover.mockRejectedValueOnce(new Error('That image is over 10 MB. Pick a smaller one.'))
    await expect(service.chooseCover(p.id)).rejects.toThrow(/over 10 MB/)
    expect(store.get(p.id).customArtwork).toBeUndefined()
  })

  it('covers are for app playlists only, checked before the dialog opens', async () => {
    await expect(service.chooseCover('spotify:mine')).rejects.toThrow(COVER_APP_ONLY_MESSAGE)
    await expect(service.chooseCover('nope')).rejects.toThrow(/Invalid playlist id/)
    await expect(service.chooseCover('app:missing')).rejects.toThrow(/doesn't exist/)
    expect(() => service.clearCover('soundcloud:5')).toThrow(COVER_APP_ONLY_MESSAGE)
    expect(pick).not.toHaveBeenCalled()
  })

  it('clearCover restores the automatic cover and emits events', async () => {
    const p = service.create('Mix', [{ ...svc('spotify', 'a'), artworkUrl: 'art-a' }])
    await service.chooseCover(p.id)
    events.length = 0
    const out = service.clearCover(p.id)
    expect(out.artworkUrl).toBe('art-a')
    expect(out.customArtwork).toBeUndefined()
    expect(events).toEqual([p.id, null])
  })

  it('get/set prefs and drops a deleted playlist from both lists', () => {
    const p = service.create('Mix')
    expect(service.getPrefs()).toEqual({ order: [], hidden: [] })
    expect(service.setPrefs({ order: [p.id, 'spotify:mine', p.id], hidden: [p.id] })).toEqual({
      order: [p.id, 'spotify:mine'],
      hidden: [p.id]
    })
    expect(() => service.setPrefs({ order: ['bad'], hidden: [] })).toThrow(
      /Not a valid playlist id/
    )
    service.delete(p.id)
    expect(service.getPrefs()).toEqual({ order: ['spotify:mine'], hidden: [] })
  })
})

describe('playlist service: real prefs store', () => {
  it('delete cleans the settings row', async () => {
    const { forgetPlaylist, readPrefs, writePrefs } = await import('./prefs')
    const s = createPlaylistService({
      store,
      getProvider: () => undefined,
      getServicePlaylistTracks: async () => [],
      notify: () => {},
      prefs: {
        read: () => readPrefs(db),
        write: (p) => writePrefs(db, p),
        forget: (id) => forgetPlaylist(db, id)
      }
    })
    const a = s.create('A')
    const b = s.create('B')
    s.setPrefs({ order: [a.id, b.id], hidden: [a.id] })
    s.delete(a.id)
    expect(readPrefs(db)).toEqual({ order: [b.id], hidden: [] })
  })
})
