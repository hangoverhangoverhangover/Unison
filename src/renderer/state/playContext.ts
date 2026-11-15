// Where the playing queue was started from (a playlist, Liked Songs, an album page…),
// so that page's play button can show Pause and the sidebar / Library can mark it.
import { create } from 'zustand'
import type { Track } from '@shared/types'
import { playback } from '@renderer/playback/controller'
import { usePlayback } from './player'
import { useUi, type View } from './ui'

interface PlayContextState {
  /** The page whose list is playing, or null (started from search overlays etc.). */
  context: View | null
}

export const usePlayContext = create<PlayContextState>(() => ({ context: null }))

/** Play `tracks` from `index`, remembering where (by default: the page on screen). */
export function playFrom(
  tracks: Track[],
  index: number,
  context: View | null = useUi.getState().view
): Promise<void> {
  usePlayContext.setState({ context })
  return playback.playTracks(tracks, index)
}

/** True while the list started from `view` is the one playing (not paused). */
export function usePlayingFrom(view: View): boolean {
  const context = usePlayContext((s) => s.context)
  const playing = usePlayback((s) => s.status === 'playing' || s.status === 'loading')
  return playing && context === view
}

/** True when the queue came from `view` (playing or paused). */
export function useQueuedFrom(view: View): boolean {
  return usePlayContext((s) => s.context === view)
}
