// discord:* IPC handlers: Rich Presence for the current track (Phase 6).
import type { WebContents } from 'electron'
import type { AppKeys } from '@shared/config'
import type { Db } from '../db'
import { emit, handle } from '../ipc'
import { createRpcClient } from './client'
import { createCoverArtLookup, type ArtFallback, type CoverArtLookup } from './coverArt'
import { withLocalArt } from './localArt'
import type { RelayArt } from './relayArt'
import { createPresence, type Presence, type RpcClientFactory } from './presence'
import { readEnabled, writeEnabled } from './settings'

export { toActivity } from './activity'
export { createPresence, type Presence, type RpcClient } from './presence'
export { ENABLED_KEY, readEnabled, writeEnabled } from './settings'

export interface DiscordOptions {
  db: Db
  keys: Pick<AppKeys, 'discordAppId'>
  getWebContents(): WebContents | undefined
  /** For tests; defaults to the real @xhayper/discord-rpc client. */
  clientFactory?: RpcClientFactory
  /** App version for the MusicBrainz User-Agent. */
  appVersion: string
  /** For tests; defaults to MusicBrainz + Cover Art Archive, then `artFallbacks`. */
  coverArt?: CoverArtLookup
  /** Service searches tried when MusicBrainz has no cover (Spotify, SoundCloud). */
  artFallbacks?: ArtFallback[]
  /** Local files' own covers through the relay (QoL 4). */
  relayArt?: RelayArt
}

export function registerDiscord(opts: DiscordOptions): {
  presence: Presence
  dispose(): Promise<void>
} {
  const presence = createPresence({
    appId: opts.keys.discordAppId,
    enabled: readEnabled(opts.db),
    clientFactory: opts.clientFactory ?? createRpcClient,
    onStatus: (status) => emit(opts.getWebContents(), 'discord:status', status),
    log: (message, err) => (err === undefined ? console.log(message) : console.warn(message, err))
  })

  const coverArt =
    opts.coverArt ??
    createCoverArtLookup({
      db: opts.db,
      // MusicBrainz asks for an identifying User-Agent; no personal contact details.
      userAgent: `CombinedPlayer/${opts.appVersion} ( personal desktop music player )`,
      fallbacks: opts.artFallbacks ?? [],
      log: (message, err) => (err === undefined ? console.log(message) : console.warn(message, err))
    })
  const send = withLocalArt(coverArt, (update) => presence.update(update), opts.relayArt)

  handle('discord:update', (update) => send(update))
  handle('discord:getStatus', () => presence.getStatus())
  handle('discord:setEnabled', (enabled) => {
    const on = enabled === true
    writeEnabled(opts.db, on)
    return presence.setEnabled(on)
  })

  return { presence, dispose: () => presence.dispose() }
}
