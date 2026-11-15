// Custom covers for app playlists: check a picked image file and copy it into the
// artwork cache, where `media://art/<sha1>` serves it. No Electron imports.
import { open } from 'fs/promises'
import { writeArtworkFile } from '../library/scanner'

export const COVER_MAX_BYTES = 10 * 1024 * 1024
/** Open-dialog filter (the bytes are sniffed anyway; see sniffImage). */
export const COVER_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif'] as const

export type CoverExt = 'jpg' | 'png' | 'webp' | 'gif'

export const COVER_TOO_BIG_MESSAGE = 'That image is over 10 MB. Pick a smaller one.'
export const COVER_NOT_IMAGE_MESSAGE = "That file isn't a JPEG, PNG, WebP or GIF image."

const startsWith = (b: Uint8Array, sig: readonly number[], at = 0): boolean =>
  b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v)

const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0))

/** The image type from the first bytes, or null. The file extension is not trusted. */
export function sniffImage(bytes: Uint8Array): CoverExt | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpg'
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png'
  if (startsWith(bytes, ascii('GIF87a')) || startsWith(bytes, ascii('GIF89a'))) return 'gif'
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) return 'webp'
  return null
}

/** Reads at most `max + 1` bytes, so an oversized file is never loaded whole. */
export type ReadLimited = (path: string, max: number) => Promise<Uint8Array>

export const readLimited: ReadLimited = async (path, max) => {
  const fh = await open(path, 'r')
  try {
    const st = await fh.stat()
    if (!st.isFile()) throw new Error("That isn't a file.")
    if (st.size > max) return new Uint8Array(max + 1)
    const buf = Buffer.alloc(max + 1)
    let length = 0
    while (length < buf.length) {
      const { bytesRead } = await fh.read(buf, length, buf.length - length, length)
      if (bytesRead === 0) break
      length += bytesRead
    }
    return buf.subarray(0, length)
  } finally {
    await fh.close()
  }
}

export interface ImportCoverDeps {
  artworkDir: string
  read?: ReadLimited
  write?: (data: Uint8Array, ext: CoverExt, artworkDir: string) => Promise<string>
}

/** Validate the image and copy it to `<artworkDir>/<sha1>.<ext>`; returns the sha1. */
export async function importCover(path: string, deps: ImportCoverDeps): Promise<string> {
  const read = deps.read ?? readLimited
  const write = deps.write ?? writeArtworkFile
  let bytes: Uint8Array
  try {
    bytes = await read(path, COVER_MAX_BYTES)
  } catch (err) {
    throw new Error(`Couldn't read that image: ${(err as Error).message}`, { cause: err })
  }
  if (bytes.length > COVER_MAX_BYTES) throw new Error(COVER_TOO_BIG_MESSAGE)
  const ext = sniffImage(bytes)
  if (!ext) throw new Error(COVER_NOT_IMAGE_MESSAGE)
  return write(bytes, ext, deps.artworkDir)
}
