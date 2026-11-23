import { useCallback, useEffect, useRef, useState } from 'react'
import type { ServiceProvider } from '@shared/ipc'
import type { Album, Artist, Track } from '@shared/types'
import { interleave, searchLocal } from '@renderer/lib/searchMerge'
import { useLibrary } from './library'
import { useDiscography } from './discography'
import { ipcMessage, useSpotify } from './services'

export type SearchSource = 'spotify' | 'soundcloud' | 'discography' | 'local'
export const SEARCH_SOURCES: SearchSource[] = ['spotify', 'soundcloud', 'discography', 'local']

/** Services searched for songs (local files are searched in the renderer). */
type SongService = ServiceProvider | 'discography'
const SONG_SERVICES: SongService[] = ['spotify', 'soundcloud', 'discography']

/** Songs per request: Spotify caps at 10; SoundCloud pages by 20 here; Discography by 30. */
const PAGE_SIZE: Record<SongService, number> = { spotify: 10, soundcloud: 20, discography: 30 }

const searchSongs = (p: SongService, q: string, page: number): Promise<Track[]> =>
  p === 'discography'
    ? window.api.invoke('discography:search', q, page)
    : window.api.invoke('music:search', p, q, page)

const NO_PAGES = (): Pages => ({
  spotify: [],
  soundcloud: [],
  discography: [],
  page: 0,
  more: { spotify: false, soundcloud: false, discography: false }
})
const LOCAL_LIMIT = 50
const DEBOUNCE_MS = 250

export interface SearchResults {
  /** The query these results answer ('' before the first search). */
  query: string
  tracks: Track[]
  artists: Artist[]
  sets: Album[]
  loading: boolean
  /** Per-source failure messages. */
  errors: Partial<Record<SearchSource, string>>
  /** More songs can be loaded from a service. */
  hasMore: boolean
  loadMore: () => void
}

interface Pages {
  spotify: Track[]
  soundcloud: Track[]
  discography: Track[]
  page: number
  more: Record<SongService, boolean>
}

/**
 * Search Spotify, SoundCloud, Discography and local files at once, as you type (debounced).
 * Songs from each source are interleaved, best of each first. Spotify is skipped
 * when it isn't connected. A late answer to an older query is ignored.
 */
export function useSearch(query: string, sources: ReadonlySet<SearchSource>): SearchResults {
  const spotifyConnected = useSpotify((s) => s.status?.state === 'connected')
  const discographyConnected = useDiscography((s) => s.status?.state === 'connected')
  const library = useLibrary((s) => s.tracks)
  const [state, setState] = useState<{
    query: string
    pages: Pages
    artists: Artist[]
    sets: Album[]
    loading: boolean
    errors: Partial<Record<SearchSource, string>>
  }>({
    query: '',
    pages: NO_PAGES(),
    artists: [],
    sets: [],
    loading: false,
    errors: {}
  })
  const reqId = useRef(0)
  const q = query.trim()
  const services = SONG_SERVICES.filter(
    (p) =>
      sources.has(p) &&
      (p !== 'spotify' || spotifyConnected) &&
      (p !== 'discography' || discographyConnected)
  )
  const servicesKey = services.join(',')

  useEffect(() => {
    const id = ++reqId.current
    if (!q) return
    const providers = servicesKey ? (servicesKey.split(',') as SongService[]) : []
    // Artist profiles come from Spotify and SoundCloud only.
    const artistServices = providers.filter((p): p is ServiceProvider => p !== 'discography')
    const t = setTimeout(() => {
      setState((s) => ({ ...s, loading: true }))
      const songs = Promise.allSettled(providers.map((p) => searchSongs(p, q, 0)))
      const artists = Promise.allSettled(
        artistServices.map((p) => window.api.invoke('music:searchArtists', p, q))
      )
      const sets = providers.includes('soundcloud')
        ? window.api.invoke('soundcloud:searchSets', q).catch(() => [] as Album[])
        : Promise.resolve([] as Album[])
      void Promise.all([songs, artists, sets]).then(([songR, artistR, setList]) => {
        if (id !== reqId.current) return
        const errors: Partial<Record<SearchSource, string>> = {}
        const pages = NO_PAGES()
        providers.forEach((p, i) => {
          const r = songR[i]!
          if (r.status === 'fulfilled') {
            pages[p] = r.value
            pages.more[p] = r.value.length === PAGE_SIZE[p]
          } else errors[p] = ipcMessage(r.reason)
        })
        setState({
          query: q,
          pages,
          artists: interleave(
            artistR.map((r) => (r.status === 'fulfilled' ? r.value : ([] as Artist[])))
          ),
          sets: setList,
          loading: false,
          errors
        })
      })
    }, DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [q, servicesKey])

  const loadMore = useCallback(() => {
    const { pages, query: answered } = state
    if (!answered) return
    const id = reqId.current
    const next = pages.page + 1
    const providers = SONG_SERVICES.filter((p) => pages.more[p])
    setState((s) => ({ ...s, loading: true }))
    void Promise.allSettled(providers.map((p) => searchSongs(p, answered, next))).then(
      (settled) => {
        if (id !== reqId.current) {
          // A newer search owns the results now; just stop showing "Loading…".
          setState((s) => ({ ...s, loading: false }))
          return
        }
        setState((s) => {
          const p2: Pages = { ...s.pages, page: next, more: { ...s.pages.more } }
          providers.forEach((p, i) => {
            const r = settled[i]!
            const got = r.status === 'fulfilled' ? r.value : []
            p2[p] = [...p2[p], ...got]
            p2.more[p] = got.length === PAGE_SIZE[p]
          })
          return { ...s, pages: p2, loading: false }
        })
      }
    )
  }, [state])

  const fresh = state.query === q && q !== ''
  const local = sources.has('local') && q ? searchLocal(library, q, LOCAL_LIMIT) : []
  const pages = fresh ? state.pages : null
  return {
    query: fresh ? q : '',
    tracks: interleave([
      sources.has('spotify') ? (pages?.spotify ?? []) : [],
      sources.has('soundcloud') ? (pages?.soundcloud ?? []) : [],
      sources.has('discography') ? (pages?.discography ?? []) : [],
      fresh || !servicesKey ? local : []
    ]),
    artists: fresh ? state.artists.filter((a) => sources.has(a.provider as SearchSource)) : [],
    sets: fresh && sources.has('soundcloud') ? state.sets : [],
    loading: q !== '' && (!fresh || state.loading) && servicesKey !== '',
    errors: fresh ? state.errors : {},
    hasMore: !!pages && SONG_SERVICES.some((p) => pages.more[p]),
    loadMore
  }
}
