import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LastfmStatus } from '@shared/lastfm'
import type { Track } from '@shared/types'
import type { SecretBox, SettingsStore } from '../spotify/tokens'
import { createLastfm, type LastfmDeps } from './service'

const track = (provider: Track['provider'] = 'soundcloud', durationMs = 200_000): Track =>
  ({
    id: `${provider}:1`,
    provider,
    nativeId: '1',
    title: 'Glasshouse',
    artists: ['Neon Harbor'],
    durationMs
  }) as Track

type Reply = Record<string, unknown> | Error
let replies: Reply[]
let requests: { method: string; params: URLSearchParams; http: string }[]
let store: Map<string, string>
let opened: string[]
let statuses: LastfmStatus[]
let timers: { fn: () => void; ms: number }[]
let now: number

const box: SecretBox = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(`enc:${s}`),
  decryptString: (b) => b.toString().replace(/^enc:/, '')
}

function deps(): LastfmDeps {
  const settings: SettingsStore = {
    get: (k) => store.get(k),
    set: (k, v) => void store.set(k, v),
    delete: (k) => void store.delete(k)
  }
  return {
    settings,
    box,
    fetch: vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      const http = init?.method ?? 'GET'
      const params = new URLSearchParams(http === 'GET' ? url.split('?')[1] : init!.body)
      requests.push({ method: params.get('method')!, params, http })
      const r = replies.shift() ?? {}
      if (r instanceof Error) throw r
      return { json: async () => r } as Response
    }) as unknown as typeof fetch,
    openExternal: (url) => void opened.push(url),
    now: () => now,
    setTimeout: (fn, ms) => {
      timers.push({ fn, ms })
      return timers.length
    },
    clearTimeout: () => undefined,
    onStatus: (s) => void statuses.push(s)
  }
}
const KEY = '0123456789abcdef0123456789abKEY9'
const SECRET = 'f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0'
const runTimers = async (): Promise<void> => {
  const t = timers.splice(0)
  for (const { fn } of t) fn()
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

beforeEach(() => {
  replies = []
  requests = []
  store = new Map()
  opened = []
  statuses = []
  timers = []
  now = 2_000_000_000_000
})

async function connected(): Promise<ReturnType<typeof createLastfm>> {
  const lf = createLastfm(deps())
  lf.setKeys(KEY, SECRET)
  replies.push(
    { token: 'tok' },
    { error: 14, message: 'not yet' },
    { session: { name: 'tripp', key: 'SK' } }
  )
  await lf.connect()
  await runTimers()
  await runTimers()
  return lf
}

describe('Last.fm service', () => {
  it('stores the secret encrypted and shows only the key hint', () => {
    const lf = createLastfm(deps())
    lf.setKeys(KEY, SECRET)
    expect(lf.status()).toMatchObject({ hasKeys: true, keyHint: 'KEY9', state: 'disconnected' })
    expect([...store.values()].join()).not.toContain(SECRET)
  })

  it('connects with the desktop flow: token, browser approval, session (polls while pending)', async () => {
    const lf = await connected()
    expect(opened).toEqual([`https://www.last.fm/api/auth/?api_key=${KEY}&token=tok`])
    expect(requests.map((r) => r.method)).toEqual([
      'auth.getToken',
      'auth.getSession',
      'auth.getSession'
    ])
    expect(requests[1]!.params.get('api_sig')).toMatch(/^[0-9a-f]{32}$/)
    expect(lf.status()).toMatchObject({ state: 'connected', username: 'tripp' })
  })

  it('scrobbles in a batch and empties the waiting list', async () => {
    const lf = await connected()
    replies.push({ scrobbles: { '@attr': { accepted: 1, ignored: 0 } } })
    await lf.scrobble({ track: track(), startedAt: now - 120_000 })
    const r = requests.at(-1)!
    expect(r.http).toBe('POST')
    expect(r.method).toBe('track.scrobble')
    expect(r.params.get('artist[0]')).toBe('Neon Harbor')
    expect(r.params.get('sk')).toBe('SK')
    expect(lf.status().pending).toBe(0)
  })

  it('keeps scrobbles and retries later when Last.fm is down or unreachable', async () => {
    const lf = await connected()
    replies.push({ error: 11, message: 'offline' })
    await lf.scrobble({ track: track(), startedAt: now })
    expect(lf.status().pending).toBe(1)
    replies.push(new Error('network'))
    await runTimers()
    expect(lf.status().pending).toBe(1)
    replies.push({ scrobbles: {} })
    await runTimers()
    expect(lf.status().pending).toBe(0)
  })

  it('a revoked session asks to log in again and keeps the waiting list', async () => {
    const lf = await connected()
    replies.push({ error: 9, message: 'Invalid session key' })
    await lf.scrobble({ track: track(), startedAt: now })
    expect(lf.status()).toMatchObject({ state: 'expired', pending: 1 })
  })

  it('drops scrobbles Last.fm rejects for good', async () => {
    const lf = await connected()
    replies.push({ error: 13, message: 'Invalid signature' })
    await lf.scrobble({ track: track(), startedAt: now })
    expect(lf.status().pending).toBe(0)
    expect(lf.status().error).toMatch(/signature/i)
  })

  it('skips Spotify unless turned on, and sends now playing without retrying', async () => {
    const lf = await connected()
    const before = requests.length
    await lf.scrobble({ track: track('spotify'), startedAt: now })
    await lf.nowPlaying(track('spotify'))
    expect(requests.length).toBe(before)
    lf.setScrobbleSpotify(true)
    replies.push(new Error('network'))
    await lf.nowPlaying(track('spotify'))
    expect(requests.at(-1)!.method).toBe('track.updateNowPlaying')
    expect(timers).toEqual([])
  })

  it('collects scrobbles while not connected and sends them once connected', async () => {
    const lf = createLastfm(deps())
    lf.setKeys(KEY, SECRET)
    await lf.scrobble({ track: track(), startedAt: now })
    expect(lf.status().pending).toBe(1)
    replies.push({ token: 'tok' }, { session: { name: 'tripp', key: 'SK' } }, { scrobbles: {} })
    await lf.connect()
    await runTimers()
    expect(lf.status()).toMatchObject({ state: 'connected', pending: 0 })
  })
})
