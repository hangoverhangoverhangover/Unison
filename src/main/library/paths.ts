import { createHash } from 'crypto'
import { extname, relative, resolve, isAbsolute } from 'path'
import { AUDIO_EXTENSIONS } from '@shared/library'

const audioExts: ReadonlySet<string> = new Set(AUDIO_EXTENSIONS)

/** Absolute path used for identity and comparisons: resolved, lowercased on Windows. */
export function normalizePath(p: string, platform: NodeJS.Platform = process.platform): string {
  const abs = resolve(p)
  return platform === 'win32' ? abs.toLowerCase() : abs
}

/** Stable local track id: sha1 hex of the normalized absolute path. */
export function nativeIdForPath(p: string, platform: NodeJS.Platform = process.platform): string {
  return createHash('sha1').update(normalizePath(p, platform)).digest('hex')
}

export function isAudioFile(p: string): boolean {
  return audioExts.has(extname(p).toLowerCase())
}

/** True when `child` is `parent` or anywhere inside it. */
export function isUnder(
  child: string,
  parent: string,
  platform: NodeJS.Platform = process.platform
): boolean {
  const rel = relative(normalizePath(parent, platform), normalizePath(child, platform))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * Add a folder to the watched list. Duplicates and folders inside an already
 * watched folder are ignored; watched folders inside the new one are dropped.
 * Returns the (possibly unchanged) list.
 */
export function addFolderTo(
  folders: readonly string[],
  folder: string,
  platform: NodeJS.Platform = process.platform
): string[] {
  const abs = resolve(folder)
  if (folders.some((f) => isUnder(abs, f, platform))) return [...folders]
  return [...folders.filter((f) => !isUnder(f, abs, platform)), abs]
}

export function removeFolderFrom(
  folders: readonly string[],
  folder: string,
  platform: NodeJS.Platform = process.platform
): string[] {
  const key = normalizePath(folder, platform)
  return folders.filter((f) => normalizePath(f, platform) !== key)
}
