// session:*, prefs:* and audio:* IPC handlers (QoL round 2).
import { ipcMain, type WebContents } from 'electron'
import { BOOT_THEME_CHANNEL, type AppPrefs } from '@shared/config'
import type { InvokeChannel } from '@shared/ipc'
import type { Db } from '../db'
import { emit, handle } from '../ipc'
import {
  loadSession,
  readAppPrefs,
  readAudio,
  saveSession,
  writeAppPrefs,
  writeAudio
} from './store'

export {
  AUDIO_KEY,
  PREFS_KEY,
  SESSION_KEY,
  loadSession,
  readAppPrefs,
  readAudio,
  saveSession,
  writeAppPrefs,
  writeAudio
} from './store'

const CHANNELS: InvokeChannel[] = [
  'session:save',
  'session:load',
  'prefs:get',
  'prefs:set',
  'audio:get',
  'audio:set'
]

export interface SettingsOptions {
  db: Db
  getWebContents(): WebContents | undefined
}

export type PrefsListener = (prefs: AppPrefs) => void

export function registerSettings(opts: SettingsOptions): {
  /** Current prefs (read from the db each call). */
  getPrefs(): AppPrefs
  /** Called after every prefs:set with the stored result. Returns an unsubscribe. */
  onPrefsChanged(listener: PrefsListener): () => void
  dispose(): void
} {
  const { db } = opts
  const listeners = new Set<PrefsListener>()

  handle('session:save', (snapshot) => saveSession(db, snapshot))
  handle('session:load', () => loadSession(db))
  handle('prefs:get', () => readAppPrefs(db))
  handle('prefs:set', (patch) => {
    const prefs = writeAppPrefs(db, patch)
    emit(opts.getWebContents(), 'prefs:changed', prefs)
    for (const listener of listeners) {
      try {
        listener(prefs)
      } catch (err) {
        console.warn('prefs listener failed', err)
      }
    }
    return prefs
  })
  // Read by the preload, synchronously, before the page paints (no theme flash).
  ipcMain.on(BOOT_THEME_CHANNEL, (e) => {
    e.returnValue = readAppPrefs(db).theme
  })
  handle('audio:get', () => readAudio(db))
  handle('audio:set', (settings) => writeAudio(db, settings))

  return {
    getPrefs: () => readAppPrefs(db),
    onPrefsChanged(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose() {
      listeners.clear()
      ipcMain.removeAllListeners(BOOT_THEME_CHANNEL)
      for (const channel of CHANNELS) ipcMain.removeHandler(channel)
    }
  }
}
