import type { AppPrefs, PublicConfig } from './config'
import type { LikesSyncStatus, PlaylistPrefs, ScanStatus } from './library'
import type { DiscordStatus, PresenceUpdate } from './discord'
import type { DownloadItem, DownloaderStatus, DownloadProgress } from './downloads'
import type { FindResult, MiniCommand, MiniState } from './match'
import type { JamCapabilities, JamCommand, JamStatus } from './jam'
import type { LastfmStatus, ScrobbleReport } from './lastfm'
import type { LyricsResult } from './lyrics'
import type {
  ListeningStats,
  PlayReport,
  RecentPlay,
  SmartPlaylist,
  SmartPlaylistKind,
  StatsRange
} from './history'
import type { FilenameTagProposal, PickedCover, TagEdit, TagFileResult } from './tags'
import type { DuplicateGroup, TransferPlan, TransferRequest, TransferResult } from './transfer'
import type { AudioSettings, MediaKey, NowPlaying, SessionSnapshot } from './playback'
import type { FeedPage, ScTrackPage, SoundCloudStatus } from './soundcloud'
import type { SpotifyClientIdSetting, SpotifyStatus } from './spotify'
import type { StreamInfo, TrackComment } from './provider'
import type {
  Album,
  AlbumPage,
  Artist,
  ArtistPage,
  LikedTrack,
  Playlist,
  Provider,
  Track
} from './types'

/** Providers reached through a MusicProvider in main (local files go through library:*). */
export type ServiceProvider = Exclude<Provider, 'local'>

/**
 * Typed IPC contract. Every renderer -> main call is listed here; the preload
 * bridge and the main-process handlers are both typed from this map, so a
 * channel can't drift between the two sides.
 */
export interface IpcInvokeMap {
  'app:getInfo': () => AppInfo
  /** Restart the app (e.g. to apply a new Spotify Client ID). */
  'app:relaunch': () => void
  'config:getPublic': () => PublicConfig

  /** Watched music folders, absolute paths. */
  'library:getFolders': () => string[]
  /** Opens a folder picker. Returns the updated list, or null if cancelled. */
  'library:addFolder': () => string[] | null
  'library:removeFolder': (path: string) => string[]
  /** All local tracks, ordered by artist, album, disc, track number, title. */
  'library:getTracks': () => Track[]
  'library:getScanStatus': () => ScanStatus
  'library:rescan': () => void

  // Service-agnostic music calls, routed to the provider's MusicProvider in main.
  'music:search': (provider: ServiceProvider, query: string, page: number) => Track[]
  /** Newest first. */
  'music:getLikes': (provider: ServiceProvider) => LikedTrack[]
  /** Routed by track.provider. Writes to the real service. */
  'music:like': (track: Track) => void
  'music:unlike': (track: Track) => void
  /** Which of these track ids (`provider:nativeId`) are liked. */
  'music:isLiked': (trackIds: string[]) => Record<string, boolean>
  'music:getPlaylists': (provider: ServiceProvider) => Playlist[]
  /** Routed by the playlist id prefix (`spotify:...`). */
  'music:getPlaylistTracks': (playlistId: string) => Track[]
  /** Artist or SoundCloud profile by app id (`spotify:<id>` / `soundcloud:<userId>`). */
  'music:getArtist': (artistId: string) => ArtistPage
  /** Just the artist (no releases or tracks): for the Details panel's "About the artist". */
  'music:getArtistInfo': (artistId: string) => Artist
  /** Album, EP or single by app id. */
  'music:getAlbum': (albumId: string) => AlbumPage
  /** Every track by an artist (see CatalogProvider.getArtistTracks). */
  'music:getArtistTracks': (artistId: string) => Track[]
  /** Artist profiles for a search (CatalogProvider.searchArtists). */
  'music:searchArtists': (provider: ServiceProvider, query: string) => Artist[]
  /**
   * Find this track on a service: ISRC first, then title plus artist. `service` is
   * the one to search (for local files either; otherwise the track's other service).
   */
  'music:findOn': (track: Track, service: ServiceProvider) => FindResult

  /**
   * Main window: the app has a track loaded (playing or paused). While true, main
   * takes the hardware media keys system-wide and forwards them as `media:key`.
   */
  'media:setActive': (active: boolean) => void

