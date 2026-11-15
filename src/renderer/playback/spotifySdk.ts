// Spotify Web Playback SDK: a lazy script loader plus minimal types for the parts
// the Spotify backend uses. See docs/research/spotify-playback-widevine.md.
// Nothing here touches the DOM until loadSpotifySdk() is called.

export const SPOTIFY_SDK_URL = 'https://sdk.scdn.co/spotify-player.js'

export interface SpotifyTrackRef {
  uri: string | null
  id: string | null
}

/** WebPlaybackTrack. Only the fields the backend reads; most are guarded as optional. */
export interface SpotifyTrack extends SpotifyTrackRef {
  type?: 'track' | 'episode' | 'ad' | string
  name?: string
  /** Not in the docs' WebPlaybackTrack table; read only as a fallback. */
  duration_ms?: number
  /** Set when Spotify relinked the requested track to a market-specific copy (observed, undocumented). */
  linked_from?: Partial<SpotifyTrackRef> | null
}

/** WebPlaybackState. `duration`, `loading` and `timestamp` are not in the docs' table, so guard them. */
export interface SpotifyPlaybackState {
  paused: boolean
  position: number
  duration?: number
  loading?: boolean
  timestamp?: number
  track_window: {
    current_track: SpotifyTrack | null
    previous_tracks: SpotifyTrack[]
    next_tracks: SpotifyTrack[]
  }
}

export interface SpotifyErrorPayload {
  message: string
}

export interface SpotifyPlayerEvents {
  ready: { device_id: string }
  not_ready: { device_id: string }
  player_state_changed: SpotifyPlaybackState | null
  autoplay_failed: unknown
  initialization_error: SpotifyErrorPayload
  authentication_error: SpotifyErrorPayload
  account_error: SpotifyErrorPayload
  playback_error: SpotifyErrorPayload
}

export type SpotifyPlayerEvent = keyof SpotifyPlayerEvents

export interface SpotifyPlayerOptions {
  name: string
  getOAuthToken: (cb: (token: string) => void) => void
  volume?: number
  enableMediaSession?: boolean
}

export interface SpotifyPlayer {
  connect(): Promise<boolean>
  disconnect(): void
  addListener<E extends SpotifyPlayerEvent>(
    event: E,
    cb: (payload: SpotifyPlayerEvents[E]) => void
  ): boolean
  getCurrentState(): Promise<SpotifyPlaybackState | null>
  setVolume(volume: number): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  seek(positionMs: number): Promise<void>
  activateElement(): Promise<void>
}

export interface SpotifyNamespace {
  Player: new (options: SpotifyPlayerOptions) => SpotifyPlayer
}

type SdkWindow = {
  Spotify?: SpotifyNamespace
  onSpotifyWebPlaybackSDKReady?: () => void
}

/** The DOM bits the loader needs, injectable for tests. */
export interface SdkEnv {
  window: SdkWindow
  document: {
    createElement(tag: 'script'): HTMLScriptElement
    querySelector(selector: string): Element | null
    head: { appendChild(node: HTMLScriptElement): unknown }
  }
}

export const SDK_LOAD_TIMEOUT_MS = 20_000
export const SDK_SCRIPT_ERROR =
  "Couldn't load the Spotify player. Check your internet connection and try again."
export const SDK_TIMEOUT_ERROR = 'The Spotify player took too long to load. Try again.'

function browserEnv(): SdkEnv | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null
  return { window: window as unknown as SdkWindow, document }
}

export type SdkLoader = () => Promise<SpotifyNamespace>

/**
 * Builds a loader that injects the SDK script once and resolves with the global
 * `Spotify` namespace. A failed load is forgotten, so the next call retries.
 */
export function createSdkLoader(
  getEnv: () => SdkEnv | null = browserEnv,
  timeoutMs = SDK_LOAD_TIMEOUT_MS
): SdkLoader {
  let cached: Promise<SpotifyNamespace> | null = null

  const inject = (): Promise<SpotifyNamespace> =>
    new Promise<SpotifyNamespace>((resolve, reject) => {
      const env = getEnv()
      if (!env) {
        reject(new Error('The Spotify player needs a browser window.'))
        return
      }
      const { window: w, document: d } = env
      if (w.Spotify?.Player) {
        resolve(w.Spotify)
        return
      }
      let done = false
      const timer = setTimeout(() => finish(new Error(SDK_TIMEOUT_ERROR)), timeoutMs)
      const finish = (err?: Error): void => {
        if (done) return
        done = true
        clearTimeout(timer)
        if (err) reject(err)
        else if (w.Spotify?.Player) resolve(w.Spotify)
        else reject(new Error(SDK_SCRIPT_ERROR))
      }
      // The SDK calls this global once loaded; it must exist before the script runs.
      const previous = w.onSpotifyWebPlaybackSDKReady
      w.onSpotifyWebPlaybackSDKReady = () => {
        try {
          previous?.()
        } finally {
          finish()
        }
      }
      // A failed earlier attempt leaves its tag behind; replace it.
      const stale = d.querySelector(`script[src="${SPOTIFY_SDK_URL}"]`)
      stale?.remove()
      const script = d.createElement('script')
      script.src = SPOTIFY_SDK_URL
      script.async = true
      script.onerror = () => finish(new Error(SDK_SCRIPT_ERROR))
      d.head.appendChild(script)
    })

  return () => {
    if (!cached) {
      cached = inject().catch((err: unknown) => {
        cached = null
        throw err
      })
    }
    return cached
  }
}

/** The app-wide loader. */
export const loadSpotifySdk: SdkLoader = createSdkLoader()
