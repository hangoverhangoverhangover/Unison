import { app, BrowserWindow, components, dialog, shell } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { toPublicConfig } from '@shared/config'
import type { Track } from '@shared/types'
import { loadConfig } from './config'
import { openDb, type Db } from './db'
import { registerLibrary } from './library'
import { registerDiscord } from './discord'
import { registerDownloads } from './downloads'
import { registerLikes } from './likes'
import { registerMusic } from './music'
import { asLookup, createLinkBackfill } from './music/backfill'
import { emit, handle } from './ipc'
import { registerPlaylists } from './playlists'
import { registerMediaProtocol, registerMediaSchemePrivileges } from './protocol'
import { registerSoundCloud } from './soundcloud'
import { registerSpotify } from './spotify'
import { describeClientId, effectiveClientId, writeClientId } from './spotify/clientId'
import { createMainWindow, overlayColors } from './window'
import { Menu } from 'electron'
import { registerMini } from './mini'
import { registerMediaKeys } from './mediaKeys'
import { registerHistory } from './history'
import { registerLastfm } from './lastfm'
import { registerLyrics } from './lyrics'
import { registerTheme } from './theme'
import { registerUpdates } from './updates'
import { registerTitles } from './titles'
import { createThumbar } from './thumbar'
import { registerSettings } from './settings'
import { registerTray } from './tray'
import { registerTransfer } from './transfer'
import { registerTags } from './tags'
import { registerJam } from './jam'

// Must be set before the app is ready. Lets playback start without a click,
// e.g. resuming the queue or media-key play on launch.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

// media:// serves local audio and artwork; schemes must be privileged before ready.
registerMediaSchemePrivileges()

let db: Db | undefined
/** The app window. Events go here, never to a login window. */
let mainWindow: BrowserWindow | null = null
const disposers: (() => void | Promise<void>)[] = []

/**
 * Wait for castLabs' Widevine CDM (Spotify needs it). Pass the id explicitly:
 * with no argument v45 also requires the experimental Media Foundation CDM.
 * Never blocks startup on failure; local playback works without it.
 */
async function waitForWidevine(): Promise<void> {
  try {
    const results = await components.whenReady([components.WIDEVINE_CDM_ID])
    console.log(
      '[widevine] ready',
      results.map((r) => `${r.title} ${r.version} ${r.status}`)
    )
  } catch (err) {
    console.error('[widevine] CDM unavailable; Spotify playback will fail:', err)
  }
}

/** Downloads go to Music\Unison, or the old Music\Combined Player when that exists. */
function defaultDownloadFolder(): string {
  const old = join(app.getPath('music'), 'Combined Player')
  return existsSync(old) ? old : join(app.getPath('music'), 'Unison')
}

