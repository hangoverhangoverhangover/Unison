// Maps a PresenceUpdate from the renderer to a Discord Rich Presence activity.
import type { SetActivity } from '@xhayper/discord-rpc'
import type { ActivityType } from 'discord-api-types/v10'
import { DISCORD_ASSETS, type PresenceTrack, type PresenceUpdate } from '@shared/discord'
import type { Provider } from '@shared/types'

/** ActivityType.Listening: "Listening to <app name>". Numeric so nothing loads at runtime. */
const LISTENING = 2 as ActivityType.Listening
/** StatusDisplayType.DETAILS: the member list shows `details` (the song title). */
const STATUS_DISPLAY_DETAILS = 2

/** Discord rejects activity strings shorter than 2 or longer than 128 characters. */
export const MIN_TEXT = 2
export const MAX_TEXT = 128
/** Discord's limit for an image key, which includes external image URLs. */
export const MAX_IMAGE_KEY = 256

const PROVIDER_LABEL: Record<Provider, string> = {
  spotify: 'Spotify',
  soundcloud: 'SoundCloud',
  local: 'Local file'
}

/**
 * Fit a string into Discord's 2-128 character window. One-character strings get a
 * zero-width space so they stay visually unchanged; long ones end in "…".
 */
export function fitText(text: string, fallback: string): string {
  let s = text.trim()
  if (s === '') s = fallback
  if (s.length < MIN_TEXT) return s + '​'
  if (s.length <= MAX_TEXT) return s
  let cut = s.slice(0, MAX_TEXT - 1)
  // Don't leave half a surrogate pair (e.g. a split emoji) before the ellipsis.
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1)
  return cut + '…'
}

/** Remote https artwork Discord can fetch (for local files: looked-up art); else the app icon. */
export function largeImageFor(track: PresenceTrack): string {
  const url = track.artworkUrl
  if (url && url.startsWith('https://') && url.length <= MAX_IMAGE_KEY) {
    return url
  }
  return DISCORD_ASSETS.appIcon
}

/** An https link Discord can open from the activity text, or undefined. */
export function linkFor(url: string | undefined): string | undefined {
  return url && url.startsWith('https://') && url.length <= MAX_IMAGE_KEY ? url : undefined
}

/** The activity to show for an update, or null to clear the presence. */
export function toActivity(update: PresenceUpdate): SetActivity | null {
  if (update.state === 'stopped') return null
  const { track } = update
  const title = fitText(track.title, 'Unknown track')
  const artists = track.artists.map((a) => a.trim()).filter((a) => a !== '')
  const album = track.album?.trim()

  const activity: SetActivity = {
    type: LISTENING,
    statusDisplayType: STATUS_DISPLAY_DETAILS,
    details: title,
    state: fitText(artists.join(', '), 'Unknown artist'),
    largeImageKey: largeImageFor(track),
    largeImageText: album ? fitText(album, title) : title,
    smallImageKey: DISCORD_ASSETS[track.provider],
    smallImageText: update.state === 'paused' ? 'Paused' : PROVIDER_LABEL[track.provider]
  }
  // Clicking the title / artist line opens the track / artist page.
  const detailsUrl = linkFor(track.url)
  if (detailsUrl) activity.detailsUrl = detailsUrl
  const stateUrl = linkFor(track.artistUrl)
  if (stateUrl) activity.stateUrl = stateUrl

  if (update.state === 'playing') {
    activity.startTimestamp = update.startedAtMs
    if (update.durationMs > 0) activity.endTimestamp = update.startedAtMs + update.durationMs
  }
  return activity
}
