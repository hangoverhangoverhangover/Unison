import { create } from 'zustand'
import type { DownloadItem, DownloaderStatus } from '@shared/downloads'
import type { Track } from '@shared/types'
import { ipcMessage } from './services'

interface DownloadsState {
  status: DownloaderStatus | null
  items: DownloadItem[]
  /** Latest item per SoundCloud track id (rebuilt with `items`, so selectors stay stable). */
  byScId: Record<string, DownloadItem>
  /** Live progress for running items, 0..1. */
  progress: Record<number, number>
  /** Last enqueue/retry/cancel failure. */
  error?: string
  refresh: () => Promise<void>
  enqueue: (track: Track) => Promise<void>
  retry: (id: number) => Promise<void>
  cancel: (id: number) => Promise<void>
  clearHistory: () => Promise<void>
  chooseFolder: () => Promise<void>
  reveal: (id: number) => Promise<void>
  clearError: () => void
}

function index(items: DownloadItem[]): Record<string, DownloadItem> {
  const out: Record<string, DownloadItem> = {}
  // The list is active first, then newest first: the first seen per track wins.
  for (const item of items) if (!out[item.scTrackId]) out[item.scTrackId] = item
  return out
}

export const useDownloads = create<DownloadsState>((set, get) => {
  const attempt = async (fn: () => Promise<unknown>): Promise<void> => {
    try {
      set({ error: undefined })
      await fn()
    } catch (err) {
      set({ error: ipcMessage(err) })
    }
  }
  return {
    status: null,
    items: [],
    byScId: {},
    progress: {},

    refresh: async () => {
      try {
        const items = await window.api.invoke('downloads:list')
        const running = new Set(items.filter((i) => i.status === 'running').map((i) => i.id))
        const progress: Record<number, number> = {}
        for (const [id, p] of Object.entries(get().progress)) {
          if (running.has(Number(id))) progress[Number(id)] = p
        }
        set({ items, byScId: index(items), progress })
      } catch (err) {
        set({ error: ipcMessage(err) })
      }
    },
    enqueue: (track) =>
      attempt(async () => {
        await window.api.invoke('downloads:enqueue', track)
        await get().refresh()
      }),
    retry: (id) =>
      attempt(async () => {
        await window.api.invoke('downloads:retry', id)
        await get().refresh()
      }),
    cancel: (id) => attempt(() => window.api.invoke('downloads:cancel', id)),
    clearHistory: () =>
      attempt(async () => {
        await window.api.invoke('downloads:clearHistory')
        await get().refresh()
      }),
    chooseFolder: () =>
      attempt(async () => {
        const status = await window.api.invoke('downloads:chooseFolder')
        if (status) set({ status })
      }),
    reveal: (id) => attempt(() => window.api.invoke('downloads:reveal', id)),
    clearError: () => set({ error: undefined })
  }
})

/** Fetch once and follow main's events. Returns an unbind function. */
export function bindDownloadsEvents(): () => void {
  const s = useDownloads.getState()
  void window.api
    .invoke('downloads:getStatus')
    .then((status) => useDownloads.setState({ status }))
    .catch(() => undefined)
  void s.refresh()
  const offs = [
    window.api.on('downloads:status', (status) => useDownloads.setState({ status })),
    window.api.on('downloads:changed', () => void useDownloads.getState().refresh()),
    window.api.on('downloads:progress', ({ id, progress }) =>
      useDownloads.setState((st) => ({ progress: { ...st.progress, [id]: progress } }))
    )
  ]
  return () => offs.forEach((off) => off())
}

/** Progress to show for an item: live value while running, else the stored one. */
export function itemProgress(item: DownloadItem, live: Record<number, number>): number {
  if (item.status === 'done') return 1
  return live[item.id] ?? item.progress
}
