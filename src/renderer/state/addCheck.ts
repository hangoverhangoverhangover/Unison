// Ask before adding songs a playlist already has (QoL 4). addTracks in the playlists
// store asks main which songs are already there, and waits here for your choice.
import { create } from 'zustand'
import type { AlreadyInPlaylist } from '@shared/transfer'
import type { Track } from '@shared/types'

export type AddChoice = 'all' | 'new' | 'cancel'

const ASK_KEY = 'cp.askBeforeDuplicates'

export function readAskBeforeDuplicates(): boolean {
  try {
    return localStorage.getItem(ASK_KEY) !== 'off'
  } catch {
    return true
  }
}

interface Pending {
  playlistName: string
  tracks: Track[]
  matches: AlreadyInPlaylist[]
  resolve(choice: AddChoice): void
}

interface AddCheckState {
  pending: Pending | null
  /** Ask at all (Settings → General). */
  ask: boolean
  setAsk(on: boolean): void
  /** Show the question and wait for the answer. */
  confirm(p: Omit<Pending, 'resolve'>): Promise<AddChoice>
  answer(choice: AddChoice): void
}

export const useAddCheck = create<AddCheckState>((set, get) => ({
  pending: null,
  ask: readAskBeforeDuplicates(),
  setAsk(on) {
    try {
      localStorage.setItem(ASK_KEY, on ? 'on' : 'off')
    } catch {
      // per-device convenience only
    }
    set({ ask: on })
  },
  confirm(p) {
    // A question still open is answered "cancel" before the next one.
    get().pending?.resolve('cancel')
    return new Promise((resolve) => set({ pending: { ...p, resolve } }))
  },
  answer(choice) {
    const p = get().pending
    set({ pending: null })
    p?.resolve(choice)
  }
}))

/** The songs to add for a choice: all of them, only the new ones, or none. */
export function tracksFor(
  choice: AddChoice,
  tracks: Track[],
  matches: AlreadyInPlaylist[]
): Track[] {
  if (choice === 'cancel') return []
  if (choice === 'all') return tracks
  const already = new Set(matches.map((m) => m.track.id))
  return tracks.filter((t) => !already.has(t.id))
}
