// Lyrics for the playing track (QoL 3): loaded when the track changes, kept here for
// the lyrics view, the bar above the play bar and the editor.
import { create } from 'zustand'
import type { LyricsResult } from '@shared/lyrics'
import type { PlaybackState } from '@shared/playback'
import type { Track } from '@shared/types'
import { ipcMessage } from './services'

const BAR_KEY = 'cp.lyricsBar'

function readBar(): boolean {
  try {
    return localStorage.getItem(BAR_KEY) !== 'off'
  } catch {
    return true
  }
}

interface LyricsState {
  /** The track these lyrics belong to. */
  track: Track | null
  result: LyricsResult | null
  loading: boolean
  error?: string
  /** Show the current line above the play bar (when lyrics are synced). */
  barOn: boolean
  setBar(on: boolean): void
  /** The lyrics editor is open. */
  editorOpen: boolean
  setEditorOpen(open: boolean): void
  save(text: string): Promise<boolean>
  /** Look again with your own title and artist; true when lyrics were found. */
  search(title: string, artist: string): Promise<boolean>
  remove(): Promise<void>
}

let token = 0

export const useLyrics = create<LyricsState>((set, get) => ({
  track: null,
  result: null,
  loading: false,
  barOn: readBar(),
  setBar(on) {
    try {
      localStorage.setItem(BAR_KEY, on ? 'on' : 'off')
    } catch {
      // per-device convenience only
    }
    set({ barOn: on })
  },
  editorOpen: false,
  setEditorOpen: (open) => set({ editorOpen: open }),
  async save(text) {
    const track = get().track
    if (!track) return false
    try {
      set({ result: await window.api.invoke('lyrics:save', track, text), error: undefined })
      return true
    } catch (err) {
      set({ error: ipcMessage(err) })
      return false
    }
  },
  async search(title, artist) {
    const track = get().track
    if (!track) return false
    set({ loading: true, error: undefined })
    try {
      const result = await window.api.invoke('lyrics:search', track, { title, artist })
      if (get().track?.id === track.id) set({ result, loading: false })
      return result.source !== 'none'
    } catch (err) {
      set({ loading: false, error: ipcMessage(err) })
      return false
    }
  },
  async remove() {
    const track = get().track
    if (!track) return
    try {
      set({ result: await window.api.invoke('lyrics:delete', track), error: undefined })
    } catch (err) {
      set({ error: ipcMessage(err) })
    }
  }
}))

async function load(track: Track | null): Promise<void> {
  const my = ++token
  if (!track) {
    useLyrics.setState({ track: null, result: null, loading: false, error: undefined })
    return
  }
  useLyrics.setState({ track, result: null, loading: true, error: undefined })
  try {
    const result = await window.api.invoke('lyrics:get', track)
    if (my === token) useLyrics.setState({ result, loading: false })
  } catch (err) {
    if (my === token) useLyrics.setState({ loading: false, error: ipcMessage(err) })
  }
}

/** Follow the playing track. Call once at startup. */
export function bindLyrics(controller: {
  getState(): PlaybackState
  subscribe(l: (s: PlaybackState) => void): () => void
}): () => void {
  let trackId: string | null = null
  const onState = (s: PlaybackState): void => {
    const track = s.current?.track ?? null
    if ((track?.id ?? null) === trackId) return
    trackId = track?.id ?? null
    void load(track)
  }
  onState(controller.getState())
  return controller.subscribe(onState)
}
