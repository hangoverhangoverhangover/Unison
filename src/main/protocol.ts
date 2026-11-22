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

/** Serves `media://local/<nativeId>` and `media://art/<hash>`. Call after app ready. */
export function registerMediaProtocol(db: Db, userDataDir: string): void {
  const handler = createMediaHandler({
    lookupLocalPath: (nativeId) => getLocalPath(db, nativeId),
    artworkDir: join(userDataDir, 'artwork'),
    playerDir: join(userDataDir, 'player-media')
  })
  protocol.handle(MEDIA_SCHEME, async (req) => withCors(await handler(req)))
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
