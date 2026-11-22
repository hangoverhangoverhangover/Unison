// Which SoundCloud track's title is being fixed (QoL 4); see TitleFixDialog.
import { create } from 'zustand'
import type { Track } from '@shared/types'

export const useTitleFix = create<{ track: Track | null; open(t: Track): void; close(): void }>(
  (set) => ({
    track: null,
    open: (track) => set({ track }),
    close: () => set({ track: null })
  })
)
