// playlists:* logic, routed by playlist id prefix: `app:` goes to the local store,
// `spotify:` / `soundcloud:` to that provider's PlaylistEditor. No Electron imports, so
// it can be tested directly; index.ts wires it to IPC.
import type { ServiceProvider } from '@shared/ipc'
import { artworkUrl, type PlaylistPrefs } from '@shared/library'
import type { MusicProvider, PlaylistEditor } from '@shared/provider'
import type { Playlist, Track } from '@shared/types'
import { notConnectedMessage } from '../music/router'
import { AppPlaylistStore, isAppPlaylistId, validateTracks } from './store'

export type EditableProvider = MusicProvider & Partial<PlaylistEditor>

export interface PlaylistServiceDeps {
  store: AppPlaylistStore
  getProvider: (source: ServiceProvider) => EditableProvider | undefined
  /** The list music:getPlaylistTracks returns for a service playlist (positions index it). */
  getServicePlaylistTracks: (playlistId: string) => Promise<Track[]>
  /** `null` = the app playlist list changed; an id = that playlist's tracks changed. */
  notify: (playlistId: string | null) => void
  /** Sidebar order and hidden list (prefs.ts). */
  prefs?: PrefsStore
  /** Custom covers (cover.ts plus the native open dialog). */
  covers?: CoverDeps
  now?: () => number
}

export interface PrefsStore {
  read(): PlaylistPrefs
  /** Validates (throws a readable Error) and returns what was stored. */
  write(prefs: unknown): PlaylistPrefs
  /** Drop a deleted playlist from both lists. */
  forget(playlistId: string): void
}

export interface CoverDeps {
  /** Native image picker; null when cancelled. */
  pick(): Promise<string | null>
  /** Validate and copy the file into the artwork cache; returns its sha1. */
  importCover(path: string): Promise<string>
}

export const COVER_APP_ONLY_MESSAGE = 'Only app playlists can have a custom cover.'

/** How long the service's playlist list (for the `canEdit` check) is reused. */
export const EDIT_CHECK_TTL_MS = 2 * 60_000

const SERVICE_NAMES: Record<ServiceProvider, string> = {
  spotify: 'Spotify',
  soundcloud: 'SoundCloud'
}

export const REORDER_MESSAGE = 'Reordering works for your app playlists only.'

export function crossServiceMessage(source: ServiceProvider): string {
  const name = SERVICE_NAMES[source]
  return `Only ${name} tracks can be added to a ${name} playlist.`
}

function serviceOf(playlistId: unknown): ServiceProvider | null {
  if (typeof playlistId !== 'string') return null
  for (const source of Object.keys(SERVICE_NAMES) as ServiceProvider[]) {
    if (playlistId.startsWith(`${source}:`) && playlistId.length > source.length + 1) return source
  }
  return null
}

function invalidId(playlistId: unknown): Error {
  return new Error(`Invalid playlist id: ${String(playlistId)}`)
}

export interface PlaylistService {
  getApp(): Playlist[]
  create(name: string, tracks?: Track[]): Playlist
  rename(playlistId: string, name: string): Playlist
  delete(playlistId: string): void
  addTracks(playlistId: string, tracks: Track[]): Promise<void>
  removeAt(playlistId: string, positions: number[]): Promise<void>
  move(playlistId: string, from: number, to: number): void
  /** Pick an image for an app playlist; null when the dialog was cancelled. */
  chooseCover(playlistId: string): Promise<Playlist | null>
  /** Back to the automatic cover. */
  clearCover(playlistId: string): Playlist
  getPrefs(): PlaylistPrefs
  setPrefs(prefs: PlaylistPrefs): PlaylistPrefs
}

