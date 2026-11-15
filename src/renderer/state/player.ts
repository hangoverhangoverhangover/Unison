import { useSyncExternalStore } from 'react'
import type { PlaybackState } from '@shared/playback'
import { playback } from '@renderer/playback/controller'

/**
 * Subscribe a component to one slice of playback state. Return primitives or
 * existing references from the selector (not new objects) to avoid re-renders.
 * Position is not in here on purpose: read playback.getPositionMs() in rAF.
 */
export function usePlayback<T>(selector: (s: PlaybackState) => T): T {
  return useSyncExternalStore(playback.subscribe, () => selector(playback.getState()))
}
