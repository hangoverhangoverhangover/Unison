// Cover art for the tag editor: check a picked image and hand the renderer a token for it.
// Main keeps the path; the renderer only ever sees the token. No Electron imports.
import { randomBytes } from 'crypto'
import { basename } from 'path'
import type { PickedCover } from '@shared/tags'
import { COVER_MAX_BYTES, COVER_TOO_BIG_MESSAGE, readLimited, sniffImage } from '../playlists/cover'
import type { ReadLimited } from '../playlists/cover'

/** Open-dialog filter. WebP and GIF aren't reliable as embedded art, so only these. */
export const TAG_COVER_EXTENSIONS = ['jpg', 'jpeg', 'png'] as const
export const TAG_COVER_NOT_IMAGE_MESSAGE = "That file isn't a JPEG or PNG image."
export const COVER_EXPIRED_MESSAGE = 'The picked cover image has expired. Pick it again.'

export const COVER_TOKEN_TTL_MS = 30 * 60_000
export const MAX_COVER_TOKENS = 20
/** Larger images get no preview (main can't downscale without extra dependencies). */
export const PREVIEW_MAX_BYTES = 300 * 1024

export type CoverFormat = 'jpg' | 'png'

/** A picked image, resolved from its token. */
export interface CoverImage {
  path: string
  format: CoverFormat
}

const MIME: Record<CoverFormat, string> = { jpg: 'image/jpeg', png: 'image/png' }

/** Read an image (at most 10 MB) and check it really is a JPEG or PNG. */
export async function readCoverImage(
  path: string,
  read: ReadLimited = readLimited
): Promise<{ bytes: Uint8Array; format: CoverFormat }> {
  let bytes: Uint8Array
  try {
    bytes = await read(path, COVER_MAX_BYTES)
  } catch (err) {
    throw new Error(`Couldn't read that image: ${(err as Error).message}`, { cause: err })
  }
  if (bytes.length > COVER_MAX_BYTES) throw new Error(COVER_TOO_BIG_MESSAGE)
  const format = sniffImage(bytes)
  if (format !== 'jpg' && format !== 'png') throw new Error(TAG_COVER_NOT_IMAGE_MESSAGE)
  return { bytes, format }
}

/**
 * Re-check a picked image just before it's written: it may have been replaced or deleted
 * since it was picked.
 */
export async function verifyCoverImage(
  image: CoverImage,
  read: ReadLimited = readLimited
): Promise<void> {
  const { format } = await readCoverImage(image.path, read)
  if (format !== image.format) throw new Error('The picked cover image changed. Pick it again.')
}

interface Entry extends CoverImage {
  expires: number
}

/** Picked images by random token: expire after 30 minutes, at most 20 kept (oldest dropped). */
export class CoverTokens {
  private readonly entries = new Map<string, Entry>()

  constructor(
    private readonly now: () => number = Date.now,
    private readonly random: () => string = () => randomBytes(16).toString('hex')
  ) {}

  add(image: CoverImage): string {
    this.prune()
    const token = this.random()
    this.entries.delete(token)
    this.entries.set(token, { ...image, expires: this.now() + COVER_TOKEN_TTL_MS })
    // Map keeps insertion order, so the first keys are the oldest.
    for (const key of this.entries.keys()) {
      if (this.entries.size <= MAX_COVER_TOKENS) break
      this.entries.delete(key)
    }
    return token
  }

  /** The image behind a token. Throws for unknown or expired tokens. */
  resolve(token: string): CoverImage {
    const entry = this.entries.get(token)
    if (!entry || entry.expires <= this.now()) {
      this.entries.delete(token)
      throw new Error(COVER_EXPIRED_MESSAGE)
    }
    return { path: entry.path, format: entry.format }
  }

  get size(): number {
    return this.entries.size
  }

  clear(): void {
    this.entries.clear()
  }

  private prune(): void {
    const now = this.now()
    for (const [key, entry] of this.entries) if (entry.expires <= now) this.entries.delete(key)
  }
}

export interface PickCoverDeps {
  /** Native image picker; null when cancelled. */
  pick(): Promise<string | null>
  tokens: CoverTokens
  read?: ReadLimited
}

/** tags:pickCover: show the picker, check the image, return a token and a preview. */
export async function pickCover(deps: PickCoverDeps): Promise<PickedCover | null> {
  const path = await deps.pick()
  if (!path) return null
  const { bytes, format } = await readCoverImage(path, deps.read)
  const token = deps.tokens.add({ path, format })
  const previewUrl =
    bytes.length <= PREVIEW_MAX_BYTES
      ? `data:${MIME[format]};base64,${Buffer.from(bytes).toString('base64')}`
      : ''
  return { token, previewUrl, name: basename(path) }
}
