import { create } from 'zustand'
import type { Track } from '@shared/types'

/** Which tag dialog is open: edit fields for some tracks, or fill from file names. */
export type TagDialog =
  | { mode: 'edit'; tracks: Track[]; scope: 'track' | 'folder'; folder?: string }
  | { mode: 'filenames'; tracks: Track[] }

interface TagEditorState {
  open: TagDialog | null
  editTrack: (track: Track) => void
  /** Every local track in the same folder as this one. */
  editFolder: (track: Track, all: Track[]) => void
  fillFromFilenames: (tracks: Track[]) => void
  close: () => void
}

/** Folder of a Windows or POSIX path, without the trailing separator. */
export function folderOf(path: string): string {
  const i = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
  return i > 0 ? path.slice(0, i) : path
}

export const useTagEditor = create<TagEditorState>((set) => ({
  open: null,
  editTrack: (track) => set({ open: { mode: 'edit', tracks: [track], scope: 'track' } }),
  editFolder: (track, all) => {
    if (!track.localPath) return
    const folder = folderOf(track.localPath)
    const tracks = all.filter((t) => t.localPath && folderOf(t.localPath) === folder)
    set({ open: { mode: 'edit', tracks, scope: 'folder', folder } })
  },
  fillFromFilenames: (tracks) => set({ open: { mode: 'filenames', tracks } }),
  close: () => set({ open: null })
}))