  // QoL round 2: session, prefs, tray
  /** Main window: save the queue and position (debounced by the renderer). */
  'session:save': (snapshot: SessionSnapshot) => void
  /** Main window: the last saved session, or null. */
  'session:load': () => SessionSnapshot | null
  'prefs:get': () => AppPrefs
  /** Merge and save; returns the stored prefs. */
  'prefs:set': (patch: Partial<AppPrefs>) => AppPrefs
  'audio:get': () => AudioSettings
  'audio:set': (settings: AudioSettings) => AudioSettings
  /** Main window: what's playing, for the tray tooltip and menu (null when nothing). */
  'tray:nowPlaying': (now: NowPlaying | null) => void

  // QoL round 2: history and stats
  /** Count a play (the renderer decides when a play counts; see PLAY_COUNT_MIN_MS). */
  'history:record': (report: PlayReport) => void
  /** Last.fm (QoL 3): status; keys are kept in main, the secret encrypted. */
  'lastfm:getStatus': () => LastfmStatus
  'lastfm:setKeys': (apiKey: string, secret: string) => LastfmStatus
  /** Opens Last.fm's approval page in the browser; resolves once it's open. */
  'lastfm:connect': () => LastfmStatus
  'lastfm:disconnect': () => LastfmStatus
  'lastfm:setScrobbleSpotify': (on: boolean) => LastfmStatus
  'lastfm:nowPlaying': (track: Track) => void
  'lastfm:scrobble': (report: ScrobbleReport) => void
  /** Lyrics (QoL 3): the user's own, else LRCLIB (cached). */
  'lyrics:get': (track: Track) => LyricsResult
  /** Save the user's own lyrics (LRC with time stamps, or plain text); local only. */
  'lyrics:save': (track: Track, text: string) => LyricsResult
  'lyrics:delete': (track: Track) => LyricsResult
  /** Newest first, one entry per play. */
  'history:recent': (limit: number) => RecentPlay[]
  'history:smart': (kind: SmartPlaylistKind) => SmartPlaylist
  'history:stats': (range: StatsRange) => ListeningStats
  /** Delete all play history. */
  'history:clear': () => void

  // QoL round 2: local tag editor
  /** Write the same edit to each local track (one file or a whole folder's worth). */
  'tags:edit': (trackIds: string[], edit: TagEdit) => TagFileResult[]
  /** Pick an image (jpg/png, up to 10 MB) for `TagEdit.cover`; null when cancelled. */
  'tags:pickCover': () => PickedCover | null
  /** Parse "Artist - Title" from file names; nothing is written. */
  'tags:proposeFromFilenames': (trackIds: string[]) => FilenameTagProposal[]
  /** Write the proposals the user kept. */
  'tags:applyProposals': (proposals: FilenameTagProposal[]) => TagFileResult[]

  // QoL round 2: SoundCloud social (feed works only logged in)
  'soundcloud:getFeed': (cursor?: string) => FeedPage
  /** A profile's reposts (logged out works). */
  'soundcloud:getReposts': (userId: string, cursor?: string) => FeedPage
  /** People you follow, newest first. */
  'soundcloud:getFollowings': () => Artist[]
  /**
   * Artists you follow on Spotify (read-only). Rejects with a readable message when
   * the login predates the user-follow-read permission ("log in again").
   */
  'spotify:getFollowings': () => Artist[]
  'spotify:getClientId': () => SpotifyClientIdSetting
  /** Save ('' clears) the Client ID from Settings; a different ID signs out of Spotify. */
  'spotify:setClientId': (clientId: string) => SpotifyClientIdSetting
  'soundcloud:isFollowing': (userId: string) => boolean
  /** Public action: the renderer confirms first. */
  'soundcloud:setFollowing': (userId: string, follow: boolean) => void
  'soundcloud:isReposted': (trackId: string) => boolean
  /** Public action: the renderer confirms first. */
  'soundcloud:setReposted': (trackId: string, repost: boolean) => void

  // QoL round 2: across services
  /** Match every track of a playlist on the target service (progress: transfer:progress). */
  'transfer:plan': (playlistId: string, target: ServiceProvider) => TransferPlan
  /** Create the playlist on the target with the tracks the user confirmed. */
  'transfer:create': (request: TransferRequest) => TransferResult
  /** Same-song groups across Liked Songs and local files. */
  'duplicates:find': () => DuplicateGroup[]
  /** "Not duplicates": hide this group from future results. */
  'duplicates:dismiss': (key: string) => void

