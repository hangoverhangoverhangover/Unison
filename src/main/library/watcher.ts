import { watch, type FSWatcher } from 'chokidar'
import { isAudioFile } from './paths'

export interface WatchHandlers {
  onFile: (path: string) => void
  onUnlink: (path: string) => void
  onUnlinkDir: (path: string) => void
}

/** Watch folders for audio file changes. Initial contents are left to the scanner. */
export function watchFolders(
  folders: readonly string[],
  handlers: WatchHandlers
): FSWatcher | null {
  if (folders.length === 0) return null
  const watcher = watch([...folders], {
    ignoreInitial: true,
    // Wait for in-progress copies to settle before reading the file.
    awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 250 },
    ignored: (path, stats) => Boolean(stats?.isFile() && !isAudioFile(path))
  })
  watcher.on('add', (p) => isAudioFile(p) && handlers.onFile(p))
  watcher.on('change', (p) => isAudioFile(p) && handlers.onFile(p))
  watcher.on('unlink', (p) => isAudioFile(p) && handlers.onUnlink(p))
  watcher.on('unlinkDir', (p) => handlers.onUnlinkDir(p))
  watcher.on('error', (err) => console.warn('[library] watcher error:', err))
  return watcher
}
