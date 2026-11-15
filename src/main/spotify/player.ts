// Starts playback on the Web Playback SDK device through the Player API.
import { spotifyUri } from '@shared/spotify'
import { SpotifyApiError, type SpotifyApi } from './api'
import { assertSpotifyId } from './provider'

/**
 * Spotify documents no maximum for `uris` on `PUT /me/player/play`. We send at most
 * 100 (the cap other track-list endpoints use) to keep the request small; the
 * renderer's queue owns ordering and starts the next window when this one runs out.
 */
export const MAX_PLAY_URIS = 100

const DEVICE_RE = /^[A-Za-z0-9_-]+$/

/**
 * `PUT /me/player/play?device_id=` with `{ uris, position_ms }`. If Spotify answers 404
 * (`NO_ACTIVE_DEVICE` or "Device not found", e.g. the SDK device isn't active yet),
 * transfer playback to the device with `play: false` and retry once.
 */
export async function play(
  api: SpotifyApi,
  deviceId: string,
  nativeIds: string[],
  positionMs: number
): Promise<void> {
  if (typeof deviceId !== 'string' || !DEVICE_RE.test(deviceId))
    throw new Error('Invalid Spotify device id.')
  if (!Array.isArray(nativeIds) || nativeIds.length === 0)
    throw new Error('Nothing to play: no Spotify tracks given.')
  const ids = nativeIds.slice(0, MAX_PLAY_URIS)
  ids.forEach((id) => assertSpotifyId(id))
  const body = {
    uris: ids.map(spotifyUri),
    position_ms: Math.max(0, Math.floor(Number.isFinite(positionMs) ? positionMs : 0))
  }
  const start = (): Promise<unknown> =>
    api.request('PUT', '/me/player/play', { query: { device_id: deviceId }, body })
  try {
    await start()
  } catch (err) {
    if (!(err instanceof SpotifyApiError) || err.status !== 404) throw err
    // The SDK fires `ready` before Spotify's backend lists the device; wait for it.
    await waitForDevice(api, deviceId)
    await api.request('PUT', '/me/player', { body: { device_ids: [deviceId], play: false } })
    await start()
  }
  prepareDevice(api, deviceId)
}

const preparedDevices = new Set<string>()

/**
 * Once per device: turn off Spotify's own shuffle and repeat. The app's queue sends
 * tracks in its own order; Spotify-side shuffle would reorder them and break the
 * gapless hand-off. Fire-and-forget: a failure only costs gaplessness.
 */
function prepareDevice(api: SpotifyApi, deviceId: string): void {
  if (preparedDevices.has(deviceId)) return
  preparedDevices.add(deviceId)
  const query = { device_id: deviceId }
  void Promise.allSettled([
    api.request('PUT', '/me/player/shuffle', { query: { ...query, state: 'false' } }),
    api.request('PUT', '/me/player/repeat', { query: { ...query, state: 'off' } })
  ])
}

interface DevicesResponse {
  devices?: { id: string | null; name?: string; type?: string; is_active?: boolean }[]
}

/** Poll `GET /me/player/devices` until the SDK device shows up. */
export async function waitForDevice(
  api: SpotifyApi,
  deviceId: string,
  { timeoutMs = 10_000, intervalMs = 750, sleep = defaultSleep } = {}
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let seen: string[]
  for (;;) {
    const res = (await api.request('GET', '/me/player/devices')) as DevicesResponse | undefined
    const devices = res?.devices ?? []
    if (devices.some((d) => d.id === deviceId)) return
    seen = devices.map((d) => `${d.name ?? '?'} (${d.type ?? '?'})`)
    if (Date.now() >= deadline) break
    await sleep(intervalMs)
  }
  console.warn('[spotify] SDK device never appeared. Devices Spotify sees:', seen)
  throw new Error(
    "Spotify can't see this app's player. Close other Spotify apps, restart this app and try again."
  )
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
