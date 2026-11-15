// Validating a TagEdit and turning it into ffmpeg arguments, per container format.
import { extname } from 'path'
import { COVER_FORMATS } from '@shared/tags'
import type { CoverImage } from './cover'

export const MAX_FIELD_LENGTH = 500
const MAX_TRACK_NO = 9999

type TextField = 'title' | 'artist' | 'album' | 'albumArtist' | 'year' | 'genre'
type Field = TextField | 'trackNo'

const TEXT_FIELDS: readonly TextField[] = [
  'title',
  'artist',
  'album',
  'albumArtist',
  'year',
  'genre'
]

/** ffmpeg's generic metadata keys (it maps them to ID3 frames, MP4 atoms, Vorbis comments...). */
const FFMPEG_KEY: Record<Field, string> = {
  title: 'title',
  artist: 'artist',
  album: 'album',
  albumArtist: 'album_artist',
  trackNo: 'track',
  year: 'date',
  genre: 'genre'
}

const FIELD_LABEL: Record<Field, string> = {
  title: 'title',
  artist: 'artist',
  album: 'album',
  albumArtist: 'album artist',
  trackNo: 'track number',
  year: 'year',
  genre: 'genre'
}

interface FormatInfo {
  /** ffmpeg muxer, passed with -f because the temp file has no audio extension. */
  muxer: string
  /** Extra muxer options. */
  extra: readonly string[]
  /** Tags live on the audio stream (Ogg), so they're written there as well. */
  streamTags: boolean
  /** Fields the container can't hold (non-empty values are refused). */
  unsupported: readonly Field[]
  /** RIFF INFO is read back as Latin-1/ANSI by most players, so only ASCII is safe. */
  asciiOnly: boolean
}

const FORMATS: Record<string, FormatInfo> = {
  '.mp3': {
    muxer: 'mp3',
    extra: ['-id3v2_version', '3'],
    streamTags: false,
    unsupported: [],
    asciiOnly: false
  },
  '.m4a': { muxer: 'ipod', extra: [], streamTags: false, unsupported: [], asciiOnly: false },
  '.mp4': { muxer: 'mp4', extra: [], streamTags: false, unsupported: [], asciiOnly: false },
  '.aac': {
    muxer: 'adts',
    extra: ['-write_id3v2', '1'],
    streamTags: false,
    unsupported: [],
    asciiOnly: false
  },
  '.flac': { muxer: 'flac', extra: [], streamTags: false, unsupported: [], asciiOnly: false },
  '.ogg': { muxer: 'ogg', extra: [], streamTags: true, unsupported: [], asciiOnly: false },
  '.opus': { muxer: 'opus', extra: [], streamTags: true, unsupported: [], asciiOnly: false },
  '.wav': {
    muxer: 'wav',
    extra: [],
    streamTags: false,
    unsupported: ['albumArtist'],
    asciiOnly: true
  }
}

export const SUPPORTED_EXTENSIONS: readonly string[] = Object.keys(FORMATS)

export function formatFor(path: string): FormatInfo | undefined {
  return FORMATS[extname(path).toLowerCase()]
}

/**
 * A TagEdit after validation: strings trimmed, '' = clear, null = clear (track number).
 * `cover` is the resolved picked image, or null to remove the embedded cover.
 */
export type NormalizedEdit = Partial<Record<TextField, string>> & {
  trackNo?: number | null
  cover?: CoverImage | null
}

/** Turns a `tags:pickCover` token into the picked image; throws for unknown/expired tokens. */
export type ResolveCover = (token: string) => CoverImage

export const COVER_UNSUPPORTED_MESSAGE = "This file type can't hold cover art."
const MAX_TOKEN_LENGTH = 200

const YEAR = /^\d{4}(-\d{2}(-\d{2})?)?$/

/**
 * Check the shape of an edit from the renderer. Throws on anything malformed, or when the
 * edit changes nothing.
 */