  // Jam (shared listening)
  'jam:getStatus': () => JamStatus
  /** Create a room on the relay (prefs.jamRelayUrl) and join it as host. */
  'jam:start': () => JamStatus
  /** Join a room by code as a guest. */
  'jam:join': (code: string) => JamStatus
  /** Leave (a host leaving ends the Jam for everyone). */
  'jam:leave': () => JamStatus
  /** Send a command; host-only commands from a guest are refused by the relay. */
  'jam:send': (command: JamCommand) => void
  /** Tell the room which services you can play now. */
  'jam:setCapabilities': (canPlay: JamCapabilities) => void

  // Mini player (Phase 8)
  /** Open the mini player, or close it if it's open. Returns whether it's open now. */
  'mini:toggle': () => boolean
  /** Main window: latest playback for the mini player (ignored while it's closed). */
  'mini:publish': (state: MiniState) => void
  /** Mini window: the last published state, or null before any. */
  'mini:getState': () => MiniState | null
  /** Mini window: a control, forwarded to the main window. */
  'mini:command': (command: MiniCommand) => void
  /** Mini window: bring the main window to the front. */
  'mini:showMain': () => void

  /**
   * Every liked service track, newest like first, from the local likes table (instant,
   * works offline). Kept in step with the services by reconcile + music:like/unlike.
   */
  'likes:getAll': () => LikedTrack[]
  'likes:getSyncStatus': () => LikesSyncStatus
  /** Reconcile likes with every connected service now. */
  'likes:sync': () => void

  /** In-app playlists (source 'app'), which may mix Spotify, SoundCloud and local tracks. */
  'playlists:getApp': () => Playlist[]
  'playlists:create': (name: string, tracks?: Track[]) => Playlist
  'playlists:rename': (playlistId: string, name: string) => Playlist
  'playlists:delete': (playlistId: string) => void
  /**
   * Append tracks. `app:` playlists take any track; `spotify:`/`soundcloud:` playlists
   * only that service's tracks and only when `canEdit` (written to the service).
   */
  'playlists:addTracks': (playlistId: string, tracks: Track[]) => void
  /**
   * Remove entries by their index in the list music:getPlaylistTracks returned. Service
   * playlists remove every occurrence of those tracks (the services work by track).
   */
  'playlists:removeAt': (playlistId: string, positions: number[]) => void
  /** Reorder (app playlists only). */
  'playlists:move': (playlistId: string, from: number, to: number) => void
  /**
   * Pick an image (jpg, png, webp, gif; up to 10 MB) as an app playlist's cover.
   * Returns the updated playlist, or null when the dialog is cancelled.
   */
  'playlists:chooseCover': (playlistId: string) => Playlist | null
  /** Back to the automatic cover (from the playlist's tracks). */
  'playlists:clearCover': (playlistId: string) => Playlist
  /** Sidebar order and hidden playlists. */
  'playlists:getPrefs': () => PlaylistPrefs
  /** Replace both; returns them as stored. */
  'playlists:setPrefs': (prefs: PlaylistPrefs) => PlaylistPrefs

  /** Renderer -> main: current track/pause/seek/stop for Discord. No-op when disabled. */
  'discord:update': (update: PresenceUpdate) => void
  'discord:getStatus': () => DiscordStatus
  /** Settings toggle; persisted. Turning it off clears the presence and disconnects. */
  'discord:setEnabled': (enabled: boolean) => DiscordStatus

  'spotify:getStatus': () => SpotifyStatus
  /** Opens the system browser for PKCE login; resolves when done or cancelled. */
  'spotify:login': () => SpotifyStatus
  'spotify:logout': () => SpotifyStatus
  /** Fresh access token for the Web Playback SDK's getOAuthToken. */
  'spotify:getAccessToken': () => string
  /** Start these tracks on the SDK device (transfers playback to it first if needed). */
  'spotify:play': (deviceId: string, nativeIds: string[], positionMs: number) => void

