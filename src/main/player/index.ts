// Player page media (QoL 4): your pictures and videos, copied into the data folder so
// moving the originals doesn't break them, and served as media://player/<id>.
import { BrowserWindow, dialog, ipcMain, type WebContents } from 'electron'
import { randomBytes } from 'crypto'
import { copyFile, mkdir, rm, stat } from 'fs/promises'
import { basename, extname, join } from 'path'
import type { InvokeChannel } from '@shared/ipc'
import {
  PLAYER_IMAGE_EXTS,
  PLAYER_VIDEO_EXTS,
  type PlayerMedia,
  type PlayerMediaScope
} from '@shared/player'
import type { Db } from '../db'
import { emit, handle } from '../ipc'
import { dbSettingsStore } from '../spotify/tokens'

const KEY = 'player.media'
const ID = /^[0-9a-f]{40}$/
/** One file; a few minutes of 1080p video fits well inside. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024
const CHANNELS: InvokeChannel[] = ['player:list', 'player:add', 'player:remove', 'player:setScope']

/** A clean scope, or an error for anything else. */
export function validateScope(raw: unknown): PlayerMediaScope {
  const s = raw as Record<string, unknown> | null
  const name = typeof s?.name === 'string' ? s.name.trim().slice(0, 200) : ''
  if (s?.type === 'all') return { type: 'all' }
  if (s?.type === 'song' && typeof s.trackId === 'string' && /^[a-z]+:.{1,200}$/.test(s.trackId))
    return {
      type: 'song',
      trackId: s.trackId,
      title: name || (typeof s.title === 'string' ? s.title.trim().slice(0, 200) : '') || 'Song'
    }
  if (s?.type === 'artist' && name) return { type: 'artist', name }
  if (s?.type === 'album' && name) {
    const artist = typeof s.artist === 'string' ? s.artist.trim().slice(0, 200) : ''
    return artist ? { type: 'album', name, artist } : { type: 'album', name }
  }
  throw new Error('Choose every song, a song, an artist, or an album.')
}

export function registerPlayerMedia(opts: {
  db: Db
  userDataDir: string
  getWebContents(): WebContents | undefined
}): { dispose(): void } {
  const settings = dbSettingsStore(opts.db)
  const dir = join(opts.userDataDir, 'player-media')

  const read = (): PlayerMedia[] => {
    try {
      const v = JSON.parse(settings.get(KEY) ?? '[]') as PlayerMedia[]
      return Array.isArray(v) ? v.filter((m) => ID.test(m?.id)) : []
    } catch {
      return []
    }
  }
  const write = (list: PlayerMedia[]): PlayerMedia[] => {
    settings.set(KEY, JSON.stringify(list))
    emit(opts.getWebContents(), 'player:changed', list)
    return list
  }

  handle('player:list', () => read())
  handle('player:add', async (scope) => {
    const clean = validateScope(scope)
    const wc = opts.getWebContents()
    const win = wc ? BrowserWindow.fromWebContents(wc) : null
    const options: Electron.OpenDialogOptions = {
      title: 'Add pictures or videos',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Pictures and videos', extensions: [...PLAYER_IMAGE_EXTS, ...PLAYER_VIDEO_EXTS] }
      ]
    }
    const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (r.canceled || r.filePaths.length === 0) return read()
    await mkdir(dir, { recursive: true })
    const added: PlayerMedia[] = []
    for (const path of r.filePaths) {
      const ext = extname(path).slice(1).toLowerCase()
      const video = (PLAYER_VIDEO_EXTS as readonly string[]).includes(ext)
      if (!video && !(PLAYER_IMAGE_EXTS as readonly string[]).includes(ext)) continue
      const { size } = await stat(path)
      if (size > MAX_FILE_BYTES) throw new Error(`${basename(path)} is over 2 GB.`)
      const id = randomBytes(20).toString('hex')
      await copyFile(path, join(dir, `${id}.${ext}`))
      added.push({
        id,
        kind: video ? 'video' : 'image',
        ext,
        name: basename(path),
        size,
        scope: clean,
        addedAt: Date.now()
      })
    }
    return write([...read(), ...added])
  })
  handle('player:remove', async (id) => {
    const list = read()
    const item = list.find((m) => m.id === id)
    if (!item) return list
    await rm(join(dir, `${item.id}.${item.ext}`), { force: true })
    return write(list.filter((m) => m.id !== id))
  })
  handle('player:setScope', (id, scope) => {
    const clean = validateScope(scope)
    return write(read().map((m) => (m.id === id ? { ...m, scope: clean } : m)))
  })

  return {
    dispose() {
      for (const c of CHANNELS) ipcMain.removeHandler(c)
    }
  }
}
