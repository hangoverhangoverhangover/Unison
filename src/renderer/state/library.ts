import { create } from 'zustand'
import type { ScanStatus } from '@shared/library'
import type { Track } from '@shared/types'

interface LibraryState {
  loaded: boolean
  tracks: Track[]
  folders: string[]
  scan: ScanStatus
  refresh: () => Promise<void>
  addFolder: () => Promise<void>
  removeFolder: (path: string) => Promise<void>
  rescan: () => Promise<void>
}

export const useLibrary = create<LibraryState>((set) => ({
  loaded: false,
  tracks: [],
  folders: [],
  scan: { state: 'idle', trackCount: 0 },
  refresh: async () => {
    const [tracks, folders, scan] = await Promise.all([
      window.api.invoke('library:getTracks'),
      window.api.invoke('library:getFolders'),
      window.api.invoke('library:getScanStatus')
    ])
    set({ tracks, folders, scan, loaded: true })
  },
  addFolder: async () => {
    const folders = await window.api.invoke('library:addFolder')
    if (folders) set({ folders })
  },
  removeFolder: async (path) => {
    set({ folders: await window.api.invoke('library:removeFolder', path) })
  },
  rescan: () => window.api.invoke('library:rescan')
}))

/** Wire main-process events into the store. Call once at startup. */
export function bindLibraryEvents(): () => void {
  const { refresh } = useLibrary.getState()
  void refresh()
  const offChanged = window.api.on('library:changed', () => void refresh())
  const offScan = window.api.on('library:scanStatus', (scan) => useLibrary.setState({ scan }))
  return () => {
    offChanged()
    offScan()
  }
}
