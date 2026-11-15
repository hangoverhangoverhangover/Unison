import { create } from 'zustand'
import type { FindResult } from '@shared/match'
import type { ServiceProvider } from '@shared/ipc'
import type { Track } from '@shared/types'
import { ipcMessage, type Load } from './services'

interface FindState {
  /** The open "Find on" dialog, or null when closed. */
  open: { source: Track; service: ServiceProvider; result: Load<FindResult> } | null
  find: (source: Track, service: ServiceProvider) => Promise<void>
  close: () => void
}

export const useFind = create<FindState>((set, get) => ({
  open: null,
  find: async (source, service) => {
    set({ open: { source, service, result: { state: 'loading' } } })
    let result: Load<FindResult>
    try {
      result = { state: 'ok', data: await window.api.invoke('music:findOn', source, service) }
    } catch (err) {
      result = { state: 'error', error: ipcMessage(err) }
    }
    // Ignore a late answer for a dialog that was closed or reopened for another track.
    const cur = get().open
    if (cur && cur.source.id === source.id && cur.service === service) {
      set({ open: { ...cur, result } })
    }
  },
  close: () => set({ open: null })
}))
