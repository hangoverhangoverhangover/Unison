// Hardware media keys. Chromium's navigator.mediaSession routes keys to whichever frame
// holds the playing media; Spotify plays inside the Web Playback SDK's iframe, so keys
// went there (and with the Spotify desktop app open, Windows may hand them to it).
// Main takes the keys system-wide instead, but only while the app has a track loaded,
// so other apps keep them when this one isn't in use.
import { globalShortcut, ipcMain } from 'electron'
import type { MediaKey } from '@shared/playback'
import { handle } from './ipc'

export const MEDIA_ACCELERATORS: Record<string, MediaKey> = {
  MediaPlayPause: 'playpause',
  MediaNextTrack: 'next',
  MediaPreviousTrack: 'previous',
  MediaStop: 'stop'
}

export interface Shortcuts {
  register(accelerator: string, callback: () => void): boolean
  unregister(accelerator: string): void
}

export interface MediaKeysOptions {
  send(key: MediaKey): void
  shortcuts?: Shortcuts
  log?(message: string): void
}

export function createMediaKeys(opts: MediaKeysOptions): {
  setActive(active: boolean): void
  dispose(): void
} {
  const shortcuts = opts.shortcuts ?? globalShortcut
  const log = opts.log ?? ((): void => undefined)
  const held = new Set<string>()

  const release = (): void => {
    for (const acc of held) shortcuts.unregister(acc)
    held.clear()
  }

  return {
    setActive(active) {
      if (!active) return release()
      for (const [acc, key] of Object.entries(MEDIA_ACCELERATORS)) {
        if (held.has(acc)) continue
        // Fails when another app already registered the key; mediaSession still works then.
        if (shortcuts.register(acc, () => opts.send(key))) held.add(acc)
        else log(`[media] couldn't take ${acc}; another app holds it`)
      }
    },
    dispose: release
  }
}

export function registerMediaKeys(send: (key: MediaKey) => void): { dispose(): void } {
  const keys = createMediaKeys({ send, log: (m) => console.warn(m) })
  handle('media:setActive', (active) => keys.setActive(active === true))
  return {
    dispose() {
      keys.dispose()
      ipcMain.removeHandler('media:setActive')
    }
  }
}
