// Title cleanup IPC (QoL 4): your fixes, and hooking the cleaner into SoundCloud mapping.
import { ipcMain, type WebContents } from 'electron'
import type { InvokeChannel } from '@shared/ipc'
import type { Db } from '../db'
import { emit, handle } from '../ipc'
import { setTitleCleaner } from '../soundcloud/mapping'
import { dbSettingsStore } from '../spotify/tokens'
import { createTitles } from './service'

const CHANNELS: InvokeChannel[] = ['titles:getOverride', 'titles:setOverride']

export function registerTitles(opts: {
  db: Db
  enabled(): boolean
  getWebContents(): WebContents | undefined
}): { dispose(): void } {
  const rows = opts.db.prepare('SELECT DISTINCT artists FROM tracks').pluck()
  const titles = createTitles({
    settings: dbSettingsStore(opts.db),
    enabled: opts.enabled,
    loadKnown: () => {
      const out: string[] = []
      for (const json of rows.all() as string[]) {
        try {
          const list = JSON.parse(json) as unknown
          if (Array.isArray(list)) for (const a of list) if (typeof a === 'string') out.push(a)
        } catch {
          // skip a broken row
        }
      }
      return out
    }
  })
  setTitleCleaner(titles.clean)
  handle('titles:getOverride', (trackId) => titles.getOverride(trackId))
  handle('titles:setOverride', (trackId, value) => {
    titles.setOverride(trackId, value)
    emit(opts.getWebContents(), 'titles:changed', trackId)
  })
  return {
    dispose() {
      setTitleCleaner(null)
      for (const c of CHANNELS) ipcMain.removeHandler(c)
    }
  }
}
