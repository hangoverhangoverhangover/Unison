import { create } from 'zustand'
import type { ListeningStats, SmartPlaylist, SmartPlaylistKind, StatsRange } from '@shared/history'
import { ipcMessage, type Load } from './services'

interface HistoryState {
  smart: Partial<Record<SmartPlaylistKind, Load<SmartPlaylist>>>
  stats: Partial<Record<StatsRange, Load<ListeningStats>>>
  loadSmart: (kind: SmartPlaylistKind) => Promise<void>
  loadStats: (range: StatsRange) => Promise<void>
}

export const useHistory = create<HistoryState>((set, get) => ({
  smart: {},
  stats: {},
  loadSmart: async (kind) => {
    if (!get().smart[kind]) set((s) => ({ smart: { ...s.smart, [kind]: { state: 'loading' } } }))
    try {
      const data = await window.api.invoke('history:smart', kind)
      set((s) => ({ smart: { ...s.smart, [kind]: { state: 'ok', data } } }))
    } catch (err) {
      set((s) => ({ smart: { ...s.smart, [kind]: { state: 'error', error: ipcMessage(err) } } }))
    }
  },
  loadStats: async (range) => {
    if (!get().stats[range]) set((s) => ({ stats: { ...s.stats, [range]: { state: 'loading' } } }))
    try {
      const data = await window.api.invoke('history:stats', range)
      set((s) => ({ stats: { ...s.stats, [range]: { state: 'ok', data } } }))
    } catch (err) {
      set((s) => ({ stats: { ...s.stats, [range]: { state: 'error', error: ipcMessage(err) } } }))
    }
  }
}))

/** Refetch whatever has been loaded when plays are recorded or history is cleared. */
export function bindHistoryEvents(): () => void {
  return window.api.on('history:changed', () => {
    const { smart, stats, loadSmart, loadStats } = useHistory.getState()
    for (const k of Object.keys(smart) as SmartPlaylistKind[]) void loadSmart(k)
    for (const r of Object.keys(stats) as StatsRange[]) void loadStats(r)
  })
}