export function normalizeEdit(edit: unknown, resolveCover?: ResolveCover): NormalizedEdit {
  if (typeof edit !== 'object' || edit === null || Array.isArray(edit))
    throw new Error('Invalid tag edit')
  const raw = edit as Record<string, unknown>
  const out: NormalizedEdit = {}
  for (const key of Object.keys(raw)) {
    if (!(TEXT_FIELDS as readonly string[]).includes(key) && key !== 'trackNo' && key !== 'cover')
      throw new Error(`Unknown tag field: ${key}`)
  }
  for (const field of TEXT_FIELDS) {
    const value = raw[field]
    if (value === undefined) continue
    if (typeof value !== 'string') throw new Error(`The ${FIELD_LABEL[field]} must be text`)
    // Control characters (newlines, NUL) don't belong in a tag, and NUL breaks spawn().
    // eslint-disable-next-line no-control-regex
    const clean = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
    if (clean.length > MAX_FIELD_LENGTH)
      throw new Error(`The ${FIELD_LABEL[field]} is too long (max ${MAX_FIELD_LENGTH} characters)`)
    if (field === 'year' && clean !== '' && !YEAR.test(clean))
      throw new Error('The year must look like 2024 (or 2024-05-31)')
    out[field] = clean
  }
  if (raw.trackNo !== undefined) {
    const n = raw.trackNo
    if (n !== null) {
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > MAX_TRACK_NO)
        throw new Error(`The track number must be a whole number from 1 to ${MAX_TRACK_NO}`)
    }
    out.trackNo = n
  }
  if (raw.cover !== undefined) {
    const c = raw.cover
    if (c === null) out.cover = null
    else if (typeof c === 'string' && c.length > 0 && c.length <= MAX_TOKEN_LENGTH) {
      if (!resolveCover) throw new Error("Cover art can't be set here")
      out.cover = resolveCover(c)
    } else throw new Error('Invalid cover image')
  }
  if (Object.keys(out).length === 0) throw new Error('Nothing to change')
  return out
}

/** Why this edit can't be written to this file, or undefined if it can. */
export function checkEditForFile(path: string, edit: NormalizedEdit): string | undefined {
  const format = formatFor(path)
  if (!format) return `Can't write tags to ${extname(path) || 'files without an extension'} files`
  const ext = extname(path).toLowerCase()
  if (edit.cover !== undefined && !(COVER_FORMATS as readonly string[]).includes(ext))
    return COVER_UNSUPPORTED_MESSAGE
  for (const field of format.unsupported) {
    const v = edit[field]
    if (v !== undefined && v !== null && v !== '')
      return `${ext} files can't store the ${FIELD_LABEL[field]}`
  }
  if (format.asciiOnly) {
    for (const field of TEXT_FIELDS) {
      const v = edit[field]
      // eslint-disable-next-line no-control-regex
      if (v && /[^\x00-\x7f]/.test(v))
        return `${ext} tags can only hold plain ASCII text (the ${FIELD_LABEL[field]} has other characters)`
    }
  }
  return undefined
}

/** `key=value` pairs for the edit; an empty value makes ffmpeg drop the key. */
export function metadataPairs(edit: NormalizedEdit, path: string): string[] {
  const unsupported = formatFor(path)?.unsupported ?? []
  const pairs: string[] = []
  for (const field of Object.keys(FFMPEG_KEY) as Field[]) {
    if (unsupported.includes(field)) continue
    const v = edit[field]
    if (v === undefined) continue
    pairs.push(`${FFMPEG_KEY[field]}=${v === null ? '' : String(v)}`)
  }
  return pairs
}

/** The image demuxer, chosen from the sniffed bytes (the extension isn't trusted). */
const IMAGE_DEMUXER: Record<CoverImage['format'], string> = { jpg: 'jpeg_pipe', png: 'png_pipe' }

/**
 * ffmpeg arguments that copy every stream and all existing metadata from `input`, apply the
 * edit, and write `output` in the same container. Cover art: unchanged keeps every stream
 * (old pictures included); a new image replaces the old picture stream(s) with an attached
 * picture; null keeps only the audio, which drops the pictures.
 */
export function buildFfmpegArgs(input: string, output: string, edit: NormalizedEdit): string[] {
  const format = formatFor(input)
  if (!format) throw new Error(`Unsupported file type: ${input}`)
  const ext = extname(input).toLowerCase()
  if (edit.cover !== undefined && !(COVER_FORMATS as readonly string[]).includes(ext))
    throw new Error(COVER_UNSUPPORTED_MESSAGE)
  const args = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-i', input]
  if (edit.cover) {
    args.push('-f', IMAGE_DEMUXER[edit.cover.format], '-i', edit.cover.path)
    args.push('-map', '0:a', '-map', '1', '-c', 'copy', '-map_metadata', '0')
    args.push('-disposition:v:0', 'attached_pic')
    // ID3 APIC and FLAC PICTURE blocks take their picture type from the comment.
    if (ext === '.mp3') args.push('-metadata:s:v', 'title=Album cover')
    if (ext === '.mp3' || ext === '.flac') args.push('-metadata:s:v', 'comment=Cover (front)')
  } else if (edit.cover === null) {
    args.push('-map', '0:a', '-c', 'copy', '-map_metadata', '0')
  } else {
    args.push('-map', '0', '-c', 'copy', '-map_metadata', '0')
  }
  for (const pair of metadataPairs(edit, input)) {
    args.push('-metadata', pair)
    if (format.streamTags) args.push('-metadata:s:a', pair)
  }
  args.push(...format.extra, '-f', format.muxer, output)
  return args
}
