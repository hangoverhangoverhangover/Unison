// Discord Rich Presence contracts (Phase 6). Owned by the main agent.
import type { Provider } from './types'

/** What Discord shows for the current track. Sent by the renderer on meaningful changes only. */
export type PresenceUpdate =
  | {
      state: 'playing'
      track: PresenceTrack
      /** Epoch ms at which position 0 would have played (now - position): the progress bar start. */
      startedAtMs: number
      /** 0 when unknown (then no end timestamp). */
      durationMs: number
    }
  /** Not sent by the renderer since 2026-11-11 (pause clears the presence); main still maps it. */
  | { state: 'paused'; track: PresenceTrack }
  | { state: 'stopped' }

export interface PresenceTrack {
  title: string
  artists: string[]
  album?: string
  provider: Provider
  /** Only https URLs can show in Discord; anything else falls back to the app icon. */
  artworkUrl?: string
  /** The track's https page: Discord links the title to it. */
  url?: string
  /** The first artist's https page: Discord links the artist line to it. */
  artistUrl?: string
}

export type DiscordConnection = 'disabled' | 'connecting' | 'connected' | 'unavailable'

export interface DiscordStatus {
  /** The user's Settings toggle. */
  enabled: boolean
  /** DISCORD_APP_ID is configured. */
  hasKey: boolean
  connection: DiscordConnection
  /** Why it's unavailable (Discord not running, bad app id, ...). */
  error?: string
}

/** Art asset keys uploaded to the Discord application (Rich Presence > Art Assets). */
export const DISCORD_ASSETS = {
  appIcon: 'app_icon',
  spotify: 'spotify',
  soundcloud: 'soundcloud',
  local: 'local'
} as const
