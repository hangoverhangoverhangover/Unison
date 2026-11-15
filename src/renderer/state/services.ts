import { create, type StoreApi, type UseBoundStore } from 'zustand'
import type { ServiceProvider } from '@shared/ipc'
import type { SoundCloudStatus } from '@shared/soundcloud'
import type { SpotifyStatus } from '@shared/spotify'
import type { LikedTrack, Playlist, Track } from '@shared/types'
import { warmUpSpotify } from '@renderer/playback/controller'

export type Load<T> =
  { state: 'idle' | 'loading' } | { state: 'ok'; data: T } | { state: 'error'; error: string }

/** Electron prefixes IPC errors with "Error invoking remote method '...': Error: ". */
export function ipcMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '')
}

/** Per-service library state: status, likes, playlists. One store per streaming service. */
export interface ServiceState<S extends { state: string }> {
  provider: ServiceProvider
  status: S | null
  likes: Load<LikedTrack[]>
  /** Liked state by track id (`provider:nativeId`), from likes + isLiked checks. */
  liked: Record<string, boolean>
  playlists: Load<Playlist[]>
  playlistTracks: Record<string, Load<Track[]>>
  /** Store a status; on a fresh connect, load playlists, then likes. */
  applyStatus: (status: S) => void
  login: () => Promise<void>
  logout: () => Promise<void>
  loadLikes: () => Promise<void>
  loadPlaylists: () => Promise<void>
  loadPlaylist: (id: string) => Promise<void>
  checkLiked: (trackIds: string[]) => Promise<void>
  /** Optimistic; rolls back and rethrows on failure. */
  setLiked: (track: Track, liked: boolean) => Promise<void>
}

export type ServiceStore<S extends { state: string }> = UseBoundStore<StoreApi<ServiceState<S>>>

interface ServiceConfig<S> {
  provider: ServiceProvider
  login: () => Promise<S>
  logout: () => Promise<S>
  onConnected?: () => void
}

function createServiceStore<S extends { state: string }>(cfg: ServiceConfig<S>): ServiceStore<S> {
  const { provider } = cfg
  return create<ServiceState<S>>((set, get) => ({
    provider,
    status: null,
    likes: { state: 'idle' },
    liked: {},
    playlists: { state: 'idle' },
    playlistTracks: {},

    applyStatus: (status) => {
      const was = get().status
      set({ status })
      if (status.state === 'connected' && was?.state !== 'connected') {
        cfg.onConnected?.()
        // Playlists first (the sidebar needs them), then reconcile likes into the local
        // table (the merged Liked Songs list reads that; main also re-syncs every 30 min).
        void get()
          .loadPlaylists()
          .then(() => window.api.invoke('likes:sync'))
          .catch(() => undefined)
      }
    },
    login: async () => {
      get().applyStatus(await cfg.login())
    },
    logout: async () => {
      set({
        status: await cfg.logout(),
        likes: { state: 'idle' },
        playlists: { state: 'idle' },
        playlistTracks: {},
        liked: {}
      })
    },

    loadLikes: async () => {
      if (get().likes.state === 'loading') return
      set({ likes: { state: 'loading' } })
      try {
        const data = await window.api.invoke('music:getLikes', provider)
        const liked = { ...get().liked }
        for (const l of data) liked[l.track.id] = true
        set({ likes: { state: 'ok', data }, liked })
      } catch (err) {
        set({ likes: { state: 'error', error: ipcMessage(err) } })
      }
    },

    loadPlaylists: async () => {
      if (get().playlists.state === 'loading') return
      set({ playlists: { state: 'loading' } })
      try {
        const all = await window.api.invoke('music:getPlaylists', provider)
        // Services can list the same playlist twice (e.g. followed and owned); keep one.
        const seen = new Set<string>()
        const data = all.filter((p) => !seen.has(p.id) && seen.add(p.id))
        console.info(`[${provider}] ${data.length} playlists loaded`)
        set({ playlists: { state: 'ok', data } })
      } catch (err) {
        console.warn(`[${provider}] loading playlists failed:`, ipcMessage(err))
        set({ playlists: { state: 'error', error: ipcMessage(err) } })
      }
    },

    loadPlaylist: async (id) => {
      const put = (v: Load<Track[]>): void =>
        set((s) => ({ playlistTracks: { ...s.playlistTracks, [id]: v } }))
      put({ state: 'loading' })
      try {
        put({ state: 'ok', data: await window.api.invoke('music:getPlaylistTracks', id) })
      } catch (err) {
        put({ state: 'error', error: ipcMessage(err) })
      }
    },

    checkLiked: async (trackIds) => {
      const unknown = trackIds.filter((id) => id.startsWith(`${provider}:`) && !(id in get().liked))
      if (unknown.length === 0 || get().status?.state !== 'connected') return
      try {
        const res = await window.api.invoke('music:isLiked', unknown)
        set((s) => ({ liked: { ...s.liked, ...res } }))
      } catch {
        // Not fatal: the heart just stays empty.
      }
    },

    setLiked: async (track, liked) => {
      const prev = get().liked[track.id] ?? false
      const patchLikes = (on: boolean): void =>
        set((s) => {
          if (s.likes.state !== 'ok') return {}
          const rest = s.likes.data.filter((l) => l.track.id !== track.id)
          const data = on ? [{ track, likedAt: new Date().toISOString() }, ...rest] : rest
          return { likes: { state: 'ok', data } }
        })
      set((s) => ({ liked: { ...s.liked, [track.id]: liked } }))
      patchLikes(liked)
      try {
        await window.api.invoke(liked ? 'music:like' : 'music:unlike', track)
      } catch (err) {
        set((s) => ({ liked: { ...s.liked, [track.id]: prev } }))
        patchLikes(prev)
        throw new Error(ipcMessage(err), { cause: err })
      }
    }
  }))
}

export const useSpotify = createServiceStore<SpotifyStatus>({
  provider: 'spotify',
  login: () => window.api.invoke('spotify:login'),
  logout: () => window.api.invoke('spotify:logout'),
  onConnected: warmUpSpotify
})

export const useSoundCloud = createServiceStore<SoundCloudStatus>({
  provider: 'soundcloud',
  login: () => window.api.invoke('soundcloud:login'),
  logout: () => window.api.invoke('soundcloud:logout')
})

/** The store for a streaming service. */
export function serviceStore(
  provider: ServiceProvider
): ServiceStore<SpotifyStatus | SoundCloudStatus> {
  return (provider === 'spotify' ? useSpotify : useSoundCloud) as ServiceStore<
    SpotifyStatus | SoundCloudStatus
  >
}

/** Wire main-process status events into the stores. Call once at startup. */
export function bindServiceEvents(): () => void {
  const onSpotify = (s: SpotifyStatus): void => useSpotify.getState().applyStatus(s)
  const onSoundCloud = (s: SoundCloudStatus): void => useSoundCloud.getState().applyStatus(s)
  void window.api.invoke('spotify:getStatus').then(onSpotify)
  void window.api.invoke('soundcloud:getStatus').then(onSoundCloud)
  const off1 = window.api.on('spotify:status', onSpotify)
  const off2 = window.api.on('soundcloud:status', onSoundCloud)
  return () => {
    off1()
    off2()
  }
}
