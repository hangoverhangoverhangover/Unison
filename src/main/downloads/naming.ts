// Windows-safe file names for downloads.
import { existsSync } from 'fs'
import { extname, join } from 'path'

const MAX_STEM = 180
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i

/**
 * Make a file name safe on Windows: drop `<>:"/\|?*` and control characters, collapse
 * whitespace, trim trailing dots/spaces, avoid reserved device names, cap the length.
 */
export function sanitizeFilename(name: string, max = MAX_STEM): string {
  let out = name
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  // Cap by code points so an emoji isn't split in half.
  const chars = Array.from(out)
  if (chars.length > max) out = chars.slice(0, max).join('')
  out = out.replace(/[. ]+$/, '').replace(/^[ ]+/, '')
  if (!out) out = 'download'
  if (RESERVED.test(out)) out = `_${out}`
  return out
}

const AUDIO_EXT_BY_TYPE: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'audio/aiff': 'aiff',
  'audio/x-aiff': 'aiff',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus'
}

/** Extension (no dot, lowercase) from the provided filename, else the content type, else mp3. */
export function officialExtension(
  filename: string | undefined,
  contentType?: string | null
): string {
  const fromName = filename ? extname(filename).slice(1).toLowerCase() : ''
  if (/^[a-z0-9]{2,5}$/.test(fromName)) return fromName
  const type = (contentType ?? '').split(';')[0]!.trim().toLowerCase()
  return AUDIO_EXT_BY_TYPE[type] ?? 'mp3'
}

/** `<artist> - <title> [<scId>].<ext>`, Windows-safe. */
export function officialFileName(
  artists: readonly string[],
  title: string,
  scId: string,
  ext: string
): string {
  const artist = artists.find((a) => a.trim())?.trim()
  const stem = sanitizeFilename(artist ? `${artist} - ${title}` : title)
  return `${stem} [${scId}].${ext}`
}

/** `folder/name`, or `name (2).ext`, `name (3).ext`... when taken. */
export function uniquePath(
  folder: string,
  name: string,
  exists: (p: string) => boolean = existsSync
): string {
  const ext = extname(name)
  const stem = name.slice(0, name.length - ext.length)
  let candidate = join(folder, name)
  for (let n = 2; exists(candidate) || exists(`${candidate}.part`); n++) {
    candidate = join(folder, `${stem} (${n})${ext}`)
  }
  return candidate
}
