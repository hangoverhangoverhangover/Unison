import { create } from 'zustand'
import type { AlbumPage, ArtistPage, Track } from '@shared/types'
import { ipcMessage, type Load } from './services'

interface CatalogState {
  artists: Record<string, Load<ArtistPage>>
  albums: Record<string, Load<AlbumPage>>
  /** Every track by an artist (All tracks / Download all), loaded on demand. */
  artistTracks: Record<string, Load<Track[]>>
  loadArtist: (id: string) => Promise<void>
  loadAlbum: (id: string) => Promise<void>
  /** Resolves with the tracks, or undefined on failure (the error is stored). */
  loadArtistTracks: (id: string) => Promise<Track[] | undefined>
}

/** Pages are cached for the session; a failed load is retried on the next visit. */
export const useCatalog = create<CatalogState>((set, get) => {
  function loader<T>(
    key: 'artists' | 'albums' | 'artistTracks',
    fetch: (id: string) => Promise<T>
  ): (id: string) => Promise<T | undefined> {
    return async (id) => {
      const cur = (get()[key] as Record<string, Load<T>>)[id]
      if (cur?.state === 'ok') return cur.data
      if (cur?.state === 'loading') return undefined
      const put = (v: Load<T>): void => set((s) => ({ [key]: { ...s[key], [id]: v } }) as never)
      put({ state: 'loading' })
      try {
        const data = await fetch(id)
        put({ state: 'ok', data })
        return data
      } catch (err) {
        put({ state: 'error', error: ipcMessage(err) })
        return undefined
      }
    }
  }
  const artist = loader('artists', (id) => window.api.invoke('music:getArtist', id))
  const album = loader('albums', (id) => window.api.invoke('music:getAlbum', id))
  const tracks = loader('artistTracks', (id) => window.api.invoke('music:getArtistTracks', id))
  return {
    artists: {},
    albums: {},
    artistTracks: {},
    loadArtist: async (id) => void (await artist(id)),
    loadAlbum: async (id) => void (await album(id)),
    loadArtistTracks: tracks
  }
})
