import { describe, expect, it, vi } from 'vitest'
import { openDb } from '../db'
import { fakeBox, json, memorySettings, scriptedFetch } from './testing'
import {
  dbSettingsStore,
  SpotifyLoginExpiredError,
  SpotifyNotConnectedError,
  TOKENS_KEY,
  TokenStore,
  type SpotifyTokens
} from './tokens'

const NOW = 1_000_000_000
const BASE: SpotifyTokens = {
  refreshToken: 'rt-1',
  accessToken: 'at-1',
  expiresAt: NOW + 3_600_000,
  accountId: 'acc',
  displayName: 'Tripp'
}

function store(opts: Partial<ConstructorParameters<typeof TokenStore>[0]> = {}): TokenStore {
  return new TokenStore({
    clientId: 'cid',
    box: fakeBox(),
    settings: memorySettings(),
    now: () => NOW,
    log: { warn: () => {} },
    ...opts
  })
}

describe('TokenStore persistence', () => {
  it('stores a JSON string of base64 ciphertext, never plaintext, and reloads it', () => {
    const settings = memorySettings()
    store({ settings }).set(BASE)
    const raw = settings.data.get(TOKENS_KEY)!
    expect(typeof JSON.parse(raw)).toBe('string')
    expect(raw).not.toContain('rt-1')
    expect(raw).not.toContain('at-1')
    expect(store({ settings }).get()).toEqual(BASE)
  })

  it('works against the real settings table', () => {
    const db = openDb(':memory:')
    const settings = dbSettingsStore(db)
    const s = store({ settings })
    s.set(BASE)
    s.set({ ...BASE, displayName: 'Again' })
    expect(store({ settings }).get()?.displayName).toBe('Again')
    s.clear()
    expect(settings.get(TOKENS_KEY)).toBeUndefined()
    db.close()
  })

  it('keeps tokens in memory only when encryption is unavailable', () => {
    const settings = memorySettings()
    const warn = vi.fn()
    const s = store({ settings, box: fakeBox(false), log: { warn } })
    s.set(BASE)
    expect(s.get()).toEqual(BASE)
    expect(settings.data.size).toBe(0)
    expect(warn).toHaveBeenCalledOnce()
  })

  it('discards unreadable stored tokens', () => {
    const settings = memorySettings()
    settings.set(TOKENS_KEY, '"garbage"')
    expect(store({ settings }).get()).toBeNull()
    expect(settings.data.size).toBe(0)
  })
})

describe('TokenStore.getAccessToken', () => {
  it('throws not-connected without tokens', async () => {
    await expect(store().getAccessToken()).rejects.toBeInstanceOf(SpotifyNotConnectedError)
  })

  it('returns the cached token when it has more than 60s left', async () => {
    const fetch = scriptedFetch(() => json({}))
    const s = store({ fetch })
    s.set({ ...BASE, expiresAt: NOW + 61_000 })
    await expect(s.getAccessToken()).resolves.toBe('at-1')
    expect(fetch.calls).toHaveLength(0)
  })

  it('refreshes once for concurrent callers and stores a rotated refresh token', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const fetch = scriptedFetch(async () => {
      await gate
      return json({
        access_token: 'at-2',
        expires_in: 3600,
        token_type: 'Bearer',
        refresh_token: 'rt-2'
      })
    })
    const settings = memorySettings()
    const s = store({ fetch, settings })
    s.set({ ...BASE, expiresAt: NOW + 30_000 })
    const all = Promise.all([s.getAccessToken(), s.getAccessToken(), s.refresh()])
    release()
    expect(await all).toEqual(['at-2', 'at-2', 'at-2'])
    expect(fetch.calls).toHaveLength(1)
    expect(s.get()).toMatchObject({
      refreshToken: 'rt-2',
      accessToken: 'at-2',
      expiresAt: NOW + 3_600_000
    })
    expect(store({ settings }).get()?.refreshToken).toBe('rt-2')
  })

  it('keeps the old refresh token when none is returned', async () => {
    const fetch = scriptedFetch(() =>
      json({ access_token: 'at-2', expires_in: 3600, token_type: 'Bearer' })
    )
    const s = store({ fetch })
    s.set({ ...BASE, expiresAt: NOW })
    await s.getAccessToken()
    expect(s.get()?.refreshToken).toBe('rt-1')
  })

  it('clears tokens and reports expiry on 400 invalid_grant', async () => {
    const fetch = scriptedFetch(() =>
      json({ error: 'invalid_grant', error_description: 'Refresh token revoked' }, 400)
    )
    const onExpired = vi.fn()
    const settings = memorySettings()
    const s = store({ fetch, onExpired, settings })
    s.set({ ...BASE, expiresAt: NOW })
    await expect(s.getAccessToken()).rejects.toBeInstanceOf(SpotifyLoginExpiredError)
    expect(onExpired).toHaveBeenCalledOnce()
    expect(s.get()).toBeNull()
    expect(settings.data.size).toBe(0)
  })

  it('keeps tokens on other refresh failures', async () => {
    const fetch = scriptedFetch(() => json({ error: 'server_error' }, 503))
    const onExpired = vi.fn()
    const s = store({ fetch, onExpired })
    s.set({ ...BASE, expiresAt: NOW })
    await expect(s.getAccessToken()).rejects.toThrow(/503/)
    expect(onExpired).not.toHaveBeenCalled()
    expect(s.get()).not.toBeNull()
  })

  it("doesn't resurrect tokens cleared during a refresh", async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const fetch = scriptedFetch(async () => {
      await gate
      return json({ access_token: 'at-2', expires_in: 3600, token_type: 'Bearer' })
    })
    const s = store({ fetch })
    s.set({ ...BASE, expiresAt: NOW })
    const p = s.getAccessToken()
    s.clear()
    release()
    await expect(p).rejects.toBeInstanceOf(SpotifyNotConnectedError)
    expect(s.get()).toBeNull()
  })
})