  'soundcloud:getStatus': () => SoundCloudStatus
  /** Opens a soundcloud.com login window; resolves when logged in or the window closes. */
  'soundcloud:login': () => SoundCloudStatus
  'soundcloud:logout': () => SoundCloudStatus
  /**
   * Connect with an `oauth_token` cookie value the user copied from soundcloud.com in
   * their own browser (fallback when the login window is blocked). Rejects if invalid.
   */
  'soundcloud:loginWithToken': (token: string) => SoundCloudStatus
  /**
   * A fresh, playable stream URL for this track (signed URLs expire; call again on
   * a 403). Rejects with a readable message for preview-only, blocked or DRM tracks.
   */
  'soundcloud:getStream': (nativeId: string) => StreamInfo
  /** Waveform peaks scaled to 0..1 (about 1800 samples); empty when the track has none. */
  'soundcloud:getWaveform': (nativeId: string) => number[]
  /** Timed comments, earliest position first; replies sit under their parent. */
  'soundcloud:getComments': (nativeId: string) => TrackComment[]
  /** Playlists and albums matching a search (SoundCloudProvider.searchSets). Works logged out. */
  'soundcloud:searchSets': (query: string) => Album[]
  /** The track's page details (description, stats, uploader). Works logged out. */
  'soundcloud:getTrackPage': (nativeId: string) => ScTrackPage
  /**
   * Post a public timed comment. The app can't take it back, so the renderer must
   * confirm with the user first. Needs a SoundCloud login.
   */
  'soundcloud:postComment': (nativeId: string, body: string, timestampMs: number) => TrackComment

  // Downloader (Phase 7)
  'downloads:getStatus': () => DownloaderStatus
  /** Queue, active first, then history newest first. */
  'downloads:list': () => DownloadItem[]
  /**
   * Queue a SoundCloud track. Returns the existing item instead when the track is
   * already queued, running, or downloaded with its file still on disk.
   */
  'downloads:enqueue': (track: Track) => DownloadItem
  /** Queue many (Download all). Same rules per track; returns one item per track. */
  'downloads:enqueueMany': (tracks: Track[]) => DownloadItem[]
  /** Re-queue a failed download. */
  'downloads:retry': (id: number) => DownloadItem
  /** Stop a queued or running download; it ends as failed ("Cancelled"). */
  'downloads:cancel': (id: number) => void
  /** Drop finished and failed rows from history. Files stay on disk. */
  'downloads:clearHistory': () => void
  /** Pick the download folder in a native dialog. Null when the dialog is cancelled. */
  'downloads:chooseFolder': () => DownloaderStatus | null
  /** Show a downloaded file in Explorer. */
  'downloads:reveal': (id: number) => void
}

/** Main -> renderer events. */
export interface IpcEventMap {
  'library:scanStatus': ScanStatus
  /** Local tracks were added, changed or removed; refetch with library:getTracks. */
  'library:changed': null
  'likes:changed': null
  'likes:syncStatus': LikesSyncStatus
  /** A playlist's list or its tracks changed; `playlistId` null = the app playlist list. */
  'playlists:changed': { playlistId: string | null }
  'discord:status': DiscordStatus
  'spotify:status': SpotifyStatus
  'soundcloud:status': SoundCloudStatus
  'downloads:status': DownloaderStatus
  /** Jam connection or room changed. */
  'jam:status': JamStatus
  /** Plays were recorded or history cleared. */
  'history:changed': null
  'lastfm:status': LastfmStatus
  /** transfer:plan progress. */
  'transfer:progress': { done: number; total: number }
  'prefs:changed': AppPrefs
  /** To the main window: a hardware media key was pressed. */
  'media:key': MediaKey
  /** To the main window: the mini player opened or closed. */
  'mini:open': boolean
  /** To the mini window: new playback state. */
  'mini:state': MiniState
  /** To the main window: a control from the mini player. */
  'mini:command': MiniCommand
  /** An item was added or changed status; refetch with downloads:list. */
  'downloads:changed': null
  /** Running download progress, throttled (about 4 per second per download). */
  'downloads:progress': DownloadProgress
}

export interface AppInfo {
  version: string
  electron: string
  platform: string
}

export type InvokeChannel = keyof IpcInvokeMap
export type EventChannel = keyof IpcEventMap

export type InvokeArgs<C extends InvokeChannel> = Parameters<IpcInvokeMap[C]>
export type InvokeResult<C extends InvokeChannel> = Awaited<ReturnType<IpcInvokeMap[C]>>

/** The object the preload exposes on `window.api`. */
export interface Api {
  invoke<C extends InvokeChannel>(channel: C, ...args: InvokeArgs<C>): Promise<InvokeResult<C>>
  /** Returns an unsubscribe function. */
  on<C extends EventChannel>(channel: C, listener: (payload: IpcEventMap[C]) => void): () => void
}

