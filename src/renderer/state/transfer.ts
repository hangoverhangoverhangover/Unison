import { create } from 'zustand'
import type { ServiceProvider } from '@shared/ipc'

interface TransferState {
  /** The open "Copy to …" dialog, or null. */
  open: { playlistId: string; name: string; target: ServiceProvider } | null
  start: (playlistId: string, name: string, target: ServiceProvider) => void
  close: () => void
}

export const useTransfer = create<TransferState>((set) => ({
  open: null,
  start: (playlistId, name, target) => set({ open: { playlistId, name, target } }),
  close: () => set({ open: null })
}))