export function createPlaylistService(deps: PlaylistServiceDeps): PlaylistService {
  const { store, notify } = deps
  const now = deps.now ?? Date.now
  const cache = new Map<ServiceProvider, { at: number; playlists: Playlist[] }>()

  function appId(playlistId: unknown): string {
    if (!isAppPlaylistId(playlistId)) throw invalidId(playlistId)
    return playlistId
  }

  /** App playlist id for cover edits; service ids get a readable refusal. */
  function coverId(playlistId: unknown): string {
    if (isAppPlaylistId(playlistId)) return playlistId
    if (serviceOf(playlistId)) throw new Error(COVER_APP_ONLY_MESSAGE)
    throw invalidId(playlistId)
  }

  function prefsStore(): PrefsStore {
    if (!deps.prefs) throw new Error('Playlist settings are not available.')
    return deps.prefs
  }

  function editorFor(source: ServiceProvider): MusicProvider & PlaylistEditor {
    const p = deps.getProvider(source)
    if (!p) throw new Error(notConnectedMessage(source))
    if (typeof p.addToPlaylist !== 'function' || typeof p.removeFromPlaylist !== 'function')
      throw new Error(`${SERVICE_NAMES[source]} playlists can't be edited from this app.`)
    return p as MusicProvider & PlaylistEditor
  }

  async function findPlaylist(
    source: ServiceProvider,
    provider: MusicProvider,
    playlistId: string
  ): Promise<Playlist | undefined> {
    const hit = cache.get(source)
    if (hit && now() - hit.at < EDIT_CHECK_TTL_MS) {
      const found = hit.playlists.find((p) => p.id === playlistId)
      if (found) return found
    }
    // Not cached (or not in a possibly stale list): ask the service.
    const playlists = await provider.getPlaylists()
    cache.set(source, { at: now(), playlists })
    return playlists.find((p) => p.id === playlistId)
  }

  /** Connected, can edit, and the user may edit this playlist. */
  async function editable(
    source: ServiceProvider,
    playlistId: string
  ): Promise<MusicProvider & PlaylistEditor> {
    const provider = editorFor(source)
    const playlist = await findPlaylist(source, provider, playlistId)
    const name = SERVICE_NAMES[source]
    if (!playlist) throw new Error(`That ${name} playlist isn't in your library.`)
    if (!playlist.canEdit)
      throw new Error(
        `You can only edit ${name} playlists you own${source === 'spotify' ? ' or collaborate on' : ''}.`
      )
    return provider
  }

  /** App playlists also re-announce the list: their track count and artwork are derived. */
  function changedItems(playlistId: string): void {
    notify(playlistId)
    if (isAppPlaylistId(playlistId)) notify(null)
  }

  return {
    getApp: () => store.list(),

    create(name, tracks) {
      const { playlist, skipped } = store.create(name, tracks ?? [])
      if (skipped.length)
        console.warn(`[playlists] skipped ${skipped.length} local track(s) not in the library`)
      notify(null)
      return playlist
    },

    rename(playlistId, name) {
      const playlist = store.rename(appId(playlistId), name)
      notify(null)
      return playlist
    },

    delete(playlistId) {
      const id = appId(playlistId)
      store.delete(id)
      try {
        deps.prefs?.forget(id)
      } catch (err) {
        console.warn(
          '[playlists] could not drop the deleted playlist from the sidebar settings',
          err
        )
      }
      notify(null)
    },

    async chooseCover(playlistId) {
      const id = coverId(playlistId)
      if (!deps.covers) throw new Error('Custom covers are not available.')
      store.get(id) // fail before opening the dialog
      const path = await deps.covers.pick()
      if (!path) return null
      const hash = await deps.covers.importCover(path)
      const playlist = store.setCustomArtwork(id, artworkUrl(hash))
      changedItems(id)
      return playlist
    },

    clearCover(playlistId) {
      const id = coverId(playlistId)
      const playlist = store.clearCustomArtwork(id)
      changedItems(id)
      return playlist
    },

    getPrefs: () => (deps.prefs ? deps.prefs.read() : { order: [], hidden: [] }),

    setPrefs: (prefs) => prefsStore().write(prefs),

    async addTracks(playlistId, tracks) {
      const list = validateTracks(tracks)
      if (isAppPlaylistId(playlistId)) {
        if (list.length === 0) return
        const { added, skipped } = store.addTracks(playlistId, list)
        if (added > 0) {
          changedItems(playlistId)
        }
        if (skipped.length && added === 0)
          throw new Error(
            skipped.length === 1
              ? "That local file isn't in your library any more."
              : "Those local files aren't in your library any more."
          )
        if (skipped.length)
          console.warn(`[playlists] skipped ${skipped.length} local track(s) not in the library`)
        return
      }
      const source = serviceOf(playlistId)
      if (!source) throw invalidId(playlistId)
      if (list.some((t) => t.provider !== source)) throw new Error(crossServiceMessage(source))
      if (list.length === 0) return
      const provider = await editable(source, playlistId)
      await provider.addToPlaylist(playlistId, list)
      changedItems(playlistId)
    },

    async removeAt(playlistId, positions) {
      if (!Array.isArray(positions)) throw new Error('No positions given.')
      if (isAppPlaylistId(playlistId)) {
        if (positions.length === 0) return
        store.removeAt(playlistId, positions)
        changedItems(playlistId)
        return
      }
      const source = serviceOf(playlistId)
      if (!source) throw invalidId(playlistId)
      if (positions.length === 0) return
      const provider = await editable(source, playlistId)
      const tracks = await deps.getServicePlaylistTracks(playlistId)
      const picked = new Map<string, Track>()
      for (const p of positions) {
        if (typeof p !== 'number' || !Number.isInteger(p) || p < 0 || p >= tracks.length)
          throw new Error(
            `Position ${String(p)} is out of range (the playlist has ${tracks.length} tracks).`
          )
        const t = tracks[p]!
        picked.set(t.id, t)
      }
      await provider.removeFromPlaylist(playlistId, [...picked.values()])
      changedItems(playlistId)
    },

    move(playlistId, from, to) {
      if (isAppPlaylistId(playlistId)) {
        store.move(playlistId, from, to)
        if (from !== to) changedItems(playlistId)
        return
      }
      if (serviceOf(playlistId)) throw new Error(REORDER_MESSAGE)
      throw invalidId(playlistId)
    }
  }
}
