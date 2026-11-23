import type { JamUnplayable } from './jam'
import { DEFAULT_CUSTOM_THEME, type CustomTheme } from './theme'
/** App keys. Per app, not per user. Never sent to the renderer. */
export interface AppKeys {
  spotifyClientId: string
  soundcloudClientId: string
  soundcloudClientSecret: string
  discordAppId: string
  /** Built-in Jam relay URL (DEFAULT_JAM_RELAY_URL unless .env/config.json override it). */
  jamRelayUrl: string
}

/** What the renderer may know about config: which features have keys, never the keys. */
export interface PublicConfig {
  hasSpotifyKey: boolean
  hasSoundCloudOfficialKeys: boolean
  hasDiscordKey: boolean
  /** The built-in Jam relay URL (used when Settings → Jam leaves it empty). Not a secret. */
  defaultJamRelayUrl: string
}

export function toPublicConfig(keys: AppKeys): PublicConfig {
  return {
    hasSpotifyKey: keys.spotifyClientId !== '',
    hasSoundCloudOfficialKeys: keys.soundcloudClientId !== '' && keys.soundcloudClientSecret !== '',
    hasDiscordKey: keys.discordAppId !== '',
    defaultJamRelayUrl: keys.jamRelayUrl
  }
}

/** Window look: artwork-coloured glass, or fixed dark / light glass. */
export type Theme = 'artwork' | 'dark' | 'light' | 'custom'
export const THEMES: readonly Theme[] = ['artwork', 'dark', 'light', 'custom']

/** What the preload reads before the first paint. */
export interface BootTheme {
  theme: Theme
  /** Set when the theme is 'custom'. */
  custom?: CustomTheme
}

/**
 * Synchronous preload-only channel: the saved theme, read before the first paint.
 * Not part of the renderer's IPC allowlists; the renderer gets it as `window.boot`.
 */
export const BOOT_THEME_CHANNEL = 'prefs:bootTheme'

/** Mini player look (QoL 4): the full player, or only a lyric bar. */
export type MiniLayout = 'player' | 'lyrics'
export const MINI_LAYOUTS: readonly MiniLayout[] = ['player', 'lyrics']
/** What the mini player shows. */
export interface MiniParts {
  art: boolean
  /** The current lyric line (in place of the artist in the player layout). */
  lyric: boolean
  controls: boolean
  progress: boolean
}
export const DEFAULT_MINI_PARTS: MiniParts = {
  art: true,
  lyric: true,
  controls: true,
  progress: true
}

/** Tabs of the right-hand panel. */
export type PanelTab = 'queue' | 'details' | 'jam'
export const PANEL_TABS: readonly PanelTab[] = ['queue', 'details', 'jam']

/** App behaviour toggles kept in the settings table (QoL round 2). */
export interface AppPrefs {
  /** Closing the main window hides it to the tray instead of quitting. */
  closeToTray: boolean
  /** New SoundCloud likes are downloaded in the background. */
  autoDownloadLikes: boolean
  /** Tidy SoundCloud archive titles ("Artist - Title" uploads); QoL 4. */
  tidyScTitles: boolean
  /** Local files' own covers on Discord, through Unison's relay (QoL 4). */
  discordLocalArt: boolean
  miniLayout: MiniLayout
  miniParts: MiniParts
  /** Jam relay base URL (https://…). Empty = use the built-in relay. */
  jamRelayUrl: string
  /** Name shown to others in a Jam. */
  jamName: string
  /** What happens when you can't play a Jam track (and, as host, whether adding is blocked). */
  jamUnplayable: JamUnplayable
  /** Glass UI theme. */
  theme: Theme
  /** Your own colours, background, glass and font (used when theme is 'custom'). */
  customTheme: CustomTheme
  /** Whole-app zoom below the title bar, 0.7-1.5. */
  zoom: number
  /** Sidebar width in px; 72 is the icon rail. */
  sidebarWidth: number
  rightPanelWidth: number
  /** Last tab used in the right panel. */
  rightPanelTab: PanelTab
}

export const DEFAULT_APP_PREFS: AppPrefs = {
  closeToTray: true,
  autoDownloadLikes: false,
  tidyScTitles: true,
  discordLocalArt: true,
  miniLayout: 'player',
  miniParts: DEFAULT_MINI_PARTS,
  jamRelayUrl: '',
  jamName: '',
  jamUnplayable: 'match',
  theme: 'artwork',
  customTheme: DEFAULT_CUSTOM_THEME,
  zoom: 1,
  sidebarWidth: 280,
  rightPanelWidth: 320,
  rightPanelTab: 'queue'
}
