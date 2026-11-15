import { create } from 'zustand'
import type { PlaylistPrefs } from '@shared/library'
import { ipcMessage } from './services'

interface PrefsState {
  prefs: PlaylistPrefs
  /** Fast lookup for `prefs.hidden` (rebuilt with prefs, so selectors stay stable). */
  hidden: ReadonlySet<string>
  loaded: boolean
  error?: string
  load: () => Promise<void>
  save: (prefs: PlaylistPrefs) => Promise<void>
  setHidden: (playlistId: string, hidden: boolean) => Promise<void>
}

const EMPTY: PlaylistPrefs = { order: [], hidden: [] }

export const usePlaylistPrefs = create<PrefsState>((set, get) => ({
  prefs: EMPTY,
  hidden: new Set(),
  loaded: false,
  load: async () => {
    try {
      const prefs = await window.api.invoke('playlists:getPrefs')
      set({ prefs, hidden: new Set(prefs.hidden), loaded: true })
    } catch (err) {
      set({ error: ipcMessage(err), loaded: true })
    }
  },
  save: async (next) => {
    const before = get().prefs
    // Optimistic: the sidebar moves at once; roll back if main refuses.
    set({ prefs: next, hidden: new Set(next.hidden), error: undefined })
    try {
      const stored = await window.api.invoke('playlists:setPrefs', next)
      set({ prefs: stored, hidden: new Set(stored.hidden) })
    } catch (err) {
      set({ prefs: before, hidden: new Set(before.hidden), error: ipcMessage(err) })
    }
  },
  setHidden: async (playlistId, hide) => {
    const { prefs, save } = get()
    const hidden = prefs.hidden.filter((id) => id !== playlistId)
    if (hide) hidden.push(playlistId)
    await save({ ...prefs, hidden })
  }
}))
