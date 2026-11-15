// Local file tag editor (QoL round 2): IPC handlers around the tag service.
import { existsSync } from 'fs'
import { BrowserWindow, dialog, ipcMain, type WebContents } from 'electron'
import { join } from 'path'
import type { InvokeChannel } from '@shared/ipc'
import type { Db } from '../db'
import { defaultSpawn, type SpawnFn } from '../downloads/process'
import { FFMPEG_EXE } from '../downloads/tools'
import { emit, handle } from '../ipc'
import { CoverTokens, pickCover, TAG_COVER_EXTENSIONS } from './cover'
import { createTagService } from './service'
import { writeTags } from './writer'

const CHANNELS: InvokeChannel[] = [
  'tags:edit',
  'tags:pickCover',
  'tags:proposeFromFilenames',
  'tags:applyProposals'
]

export interface TagsOptions {
  db: Db
  userDataDir: string
  /** Where the app ships ffmpeg.exe (resources/bin packaged, <project>/bin in dev). */
  bundledBinDir: string
  getWebContents: () => WebContents | undefined
  spawn?: SpawnFn
  /** Native image picker for cover art; null = cancelled. Default: an open dialog. */
  pickCoverFile?: () => Promise<string | null>
}

async function defaultPickCover(
  getWebContents: () => WebContents | undefined
): Promise<string | null> {
  const wc = getWebContents()
  const win = wc ? BrowserWindow.fromWebContents(wc) : null
  const options: Electron.OpenDialogOptions = {
    title: 'Choose cover art',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: [...TAG_COVER_EXTENSIONS] }]
  }
  const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  return r.canceled ? null : (r.filePaths[0] ?? null)
}

/**
 * The downloader copies ffmpeg into userData/bin; use that copy, or the bundled one if the
 * copy isn't there (yet).
 */
export function findFfmpeg(userDataDir: string, bundledBinDir: string): string | undefined {
  for (const p of [join(userDataDir, 'bin', FFMPEG_EXE), join(bundledBinDir, FFMPEG_EXE)]) {
    if (existsSync(p)) return p
  }
  return undefined
}

export function registerTags(opts: TagsOptions): { dispose(): void } {
  const spawn = opts.spawn ?? defaultSpawn
  const tokens = new CoverTokens()
  const pick = opts.pickCoverFile ?? (() => defaultPickCover(opts.getWebContents))
  const service = createTagService({
    db: opts.db,
    artworkDir: join(opts.userDataDir, 'artwork'),
    write: async (path, edit) => {
      const ffmpegPath = findFfmpeg(opts.userDataDir, opts.bundledBinDir)
      if (!ffmpegPath) throw new Error("ffmpeg isn't installed, so tags can't be written")
      await writeTags(path, edit, { ffmpegPath, spawn })
    },
    resolveCover: (token) => tokens.resolve(token),
    onLibraryChanged: () => emit(opts.getWebContents(), 'library:changed', null)
  })

  handle('tags:edit', (trackIds, edit) => service.edit(trackIds, edit))
  handle('tags:pickCover', () => pickCover({ pick, tokens }))
  handle('tags:proposeFromFilenames', (trackIds) => service.proposeFromFilenames(trackIds))
  handle('tags:applyProposals', (proposals) => service.applyProposals(proposals))

  return {
    dispose() {
      service.dispose()
      tokens.clear()
      for (const channel of CHANNELS) ipcMain.removeHandler(channel)
    }
  }
}
