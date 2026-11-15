import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppKeys } from '@shared/config'
import { toPublicConfig } from '@shared/config'
import { loadConfig } from './config'

const defaults: AppKeys = {
  spotifyClientId: 'env-spotify',
  soundcloudClientId: '',
  soundcloudClientSecret: '',
  discordAppId: 'env-discord',
  jamRelayUrl: 'https://relay.example'
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cfg-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('loadConfig', () => {
  it('returns .env defaults when config.json is missing', () => {
    expect(loadConfig(dir, defaults)).toEqual(defaults)
  })

  it('lets non-empty config.json values override defaults', () => {
    writeFileSync(
      join(dir, 'config.json'),
      JSON.stringify({ SPOTIFY_CLIENT_ID: 'file-spotify', SOUNDCLOUD_CLIENT_ID: 'file-sc' })
    )
    expect(loadConfig(dir, defaults)).toEqual({
      ...defaults,
      spotifyClientId: 'file-spotify',
      soundcloudClientId: 'file-sc'
    })
  })

  it('ignores blank and non-string values', () => {
    writeFileSync(
      join(dir, 'config.json'),
      JSON.stringify({ SPOTIFY_CLIENT_ID: '  ', DISCORD_APP_ID: 5 })
    )
    expect(loadConfig(dir, defaults)).toEqual(defaults)
  })

  it('tolerates a BOM and falls back on malformed JSON', () => {
    writeFileSync(join(dir, 'config.json'), '\uFEFF{"DISCORD_APP_ID":"bom"}')
    expect(loadConfig(dir, defaults).discordAppId).toBe('bom')

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    writeFileSync(join(dir, 'config.json'), '{ nope')
    expect(loadConfig(dir, defaults)).toEqual(defaults)
    warn.mockRestore()
  })
})

describe('toPublicConfig', () => {
  it('exposes only which keys exist, plus the (non-secret) built-in Jam relay URL', () => {
    expect(toPublicConfig(defaults)).toEqual({
      hasSpotifyKey: true,
      hasSoundCloudOfficialKeys: false,
      hasDiscordKey: true,
      defaultJamRelayUrl: 'https://relay.example'
    })
  })
})
