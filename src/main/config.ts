import { readFileSync } from 'fs'
import { join } from 'path'
import type { AppKeys } from '@shared/config'
import { DEFAULT_JAM_RELAY_URL } from '@shared/jam'

/** Build-time defaults, inlined from .env by electron-vite (see envPrefix). */
export function envDefaults(): AppKeys {
  return {
    spotifyClientId: import.meta.env.SPOTIFY_CLIENT_ID ?? '',
    soundcloudClientId: import.meta.env.SOUNDCLOUD_CLIENT_ID ?? '',
    soundcloudClientSecret: import.meta.env.SOUNDCLOUD_CLIENT_SECRET ?? '',
    discordAppId: import.meta.env.DISCORD_APP_ID ?? '',
    jamRelayUrl: import.meta.env.JAM_RELAY_URL || DEFAULT_JAM_RELAY_URL
  }
}

/** Keys in userData/config.json, so keys can be swapped without a rebuild. */
const FILE_KEYS: Record<keyof AppKeys, string> = {
  spotifyClientId: 'SPOTIFY_CLIENT_ID',
  soundcloudClientId: 'SOUNDCLOUD_CLIENT_ID',
  soundcloudClientSecret: 'SOUNDCLOUD_CLIENT_SECRET',
  discordAppId: 'DISCORD_APP_ID',
  jamRelayUrl: 'JAM_RELAY_URL'
}

/**
 * Merge order: .env defaults, then userData/config.json. A key in config.json
 * wins only when it's a non-empty string, so a blank entry can't wipe a default.
 * A missing or malformed config.json is ignored (and logged), never fatal.
 */
export function loadConfig(userDataDir: string, defaults: AppKeys = envDefaults()): AppKeys {
  const keys = { ...defaults }
  let raw: string
  try {
    raw = readFileSync(join(userDataDir, 'config.json'), 'utf8')
  } catch {
    return keys
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.replace(/^\uFEFF/, ''))
  } catch (err) {
    console.warn('[config] config.json is not valid JSON, using .env defaults:', err)
    return keys
  }
  if (typeof parsed !== 'object' || parsed === null) return keys
  const file = parsed as Record<string, unknown>
  for (const field of Object.keys(FILE_KEYS) as (keyof AppKeys)[]) {
    const value = file[FILE_KEYS[field]]
    if (typeof value === 'string' && value.trim() !== '') keys[field] = value.trim()
  }
  return keys
}
