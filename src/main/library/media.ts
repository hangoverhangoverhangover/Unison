import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import { extname, join } from 'path'
import { Readable } from 'stream'
import { parseRange } from './range'

const AUDIO_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg; codecs=opus',
  '.wav': 'audio/wav'
}

const ART_TYPES: [ext: string, type: string][] = [
  ['jpg', 'image/jpeg'],
  ['png', 'image/png'],
  ['webp', 'image/webp'],
  // Playlist covers only (the scanner never writes gif).
  ['gif', 'image/gif']
]

const SHA1 = /^[0-9a-f]{40}$/

export interface MediaSource {
  /** Real path of a local track, or undefined if the id is unknown. */
  lookupLocalPath(nativeId: string): string | undefined
  artworkDir: string
}

function notFound(): Response {
  return new Response('Not found', { status: 404 })
}

async function fileSize(path: string): Promise<number | null> {
  try {
    const st = await stat(path)
    return st.isFile() ? st.size : null
  } catch {
    return null
  }
}

function body(path: string, start: number, end: number, head: boolean): BodyInit | null {
  if (head || end < start) return null
  return Readable.toWeb(createReadStream(path, { start, end })) as unknown as ReadableStream
}

async function serveAudio(req: Request, path: string): Promise<Response> {
  const size = await fileSize(path)
  if (size === null) return notFound()
  const head = req.method === 'HEAD'
  const headers = new Headers({
    'Content-Type': AUDIO_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache'
  })
  const range = parseRange(req.headers.get('range'), size)
  if (range === 'unsatisfiable') {
    headers.set('Content-Range', `bytes */${size}`)
    return new Response(null, { status: 416, headers })
  }
  if (range === null) {
    headers.set('Content-Length', String(size))
    return new Response(body(path, 0, size - 1, head), { status: 200, headers })
  }
  headers.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`)
  headers.set('Content-Length', String(range.end - range.start + 1))
  return new Response(body(path, range.start, range.end, head), { status: 206, headers })
}

async function serveArt(req: Request, dir: string, hash: string): Promise<Response> {
  for (const [ext, type] of ART_TYPES) {
    const path = join(dir, `${hash}.${ext}`)
    const size = await fileSize(path)
    if (size === null) continue
    const headers = new Headers({
      'Content-Type': type,
      'Content-Length': String(size),
      'Cache-Control': 'public, max-age=31536000, immutable'
    })
    return new Response(body(path, 0, size - 1, req.method === 'HEAD'), { status: 200, headers })
  }
  return notFound()
}

/**
 * Request handler for `media://`. The renderer only ever supplies an id or a
 * hash, both validated as sha1 hex, so no path it sends reaches the filesystem.
 */
export function createMediaHandler(source: MediaSource): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return notFound()
    let url: URL
    try {
      url = new URL(req.url)
    } catch {
      return notFound()
    }
    const id = url.pathname.replace(/^\/+/, '').replace(/\/+$/, '')
    if (!SHA1.test(id)) return notFound()
    if (url.hostname === 'local') {
      const path = source.lookupLocalPath(id)
      return path ? serveAudio(req, path) : notFound()
    }
    if (url.hostname === 'art') return serveArt(req, source.artworkDir, id)
    return notFound()
  }
}
