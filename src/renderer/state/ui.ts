import { create } from 'zustand'
import type { PanelTab } from '@shared/config'

/**
 * `playlist:<playlistId>` opens a playlist, e.g. `playlist:spotify:37i9...`.
 * `artist:<artistId>`, `album:<albumId>` and `track:<trackId>` (SoundCloud) take app ids (`spotify:<id>`, `soundcloud:<id>`).
 */
export type View =
  | 'local'
  | 'settings'
  | 'search'
  | 'likes'
  | 'downloads'
  | 'library'
  | 'stats'
  | 'duplicates'
  | 'feed'
  | 'following'
  | `smart:${'recent' | 'on-repeat' | 'forgotten'}`
  | `playlist:${string}`
  | `artist:${string}`
  | `album:${string}`
  | `track:${string}`

export type { PanelTab }

/** How many views Back can return through. */
const HISTORY_LIMIT = 50

interface UiState {
  view: View
  /** Views before this one, oldest first. */
  history: View[]
  /** Views Back left behind, newest last (Forward returns to them). */
  forward: View[]
  /** The right-hand panel (Queue / Details / Jam tabs) is open. */
  panelOpen: boolean
  /** Its current (or last used) tab. */
  panelTab: PanelTab
  /** Query handed to the Search page (quick search's "See all results"). */
  searchQuery: string
  /** Open the Search page showing `query`; closes quick search. */
  showSearch: (query: string) => void
  /** The mini player window is open. */
  miniOpen: boolean
  setMiniOpen: (open: boolean) => void
  setView: (view: View) => void
  /** Return to the previous view, if any. */
  back: () => void
  /** Return to the view Back left, if any. */
  goForward: () => void
  /** The quick search panel (title bar pill / Ctrl+K) is open. */
  quickSearchOpen: boolean
  openQuickSearch: () => void
  closeQuickSearch: () => void
  /** Open the panel on this tab (default: the last one). */
  openPanel: (tab?: PanelTab) => void
  /**
   * Open on this tab; close if it's already open on it. With no tab, open or close on
   * the last one.
   */
  togglePanel: (tab?: PanelTab) => void
  closePanel: () => void
}

export const useUi = create<UiState>((set) => ({
  view: 'local',
  history: [],
  forward: [],
  quickSearchOpen: false,
  openQuickSearch: () => set({ quickSearchOpen: true }),
  closeQuickSearch: () => set({ quickSearchOpen: false }),
  panelOpen: false,
  panelTab: 'queue',
  miniOpen: false,
  searchQuery: '',
  showSearch: (query) =>
    set((s) => ({
      searchQuery: query,
      quickSearchOpen: false,
      ...(s.view === 'search'
        ? {}
        : {
            view: 'search' as const,
            history: [...s.history, s.view].slice(-HISTORY_LIMIT),
            forward: []
          })
    })),
  setMiniOpen: (miniOpen) => set({ miniOpen }),
  setView: (view) =>
    set((s) =>
      s.view === view
        ? s
        : { view, history: [...s.history, s.view].slice(-HISTORY_LIMIT), forward: [] }
    ),
  back: () =>
    set((s) => {
      const prev = s.history.at(-1)
      return prev
        ? {
            view: prev,
            history: s.history.slice(0, -1),
            forward: [...s.forward, s.view].slice(-HISTORY_LIMIT)
          }
        : s
    }),
  goForward: () =>
    set((s) => {
      const next = s.forward.at(-1)
      return next
        ? {
            view: next,
            forward: s.forward.slice(0, -1),
            history: [...s.history, s.view].slice(-HISTORY_LIMIT)
          }
        : s
    }),
  openPanel: (tab) => set((s) => ({ panelOpen: true, panelTab: tab ?? s.panelTab })),
  togglePanel: (tab) =>
    set((s) => {
      const next = tab ?? s.panelTab
      if (s.panelOpen && s.panelTab === next) return { panelOpen: false }
      return { panelOpen: true, panelTab: next }
    }),
  closePanel: () => set({ panelOpen: false })
}))