// One Unison per profile. A second launch (shortcut, relaunch, anything) would
// otherwise start a full copy with its own tray icon and its own playback; it now
// just brings the running window forward (see 'second-instance' below) and exits.
// The lock is per data folder, so throwaway profiles (--user-data-dir) still run.
if (!app.requestSingleInstanceLock()) app.exit(0)

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.tripp.combinedplayer')

  // F12 toggles DevTools in dev; Ctrl+R reload is disabled in production.
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  const userData = app.getPath('userData')
  const keys = loadConfig(userData)
  // Build/config ID before the Settings override; the override is applied once the db is open.
  const buildSpotifyClientId = keys.spotifyClientId
  db = openDb(join(userData, 'library.db'))
  keys.spotifyClientId = effectiveClientId(db, buildSpotifyClientId)
  const getWebContents = (): Electron.WebContents | undefined =>
    mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : undefined

  handle('app:getInfo', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    platform: process.platform
  }))
  handle('config:getPublic', () => toPublicConfig(keys))
  handle('app:relaunch', () => {
    app.relaunch()
    app.quit()
  })
  const database = db
  handle('spotify:getClientId', () =>
    describeClientId(database, buildSpotifyClientId, keys.spotifyClientId)
  )
  handle('spotify:setClientId', (id) =>
    writeClientId(database, id, buildSpotifyClientId, keys.spotifyClientId)
  )

  registerMediaProtocol(db, userData)
  const library = registerLibrary({ db, userDataDir: userData, getWebContents })
  const spotify = registerSpotify({ db, keys, getWebContents })
  const soundcloud = registerSoundCloud({
    db,
    getWebContents,
    getParentWindow: () => mainWindow ?? undefined
  })
  const providers = {
    ...(spotify.provider ? { spotify: spotify.provider } : {}),
    soundcloud: soundcloud.provider
  }
  const connected = {
    spotify: () => spotify.isConnected(),
    soundcloud: () => soundcloud.isConnected()
  }
  // Set once the downloader and settings exist (likes can sync before that).
  const hooks: { autoDownload?: (tracks: Track[]) => void } = {}
  const likes = registerLikes({
    db,
    getProvider: (p) => providers[p],
    isConnected: (p) => connected[p](),
    getWebContents,
    // New SoundCloud likes made elsewhere (found by the likes sync).
    onNewLikes: (tracks) => hooks.autoDownload?.(tracks)
  })
  const playlists = registerPlaylists({
    db,
    getProvider: (source) => providers[source],
    // Same list music:getPlaylistTracks returns, so renderer positions line up.
    getServicePlaylistTracks: (id) => {
      const p = id.startsWith('soundcloud:') ? providers.soundcloud : providers.spotify
      return p ? p.getPlaylistTracks(id) : Promise.reject(new Error('Not connected.'))
    },
    getWebContents
  })
  const discord = registerDiscord({
    db,
    keys,
    getWebContents,
    appVersion: app.getVersion(),
    // Local-file cover art when MusicBrainz has none. Spotify search needs a login;
    // SoundCloud search works logged out.
    artFallbacks: [
      {
        name: 'Spotify',
        search: async (q) =>
          spotify.provider && spotify.isConnected() ? spotify.provider.search(q, 0) : []
      },
      { name: 'SoundCloud', search: (q) => soundcloud.provider.search(q, 0) }
    ]
  })
  const downloads = registerDownloads({
    db,
    userDataDir: userData,
    bundledBinDir: app.isPackaged
      ? join(process.resourcesPath, 'bin')
      : join(app.getAppPath(), 'bin'),
    getWebContents,
    soundcloud: soundcloud.provider,
    getSoundCloudToken: () => soundcloud.getOAuthToken(),
    defaultFolder: defaultDownloadFolder(),
    pickFolder: async () => {
      const opts: Electron.OpenDialogOptions = {
        title: 'Choose a download folder',
        properties: ['openDirectory', 'createDirectory']
      }
      const r = mainWindow
        ? await dialog.showOpenDialog(mainWindow, opts)
        : await dialog.showOpenDialog(opts)
      return r.canceled ? null : (r.filePaths[0] ?? null)
    },
    revealFile: (path) => shell.showItemInFolder(path)
  })
  const backfill = createLinkBackfill({
    db,
    getLookup: (service) =>
      service === 'spotify'
        ? spotify.isConnected()
          ? asLookup(spotify.provider)
          : undefined
        : asLookup(soundcloud.provider),
    log: (message, err) => (err === undefined ? console.log(message) : console.warn(message, err))
  })
  // Lazy: settings is registered just below.
  const mini = registerMini({
    db,
    getMainWindow: () => mainWindow,
    getTheme: () => settings.getPrefs().theme,
    getCustomTheme: () => settings.getPrefs().customTheme
  })
  const mediaKeys = registerMediaKeys((key) => emit(getWebContents(), 'media:key', key))
  const settings = registerSettings({ db, getWebContents })
  // Before any SoundCloud track is mapped: tidies archive titles (QoL 4).
  const titles = registerTitles({
    db,
    getWebContents,
    enabled: () => settings.getPrefs().tidyScTitles
  })
  // Caption buttons follow the theme (glass UI).
  settings.onPrefsChanged((prefs) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setTitleBarOverlay(overlayColors(prefs.theme, prefs.customTheme))
    }
    // The mini player follows the theme too.
    emit(mini.webContents(), 'prefs:changed', prefs)
  })
  hooks.autoDownload = (tracks) => {
    const sc = tracks.filter((t) => t.provider === 'soundcloud')
    if (sc.length === 0 || !settings.getPrefs().autoDownloadLikes) return
    try {
      downloads.downloader.enqueueMany(sc)
    } catch (err) {
      console.warn('[downloads] auto-download of new likes failed:', err)
    }
  }
  const history = registerHistory({ db, getWebContents })
  const lastfm = registerLastfm({ db, getWebContents })
  const lyrics = registerLyrics({ db })
  const theme = registerTheme({ db, getWebContents })
  const updates = registerUpdates({ getWebContents })
  const transfer = registerTransfer({
    db,
    getProvider: (p) => providers[p],
    getPlaylistTracks: (id) => {
      const p = id.startsWith('soundcloud:') ? providers.soundcloud : providers.spotify
      return p ? p.getPlaylistTracks(id) : Promise.reject(new Error('Not connected.'))
    },
    getWebContents
  })
  const tags = registerTags({
    db,
    userDataDir: userData,
    bundledBinDir: app.isPackaged
      ? join(process.resourcesPath, 'bin')
      : join(app.getAppPath(), 'bin'),
    getWebContents
  })
  const jam = registerJam({
    getWebContents,
    // Settings → Jam wins; empty means the built-in relay.
    getPrefs: () => {
      const p = settings.getPrefs()
      return { ...p, jamRelayUrl: p.jamRelayUrl || keys.jamRelayUrl }
    }
  })
  const thumbar = createThumbar({ send: (key) => emit(getWebContents(), 'media:key', key) })
  const tray = registerTray({
    onNowPlaying: (now) => thumbar.update(mainWindow, { playing: !!now?.playing, hasTrack: !!now }),
    getMainWindow: () => mainWindow,
    openMainWindow: () => openMain(),
    send: (key) => emit(getWebContents(), 'media:key', key),
    toggleMini: () => void mini.toggle(),
    closeToTray: () => settings.getPrefs().closeToTray
  })
  const music = registerMusic(providers, {
    // Service first, then the local likes table (the router awaits the service call).
    onLikeChange: (track, liked) => {
      void likes.recordLikeChange(track, liked)
      // Likes made in the app count as new likes too.
      if (liked) hooks.autoDownload?.([track])
    },
    getAppPlaylistTracks: (id) => {
      const tracks = playlists.store.getTracks(id)
      // Tracks saved before links existed get them in the background; then the
      // renderer refetches this playlist.
      void backfill.fill(tracks).then((changed) => {
        if (changed) emit(getWebContents(), 'playlists:changed', { playlistId: id })
      })
      return tracks
    }
  })
  // Disposed in reverse order on quit.
  disposers.push(
    () => library.dispose(),
    () => spotify.dispose(),
    () => soundcloud.dispose(),
    () => likes.dispose(),
    () => playlists.dispose(),
    () => discord.dispose(),
    () => downloads.dispose(),
    () => mini.dispose(),
    () => mediaKeys.dispose(),
    () => history.dispose(),
    () => lastfm.dispose(),
    () => lyrics.dispose(),
    () => theme.dispose(),
    () => updates.dispose(),
    () => titles.dispose(),
    () => settings.dispose(),
    () => tray.dispose(),
    () => transfer.dispose(),
    () => tags.dispose(),
    () => jam.dispose(),
    () => music.dispose()
  )

  // No application menu: the window is frameless, and the default menu's accelerators
  // (Ctrl+- zoom out, Ctrl+Shift+= zoom in) would zoom the page through Electron and
  // never reach the app's own zoom (CSS zoom below the title bar).
  Menu.setApplicationMenu(null)

  await waitForWidevine()
  const openMain = (): void => {
    mainWindow = createMainWindow(settings.getPrefs().theme, settings.getPrefs().customTheme)
    const win = mainWindow
    // Close to tray: hide instead of closing, so playback keeps going.
    win.on('close', (e) => tray.onMainClose(e, win))
    // Taskbar Previous / Play / Next (Windows drops them when the window is hidden).
    win.once('ready-to-show', () => thumbar.apply(win))
    win.on('show', () => thumbar.apply(win))
    mainWindow.on('closed', () => {
      mainWindow = null
      // The mini player only controls the main window's playback; it goes with it.
      mini.close()
    })
  }
  openMain()

  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      openMain()
      return
    }
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.on('activate', () => {
    if (!mainWindow) openMain()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

let quitting = false
app.on('will-quit', (event) => {
  if (quitting) return
  // The downloader's dispose waits for its killed jobs to record their state, so
  // quitting waits for every dispose before the db closes (capped so quit never hangs).
  quitting = true
  event.preventDefault()
  const all = Promise.allSettled(disposers.reverse().map(async (dispose) => dispose()))
  const cap = new Promise((resolve) => setTimeout(resolve, 5000))
  void Promise.race([all, cap]).finally(() => {
    db?.close()
    // Cleanup is done; exit directly (a second app.quit() from inside will-quit stalled).
    app.exit(0)
  })
})
