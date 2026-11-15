// Official (artist-enabled) downloads: stream a URL to `<file>.part`, then rename into place.
import { createWriteStream } from 'fs'
import { rename, rm } from 'fs/promises'
import { Readable, Transform } from 'stream'
import { pipeline } from 'stream/promises'
import type { ReadableStream as WebReadableStream } from 'stream/web'

export type FetchFn = (url: string, init: { signal: AbortSignal }) => Promise<Response>

export interface FetchedHead {
  contentType: string | null
}

/**
 * Download `url` to `dest`. `pickDest` sees the response's content type before anything is
 * written (to choose the extension) and returns the final path; the data goes to
 * `<final>.part` first. Returns the final path.
 */
export async function fetchToFile(opts: {
  fetch: FetchFn
  url: string
  signal: AbortSignal
  pickDest(head: FetchedHead): string
  onProgress(progress: number): void
  /** Called with the .part path once it exists, so a cancel can clean it up. */
  onPartial(path: string): void
}): Promise<string> {
  const res = await opts.fetch(opts.url, { signal: opts.signal })
  if (!res.ok || !res.body) throw new Error(`Official download failed (HTTP ${res.status}).`)
  const dest = opts.pickDest({ contentType: res.headers.get('content-type') })
  const part = `${dest}.part`
  opts.onPartial(part)
  const total = Number(res.headers.get('content-length')) || 0
  let got = 0
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      got += chunk.length
      if (total > 0) opts.onProgress(Math.min(0.99, got / total))
      cb(null, chunk)
    }
  })
  try {
    await pipeline(
      Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>),
      counter,
      createWriteStream(part),
      { signal: opts.signal }
    )
    await rename(part, dest)
  } catch (err) {
    await rm(part, { force: true }).catch(() => undefined)
    throw err
  }
  return dest
}