// Runtime allowlists. `satisfies` makes the compiler fail if a channel is
// added to a map above but not here.
const invokeChannels = {
  'app:getInfo': true,
  'config:getPublic': true,
  'library:getFolders': true,
  'library:addFolder': true,
  'library:removeFolder': true,
  'library:getTracks': true,
  'library:getScanStatus': true,
  'library:rescan': true,
  'music:search': true,
  'music:getLikes': true,
  'music:like': true,
  'music:unlike': true,
  'music:isLiked': true,
  'music:getPlaylists': true,
  'music:getPlaylistTracks': true,
  'music:getArtist': true,
  'music:getArtistInfo': true,
  'music:getAlbum': true,
  'music:getArtistTracks': true,
  'music:searchArtists': true,
  'music:findOn': true,
  'media:setActive': true,
  'session:save': true,
  'session:load': true,
  'prefs:get': true,
  'prefs:set': true,
  'audio:get': true,
  'audio:set': true,
  'tray:nowPlaying': true,
  'history:record': true,
  'lastfm:getStatus': true,
  'lastfm:setKeys': true,
  'lastfm:connect': true,
  'lastfm:disconnect': true,
  'lastfm:setScrobbleSpotify': true,
  'lastfm:nowPlaying': true,
  'lastfm:scrobble': true,
  'lyrics:get': true,
  'lyrics:save': true,
  'lyrics:delete': true,
  'history:recent': true,
  'history:smart': true,
  'history:stats': true,
  'history:clear': true,
  'tags:edit': true,
  'tags:pickCover': true,
  'tags:proposeFromFilenames': true,
  'tags:applyProposals': true,
  'soundcloud:getFeed': true,
  'soundcloud:getReposts': true,
  'soundcloud:getFollowings': true,
  'spotify:getFollowings': true,
  'spotify:getClientId': true,
  'spotify:setClientId': true,
  'app:relaunch': true,
  'soundcloud:isFollowing': true,
  'soundcloud:setFollowing': true,
  'soundcloud:isReposted': true,
  'soundcloud:setReposted': true,
  'transfer:plan': true,
  'transfer:create': true,
  'duplicates:find': true,
  'duplicates:dismiss': true,
  'jam:getStatus': true,
  'jam:start': true,
  'jam:join': true,
  'jam:leave': true,
  'jam:send': true,
  'jam:setCapabilities': true,
  'mini:toggle': true,
  'mini:publish': true,
  'mini:getState': true,
  'mini:command': true,
  'mini:showMain': true,
  'likes:getAll': true,
  'likes:getSyncStatus': true,
  'likes:sync': true,
  'playlists:getApp': true,
  'playlists:create': true,
  'playlists:rename': true,
  'playlists:delete': true,
  'playlists:addTracks': true,
  'playlists:removeAt': true,
  'playlists:move': true,
  'playlists:chooseCover': true,
  'playlists:clearCover': true,
  'playlists:getPrefs': true,
  'playlists:setPrefs': true,
  'discord:update': true,
  'discord:getStatus': true,
  'discord:setEnabled': true,
  'spotify:getStatus': true,
  'spotify:login': true,
  'spotify:logout': true,
  'spotify:getAccessToken': true,
  'spotify:play': true,
  'soundcloud:getStatus': true,
  'soundcloud:login': true,
  'soundcloud:logout': true,
  'soundcloud:loginWithToken': true,
  'soundcloud:getStream': true,
  'soundcloud:getWaveform': true,
  'soundcloud:getComments': true,
  'soundcloud:getTrackPage': true,
  'soundcloud:searchSets': true,
  'soundcloud:postComment': true,
  'downloads:getStatus': true,
  'downloads:list': true,
  'downloads:enqueue': true,
  'downloads:enqueueMany': true,
  'downloads:retry': true,
  'downloads:cancel': true,
  'downloads:clearHistory': true,
  'downloads:chooseFolder': true,
  'downloads:reveal': true
} satisfies Record<InvokeChannel, true>
const eventChannels = {
  'library:scanStatus': true,
  'library:changed': true,
  'likes:changed': true,
  'likes:syncStatus': true,
  'playlists:changed': true,
  'discord:status': true,
  'spotify:status': true,
  'soundcloud:status': true,
  'downloads:status': true,
  'media:key': true,
  'jam:status': true,
  'history:changed': true,
  'lastfm:status': true,
  'transfer:progress': true,
  'prefs:changed': true,
  'mini:open': true,
  'mini:state': true,
  'mini:command': true,
  'downloads:changed': true,
  'downloads:progress': true
} satisfies Record<EventChannel, true>

export const INVOKE_CHANNELS = Object.keys(invokeChannels) as InvokeChannel[]
export const EVENT_CHANNELS = Object.keys(eventChannels) as EventChannel[]
