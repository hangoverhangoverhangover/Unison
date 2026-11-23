// Cover art for Discord (QoL 4). Discord only shows images from a public https URL, so
// the app uploads a small copy of a local file's embedded cover here and gives Discord
// https://<relay>/art/<id>. Each image lives in its own Durable Object under a random,
// unguessable id, is deleted by the app when the song changes, and expires by itself.
// Guards so this isn't a free image host: JPEG/PNG only, 64 KB max, short life,
// a per-IP upload limit, and ids can't be listed.
import { DurableObject } from 'cloudflare:workers'

export const ART_MAX_BYTES = 64 * 1024
/** Expires this long after upload (the app deletes it sooner, on the next song). */
export const ART_TTL_MS = 2 * 60 * 60 * 1000
/** Uploads per IP per minute (a song change is one upload). */
export const ART_UPLOADS_PER_MIN = 20

const ID = /^[0-9a-f]{32}$/

function hex(bytes: number): string {
  const b = new Uint8Array(bytes)
  crypto.getRandomValues(b)
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
}

/** JPEG or PNG by its first bytes (the Content-Type header isn't trusted). */
export function imageType(b: Uint8Array): 'image/jpeg' | 'image/png' | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  return null
}

interface ArtRecord {
  type: string
  secret: string
  expiresAt: number
  bytes: ArrayBuffer
}

export class ArtStore extends DurableObject<Env> {
  async put(bytes: ArrayBuffer, type: string, secret: string): Promise<void> {
    const rec: ArtRecord = { type, secret, expiresAt: Date.now() + ART_TTL_MS, bytes }
    await this.ctx.storage.put('art', rec)
    await this.ctx.storage.setAlarm(rec.expiresAt)
  }

  async read(): Promise<{ type: string; bytes: ArrayBuffer } | null> {
    const rec = await this.ctx.storage.get<ArtRecord>('art')
    if (!rec || rec.expiresAt <= Date.now()) return null
    return { type: rec.type, bytes: rec.bytes }
  }

  /** True when the secret matched and it's gone. */
  async remove(secret: string): Promise<boolean> {
    const rec = await this.ctx.storage.get<ArtRecord>('art')
    if (!rec || rec.secret !== secret) return false
    await this.ctx.storage.deleteAll()
    return true
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll()
  }
}

/** Best-effort per-IP limit (per Worker instance, which is enough to stop a flood). */
const uploads = new Map<string, number[]>()
function allowed(ip: string, now: number): boolean {
  const recent = (uploads.get(ip) ?? []).filter((t) => now - t < 60_000)
  if (recent.length >= ART_UPLOADS_PER_MIN) {
    uploads.set(ip, recent)
    return false
  }
  recent.push(now)
  uploads.set(ip, recent)
  if (uploads.size > 5000) uploads.clear()
  return true
}

const text = (body: string, status: number): Response =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })

/** Handles /art and /art/<id>; null for any other path. */
export async function handleArt(
  request: Request,
  env: Env,
  path: string
): Promise<Response | null> {
  if (path === '/art') {
    if (request.method !== 'POST') return text('Use POST.', 405)
    if (!allowed(request.headers.get('CF-Connecting-IP') ?? 'local', Date.now()))
      return text('Too many uploads. Try again in a minute.', 429)
    const declared = Number(request.headers.get('Content-Length') ?? '0')
    if (declared > ART_MAX_BYTES) return text('Image too large.', 413)
    const bytes = await request.arrayBuffer()
    if (bytes.byteLength === 0 || bytes.byteLength > ART_MAX_BYTES)
      return text('Image too large or empty.', 413)
    const type = imageType(new Uint8Array(bytes))
    if (!type) return text('Only JPEG or PNG.', 415)
    const id = hex(16)
    const secret = hex(16)
    await env.ART_STORE.getByName(id).put(bytes, type, secret)
    return new Response(JSON.stringify({ id, secret }), {
      status: 201,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    })
  }
  const m = /^\/art\/([0-9a-f]{32})$/.exec(path)
  if (!m) return null
  const id = m[1]!
  if (!ID.test(id)) return text('Not found', 404)
  const store = env.ART_STORE.getByName(id)
  if (request.method === 'GET' || request.method === 'HEAD') {
    const art = await store.read()
    if (!art) return text('Not found', 404)
    return new Response(request.method === 'HEAD' ? null : art.bytes, {
      headers: {
        'Content-Type': art.type,
        'Content-Length': String(art.bytes.byteLength),
        'Cache-Control': 'public, max-age=300'
      }
    })
  }
  if (request.method === 'DELETE') {
    const ok = await store.remove(request.headers.get('X-Art-Secret') ?? '')
    return ok ? new Response(null, { status: 204 }) : text('Not found', 404)
  }
  return text('Method not allowed', 405)
}
