import { createServer } from 'http'
import type { AddressInfo } from 'net'
import { describe, expect, it } from 'vitest'
import { openDb } from '../db'
import { runLoopbackLogin } from './auth'
import {
  DEFAULT_REDIRECT_URI,
  parseRedirectUri,
  readRedirectUri,
  writeRedirectUri
} from './redirect'
import { json, scriptedFetch } from './testing'

describe('Spotify Redirect URI setting', () => {
  it('accepts loopback URIs with any port', () => {
    expect(parseRedirectUri('http://127.0.0.1:8888/callback')).toEqual({
      uri: 'http://127.0.0.1:8888/callback',
      host: '127.0.0.1',
      port: 8888,
      path: '/callback'
    })
    expect(parseRedirectUri(' http://localhost:3000/callback ').port).toBe(3000)
    expect(parseRedirectUri('http://[::1]:4000/cb')).toMatchObject({ host: '::1', path: '/cb' })
  })

  it('rejects URIs without a port, off loopback, or with a query', () => {
    expect(() => parseRedirectUri('http://127.0.0.1/callback')).toThrow(/port/)
    expect(() => parseRedirectUri('https://example.com:8888/callback')).toThrow(/127\.0\.0\.1/)
    expect(() => parseRedirectUri('http://127.0.0.1:8888/callback?x=1')).toThrow(/\?/)
    expect(() => parseRedirectUri('not a url')).toThrow(/web address/)
    expect(() => parseRedirectUri(5)).toThrow()
  })

  it('defaults to :8888, saves, and resets', () => {
    const db = openDb(':memory:')
    expect(readRedirectUri(db)).toBe(DEFAULT_REDIRECT_URI)
    expect(writeRedirectUri(db, 'http://127.0.0.1:3000/callback')).toBe(
      'http://127.0.0.1:3000/callback'
    )
    expect(readRedirectUri(db)).toBe('http://127.0.0.1:3000/callback')
    expect(() => writeRedirectUri(db, 'http://127.0.0.1/callback')).toThrow()
    expect(readRedirectUri(db)).toBe('http://127.0.0.1:3000/callback')
    expect(writeRedirectUri(db, '')).toBe(DEFAULT_REDIRECT_URI)
    expect(readRedirectUri(db)).toBe(DEFAULT_REDIRECT_URI)
  })
})

async function freePort(): Promise<number> {
  const s = createServer()
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r))
  const { port } = s.address() as AddressInfo
  await new Promise((r) => s.close(r))
  return port
}

describe('login on the saved Redirect URI', () => {
  it('listens on its port and path and sends it to Spotify unchanged', async () => {
    const port = await freePort()
    const uri = `http://127.0.0.1:${port}/my-callback`
    let sent = ''
    const tokenFetch = scriptedFetch(() =>
      json({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, scope: '' })
    )
    const tokens = await runLoopbackLogin({
      clientId: 'cid',
      redirectUri: uri,
      fetch: tokenFetch,
      openExternal: async (u) => {
        const url = new URL(u)
        sent = url.searchParams.get('redirect_uri')!
        await fetch(`${sent}?code=c&state=${url.searchParams.get('state')}`)
      }
    })
    expect(tokens.access_token).toBe('at')
    expect(sent).toBe(uri)
    expect(new URLSearchParams(tokenFetch.calls[0]!.body).get('redirect_uri')).toBe(uri)
  })

  it('says which port is taken', async () => {
    const busy = createServer()
    await new Promise<void>((r) => busy.listen(0, '127.0.0.1', r))
    const { port } = busy.address() as AddressInfo
    try {
      await expect(
        runLoopbackLogin({
          clientId: 'cid',
          redirectUri: `http://127.0.0.1:${port}/callback`,
          openExternal: () => undefined
        })
      ).rejects.toThrow(`Port ${port} is in use`)
    } finally {
      await new Promise((r) => busy.close(r))
    }
  })
})
