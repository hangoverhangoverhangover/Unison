import { useSyncExternalStore } from 'react'

const subscribe = (cb: () => void): (() => void) => {
  document.addEventListener('fullscreenchange', cb)
  return () => document.removeEventListener('fullscreenchange', cb)
}

/** The window is full screen (the Player page's button, F11 or Esc to leave). */
export function useFullscreen(): boolean {
  return useSyncExternalStore(subscribe, () => !!document.fullscreenElement)
}
