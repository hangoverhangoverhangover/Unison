import { create } from 'zustand'
import type { Playlist, Track } from '@shared/types'
import { ipcMessage, serviceStore, type Load } from './services'
import { tracksFor, useAddCheck } from './addCheck'

/** A playlist's name, from the app list or a service's loaded playlists. */
function playlistName(id: string, app: Playlist[]): string {
  const own = app.find((p) => p.id === id)
  if (own) return own.name
  const provider = id.startsWith('soundcloud:') ? 'soundcloud' : 'spotify'
  const loaded = serviceStore(provider).getState().playlists
  return (loaded.state === 'ok' && loaded.data.find((p) => p.id === id)?.name) || 'this playlist'
}

interface PlaylistsState {
  /** In-app playlists (source 'app'), newest first. */
  app: Playlist[]
  appTracks: Record<string, Load<Track[]>>
  /** Last add/remove/rename failure, shown as a toast-like line. */
  error?: string
  refresh: () => Promise<void>
  loadTracks: (playlistId: string) => Promise<void>
  /** Returns the new playlist, or undefined on failure (error is set). */
  create: (name: string, tracks?: Track[]) => Promise<Playlist | undefined>
  rename: (playlistId: string, name: string) => Promise<void>
  remove: (playlistId: string) => Promise<void>
  addTracks: (playlistId: string, tracks: Track[]) => Promise<void>
  removeAt: (playlistId: string, positions: number[]) => Promise<void>
  move: (playlistId: string, from: number, to: number) => Promise<void>
  clearError: () => void
}

/** Next free "New playlist", "New playlist 2", ... */
function freshName(base: string, taken: Playlist[]): string {
  const names = new Set(taken.map((p) => p.name))
  if (!names.has(base)) return base
  for (let n = 2; ; n++) if (!names.has(`${base} ${n}`)) return `${base} ${n}`
}

export const usePlaylists = create<PlaylistsState>((set, get) => {
  const attempt = async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
    try {
      set({ error: undefined })
      return await fn()
    } catch (err) {
      set({ error: ipcMessage(err) })
      return undefined
    }
  }
  return {
    app: [],
    appTracks: {},

    refresh: async () => {
      try {
        set({ app: await window.api.invoke('playlists:getApp') })
      } catch (err) {
        set({ error: ipcMessage(err) })
      }
    },

    loadTracks: async (playlistId) => {
      if (playlistId.startsWith('app:')) {
        const put = (v: Load<Track[]>): void =>
          set((s) => ({ appTracks: { ...s.appTracks, [playlistId]: v } }))
        if (!get().appTracks[playlistId]) put({ state: 'loading' })
        try {
          put({ state: 'ok', data: await window.api.invoke('music:getPlaylistTracks', playlistId) })
        } catch (err) {
          put({ state: 'error', error: ipcMessage(err) })
        }
        return
      }
      const provider = playlistId.startsWith('soundcloud:') ? 'soundcloud' : 'spotify'
      await serviceStore(provider).getState().loadPlaylist(playlistId)
    },

    create: (name, tracks) =>
      attempt(() =>
        window.api.invoke('playlists:create', freshName(name, get().app), tracks ?? [])
      ),
    rename: async (id, name) => {
      await attempt(() => window.api.invoke('playlists:rename', id, name))
    },
    remove: async (id) => {
      await attempt(() => window.api.invoke('playlists:delete', id))
    },
    addTracks: async (id, tracks) => {
      let list = tracks
      // Songs the playlist already has: ask first (a failed check just adds).
      if (useAddCheck.getState().ask && tracks.length > 0) {
        const matches = await window.api.invoke('playlists:checkAdd', id, tracks).catch(() => [])
        if (matches.length > 0) {
          const choice = await useAddCheck
            .getState()
            .confirm({ playlistName: playlistName(id, get().app), tracks, matches })
          list = tracksFor(choice, tracks, matches)
        }
      }
      if (list.length === 0) return
      await attempt(() => window.api.invoke('playlists:addTracks', id, list))
    },
    removeAt: async (id, positions) => {
      await attempt(() => window.api.invoke('playlists:removeAt', id, positions))
    },
    move: async (id, from, to) => {
      await attempt(() => window.api.invoke('playlists:move', id, from, to))
    },
    clearError: () => set({ error: undefined })
  }
})

/** Keep playlists in step with main. Call once at startup. */
export function bindPlaylistEvents(): () => void {
  void usePlaylists.getState().refresh()
  return window.api.on('playlists:changed', ({ playlistId }) => {
    const s = usePlaylists.getState()
    if (playlistId === null) {
      void s.refresh()
      return
    }
    void s.refresh() // counts and artwork may change
    const loaded = playlistId.startsWith('app:')
      ? s.appTracks[playlistId]
      : serviceStore(playlistId.startsWith('soundcloud:') ? 'soundcloud' : 'spotify').getState()
          .playlistTracks[playlistId]
    if (loaded) void s.loadTracks(playlistId)
  })
}
