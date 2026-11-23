import { protocol } from 'electron'
import { join } from 'path'
import { MEDIA_SCHEME } from '@shared/library'
import type { Db } from './db'
import { createMediaHandler } from './library/media'
import { getLocalPath } from './library/store'

/** Must run before the app is ready. */
export function registerMediaSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        // The renderer loads media:// audio with crossOrigin="anonymous" so Web Audio
        // (EQ, levelling, crossfade) can read it; that needs CORS on this scheme.
        corsEnabled: true,
        bypassCSP: false
      }
    }
  ])
}

export type MediaHostHandler = (req: Request, id: string) => Promise<Response>
/** Extra media:// hosts served by other modules (e.g. `media://discography/<id>`). */
const hosts = new Map<string, MediaHostHandler>()

/** Serve `media://<host>/<id>` with `handler`, or stop serving it (null). */
export function setMediaHost(host: string, handler: MediaHostHandler | null): void {
  if (handler) hosts.set(host, handler)
  else hosts.delete(host)
}

/** Serves `media://local/<nativeId>` and `media://art/<hash>`. Call after app ready. */
export function registerMediaProtocol(db: Db, userDataDir: string): void {
  const handler = createMediaHandler({
    lookupLocalPath: (nativeId) => getLocalPath(db, nativeId),
    artworkDir: join(userDataDir, 'artwork'),
    playerDir: join(userDataDir, 'player-media')
  })
  protocol.handle(MEDIA_SCHEME, async (req) => {
    const url = new URL(req.url)
    const extra = hosts.get(url.hostname)
    if (extra) {
      let id: string
      try {
        id = decodeURIComponent(url.pathname.replace(/^\/+/, '').replace(/\/+$/, ''))
      } catch {
        return new Response(null, { status: 404 })
      }
      if (!id || id.length > 200 || id.includes('/')) return new Response(null, { status: 404 })
      return withCors(await extra(req, id))
    }
    return withCors(await handler(req))
  })
}

/**
 * Allow cross-origin reads. The renderer's origin (http://localhost in dev, file:// when
 * packaged) differs from media://, and a MediaElementAudioSourceNode outputs silence for
 * cross-origin media that isn't CORS-approved.
 */
export function withCors(res: Response): Response {
  const headers = new Headers(res.headers)
  headers.set('Access-Control-Allow-Origin', '*')
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}
