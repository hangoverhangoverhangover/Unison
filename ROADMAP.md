# Unison Roadmap

_Formerly "Combined Player" (renamed 2026-11-15). Data folder: `%APPDATA%\\Unison` (moved from `combined-player`). The Jam relay keeps its `combined-player-jam` address._

A Windows desktop app that plays Spotify, SoundCloud, and local files from one window. Personal use. Ships as a packaged .exe.

This file is the source of truth. Check boxes as work lands. If a decision here turns out wrong, update this file and say why in the Decision Log at the bottom.

---

## How to work on this project

The main agent is the brain. It plans, owns this roadmap, owns the shared types and interfaces in `src/shared`, reviews everything subagents produce, and does the integration. It doesn't write every feature itself.

Subagents are encouraged. Hand them one self-contained job with clear inputs and outputs. Good fits are a provider adapter, the downloader, Discord RPC, a single UI screen, or researching the current docs for an API. Subagents can run in parallel when they don't touch the same files.

Before dispatching work, the main agent defines the interface the subagent codes against. Subagents don't invent shared types. If one needs a change to a shared type, it reports back and the main agent decides.

Every subagent returns a short summary: what it built, files changed, anything unfinished, and anything it had to guess at.

After each subagent's work is merged, the main agent runs the typecheck, lint, and tests, then launches the app to confirm nothing broke.

At the end of every phase, stop and report to the user before starting the next one.

### Ground rules

- Never commit secrets. Keys, tokens, and cookies stay out of Git. `.env`, `config.local.json`, and anything under userData are gitignored.
- Spotify and SoundCloud both changed their APIs heavily in 2026. Verify endpoints and auth flows against the current official docs before writing code. Don't trust memory.
- If something is blocked (missing key, API refuses a call), stop and ask. Don't build a workaround the user didn't approve.
- Keep the app lean. If a feature isn't in this file, ask before adding it.

---

## Tech stack

- **Shell:** castLabs Electron for Content Security (Widevine build, `+wvcus` tag), installed from `github:castlabs/electron-releases`
- **Tooling:** electron-vite, TypeScript (strict), electron-builder
- **UI:** React, Tailwind, Motion (formerly Framer Motion), Radix primitives, lucide-react icons, TanStack Virtual for long lists
- **State:** Zustand
- **Storage:** better-sqlite3 for the library, Electron `safeStorage` for tokens
- **Playback:** Spotify Web Playback SDK for Spotify, an `<audio>` element plus hls.js for SoundCloud streams and local files
- **Local files:** music-metadata for tags and embedded art, chokidar for folder watching
- **Discord:** @xhayper/discord-rpc
- **Downloads:** yt-dlp.exe and ffmpeg.exe, run as child processes

---

## Architecture

```
src/
  main/        Electron main process: auth, providers, db, downloader, discord, ipc
  preload/     typed IPC bridge, nothing else
  renderer/    React UI and the playback controller
  shared/      types and interfaces used everywhere
design/
  references/  UI reference images from the user
```

### Unified track model

Every track, whatever its source, becomes one shape:

```ts
type Provider = 'spotify' | 'soundcloud' | 'local'

interface Track {
  id: string // `${provider}:${nativeId}`
  provider: Provider
  nativeId: string
  title: string
  artists: string[]
  album?: string
  durationMs: number
  artworkUrl?: string
  isrc?: string
  localPath?: string // set for local files and downloads
  sourceScId?: string // set on downloaded SoundCloud files, links back to the original
}
```

### Provider interface

Spotify and both SoundCloud implementations sit behind one interface. The rest of the app never knows which one it's talking to.

```ts
interface MusicProvider {
  search(query: string, page: number): Promise<Track[]>
  getLikes(): Promise<{ track: Track; likedAt: string }[]>
  like(track: Track): Promise<void>
  unlike(track: Track): Promise<void>
  getPlaylists(): Promise<Playlist[]>
  getPlaylistTracks(id: string): Promise<Track[]>
}
```

SoundCloud also implements `getComments`, `postComment`, `getWaveform`, `getStreamUrl`, and `getOfficialDownload`.

SoundCloud has two implementations:

1. **Official:** registered app, OAuth through the official flow.
2. **Web session:** the user logs into soundcloud.com in an Electron window, the app reads the `oauth_token` cookie from that session, scrapes the current web `client_id` from SoundCloud's JS bundles on launch, and calls api-v2.

Web session is built first and works with no SoundCloud API key. Once official keys exist, official becomes the default and web session becomes the fallback, selectable in settings. The app must run fully with the SoundCloud keys in `.env` left blank.

### Playback controller

Lives in the renderer. Owns the queue and switches between two backends: the Spotify SDK player, and the HTML audio element (SoundCloud HLS and local files). The queue can mix all three sources. The controller exposes one API (play, pause, seek, next, previous, volume) and emits one stream of state updates that the UI, Discord RPC, and the OS media session all read.

### Config and secrets

App keys (Spotify Client ID, SoundCloud client ID and secret, Discord Application ID) ship as build-time defaults from `.env`. A `config.json` in userData overrides them if present, so keys can be swapped without a rebuild.

User tokens are never hardcoded. They're stored per user with `safeStorage`.

---

## Phases

### Phase 0: Scaffold

- [x] electron-vite + React + TypeScript project, castLabs Electron as the Electron dependency
- [x] Frameless window with a custom title bar
- [x] `.gitignore` covering `.env`, `config.local.json`, `dist`, `release`
- [x] Config loader: `.env` defaults, overridden by userData `config.json`
- [x] Shared types and the `MusicProvider` interface in `src/shared`
- [x] SQLite schema: tracks, likes, playlists, playlist_items, downloads, settings
- [x] Typed IPC bridge in preload
- [x] Chromium switch `autoplay-policy=no-user-gesture-required`

**Done when:** the app launches to an empty shell, and typecheck and lint pass.

### Phase 1: Core player with local files

Local files first, since there's no auth to fight. This proves the audio pipeline and the UI shell.

- [x] Pick music folders in settings, scan with music-metadata, watch with chokidar
- [x] Serve local files through a custom protocol, not raw `file://`
- [x] Playback controller with the audio-element backend
- [x] Queue: play next, add to queue, reorder, clear
- [x] Now-playing bar: artwork, title, artist, seek bar, volume, shuffle, repeat
- [x] OS media session: media keys and the Windows media overlay

**Done when:** you can browse local music, queue songs, and control playback from the keyboard media keys.

### Phase 2: Spotify

- [x] Auth: Authorization Code with PKCE, loopback redirect to `http://127.0.0.1:<port>/callback` (Spotify rejects `localhost`)
- [x] Token refresh, plus a re-login prompt when the refresh token expires (Spotify refresh tokens die six months after the original login)
- [x] Load the Web Playback SDK from `https://sdk.scdn.co/spotify-player.js` and register the app as a Connect device
- [x] VMP-sign the dev Electron (`npm run vmp:sign`, needs a free castLabs EVS account). Spotify's licence server rejects unsigned ECS builds. Only if the SDK still refuses Electron's user agent, set `app.userAgentFallback` to a Chrome UA
- [x] Spotify backend in the playback controller
- [x] Library: liked songs, playlists, playlist items (use the `/items` endpoints, `/tracks` was removed)
- [x] Search with pagination (capped at 10 results per request)
- [x] Like and unlike through `PUT`/`DELETE /me/library` (list likes with `GET /me/tracks`)

**Done when:** Spotify songs play inside the app, and likes and playlists load.

### Phase 3: SoundCloud

- [x] Web-session adapter first: login window, cookie capture, client_id scraping on launch. This needs no SoundCloud API key
- [ ] _(Skipped: no SoundCloud keys; registering an app now needs Artist Pro)_ Official adapter: OAuth per the current guide at developers.soundcloud.com. Build this only once the user has a registered app. If the keys in `.env` are blank, skip it and continue
- [ ] _(Skipped with the official adapter)_ Settings toggle between the two, shown only when official keys exist
- [x] Stream through hls.js using the transcodings from the track object; refresh expired stream URLs
- [x] Handle blocked or preview-only tracks: label them in the UI, skip them in the queue
- [x] Likes, playlists, search, like and unlike

**Done when:** SoundCloud tracks play, and both adapters pass the same smoke test.

### Phase 4: Unified library

- [x] Merged Likes view across Spotify and SoundCloud, sorted by date liked
- [x] Liking a song writes to the real service, then the local table
- [x] Reconcile likes against both services on startup and every 30 minutes, so likes changed in the official apps show up here
- [x] Local playlists that mix all three sources (these live only in this app)
- [x] Service playlists shown read-and-edit within their own service
- [x] Search toggle: Spotify, SoundCloud, or Both, results grouped by source

**Done when:** one Likes list shows everything, and a mixed playlist plays straight through.

### Phase 5: SoundCloud comments

- [x] Waveform drawn on canvas from the track's waveform data
- [x] Existing comments shown as avatars along the waveform at their timestamps, with hover to read
- [x] Comment composer that stamps the current playback position
- [x] Confirmation before posting, because the API can't delete comments

**Done when:** you can read and post timestamped comments on SoundCloud tracks.

### Phase 6: Discord Rich Presence

- [x] Connect through @xhayper/discord-rpc using the Discord Application ID
- [x] Activity type Listening with title, artist, and start and end timestamps for the progress bar
- [x] Large image: artwork URL, falling back to the `app_icon` asset whenever art is missing (all local files, any track without art)
- [x] Small image: a service icon asset (`spotify`, `soundcloud`, `local`)
- [x] Update only on track change, pause, resume, and seek. Clear presence when stopped
- [x] Settings toggle to turn presence off

**Done when:** Discord shows the current track correctly for all three sources.

### Phase 7: Downloader

- [x] On first run, copy yt-dlp.exe and ffmpeg.exe into userData. Run them from there so updates don't need admin rights
- [x] Run `yt-dlp -U` on launch, in the background
- [x] Download button on SoundCloud tracks only
- [x] Check for an official download first (artist-enabled). Use it when it exists
- [x] Otherwise fall back to yt-dlp with embedded metadata and thumbnail
- [x] Save to a user-chosen folder and record `sourceScId` so the file links back to the original
- [x] Downloader tab: active queue with progress, history list, retry on failure, two downloads at a time
- [x] Downloaded files show up in the local library automatically

**Done when:** downloads land in the library, link back to their SoundCloud original, and don't show up twice in Likes.

### Phase 7b: Artist and album pages

Added 2026-11-11 at the user's request, before Phase 8.

- [x] Artist pages for Spotify artists and SoundCloud profiles: header, play, popular tracks, discography (albums, singles and EPs), SoundCloud playlists
- [x] Album, single and EP pages with the track list, release info and copyrights
- [x] Artist and album names in track rows and the play bar open those pages
- [x] SoundCloud albums and profiles get a "Download all" button, with a confirmation showing the count
- [x] Discord presence links the title to the track's page and the artist line to the artist's page
- [x] SoundCloud track page like soundcloud.com: waveform with timed comments, description and tags, stats, uploader card, comments with replies
- [x] Comment replies show under their parent (comments panel and track page)

**Done when:** you can go from any track to its artist and album, browse a discography, and download a whole SoundCloud album or profile.

### Phase 8: Extras

- [x] Find on the other service: match by ISRC first, then title plus artist
- [x] Compact mini-player window that stays on top

**Done when:** both features work without slowing down the main window.

### QoL round: search and playlists

Added 2026-11-11 at the user's request, before Phase 9.

- [x] Search (filter) inside Liked Songs and every playlist
- [x] Global search shows artist profiles (Spotify artists, SoundCloud users) above songs; no playlists
- [x] Hide playlists from the sidebar; a full Library tab lists every playlist, hidden ones included, and can unhide them
- [x] Drag to reorder playlists in the sidebar
- [x] Change the cover of app (mixed) playlists
- [ ] Search shows SoundCloud playlists and albums (Spotify playlists left out: Development Mode only lists tracks of playlists you own)

### QoL round 2

Added 2026-11-12 at the user's request, before Phase 9. Plan and notes: vault `Backlog/QoL 2 - Polish, Data, SoundCloud, Sound`.

- [x] Restore the last queue, track and position on launch
- [x] Keyboard shortcuts (Space, arrows, Ctrl+L, Ctrl+K) with a cheat sheet in Settings
- [x] Close to tray, with play/pause and next in the tray menu
- [x] Play history: Recently played, On repeat, Forgotten favourites
- [x] Listening stats: top artists and tracks for a week, month or year
- [x] Tag editor for local files: one file, a whole folder, or from "Artist - Title" file names
- [x] Sort Local Files: unsorted, artist, album
- [x] SoundCloud feed (uploads and reposts from people you follow)
- [x] SoundCloud following: follow/unfollow, Following list
- [ ] SoundCloud reposts: show on profiles, repost with confirmation
- [ ] Auto-download new SoundCloud likes (optional)
- [x] Copy a playlist to the other service, with a review step
- [x] Duplicate finder across likes and local files, always confirmed by the user
- [x] Volume levelling and crossfade (SoundCloud and local)
- [x] Equalizer (SoundCloud and local)
- [ ] Spotify following in the Following page, with All / Spotify / SoundCloud filters like Liked Songs
- [ ] Copy to SoundCloud stays under SoundCloud's rate limit; the progress bar only moves forward
- [ ] Tag editor: add or replace cover art for formats that hold it
- [ ] "Details" panel replaces "Comments": SoundCloud waveform + comments with linked title/artist; Spotify artwork, title, artists, like, About the artist

### Jam: shared listening

Added 2026-11-12 at the user's request. Plan: vault `Backlog/Jam - Shared Listening`.

- [ ] Relay server (user deploys): rooms with a code, shared queue, playback clock; no audio or secrets pass through it
- [ ] Start a Jam (host) and join one with a code; participants list; leave / end
- [ ] Everyone can add to the shared queue; only the host skips, seeks, pauses, removes and reorders
- [ ] Playback stays in sync across Spotify and SoundCloud tracks (each person plays on their own accounts)
- [ ] Unplayable tracks: find on the other service, skip for that guest, or block adding — chosen in Settings

### UI upgrade: glass

Added 2026-11-14 at the user's request. Design: `docs/superpowers/specs/2026-11-14-glass-ui-design.md`. Plan: `docs/superpowers/plans/2026-11-14-glass-ui.md`.

- [x] Frosted glass panels over an ambient wash made from the playing track's artwork (crossfades on track change)
- [x] Floating frosted play bar; pages scroll under it and fade out just above it
- [x] Themes in Settings → Appearance: Artwork (default), Dark, Light (bright white glass)
- [x] Title bar: back/forward, quick-search pill, Downloads (progress ring), mini player, Settings
- [x] Calmer sidebar (Search, Feed, Stats; history playlists as three tiles); drag to resize, snaps to an icon rail
- [x] One right panel with Queue / Details / Jam tabs, drag to resize
- [x] Page headers: round play button, one action row, rarer actions behind ⋯, a sticky title strip on scroll
- [x] Track rows: source dot only in mixed lists, Album column hidden when empty
- [x] Track page: comment markers on the waveform, one stats line
- [x] Settings: section list plus glass cards
- [x] Empty pages hide disabled play/shuffle
- [x] Combined search: one page mixing Spotify, SoundCloud and local files (type and source filters, top result, recent searches) plus quick search from anywhere (Ctrl+K)
- [x] Whole-app zoom (Ctrl +/−/0, Ctrl+wheel, Settings slider), 70–150%

### Phase 9: Packaging

- [x] electron-builder config producing an NSIS installer (portable .exe only if Widevine works from it: self-extracting builds can break VMP)
- [x] castLabs EVS VMP signing in an `afterSign` hook. On Windows, VMP signing must run after code signing (before-signing is the macOS rule)
- [x] Verify Spotify playback works in the packaged build, not just in dev
- [ ] App icon and installer branding

**Done when:** a fresh install on a clean Windows profile logs in to both services and plays music.

---

## UI direction

The target is modern, sleek, and smooth: frosted glass over colour taken from the music (see "UI upgrade: glass" above and its design doc). The images in `design/references/` were the starting base, not the final look; where they disagree with the glass design, the glass design wins.

- Use the frontend-design skill or plugin for every UI pass.
- Before writing UI code, write a short token system (colors, type scale, spacing, radii, motion durations) into `src/renderer/styles/tokens.ts` and get it approved.
- Smooth means 60fps. Animate only transform and opacity. Drive the progress bar with `requestAnimationFrame`, not React state ticks. Virtualize any list over 100 rows.
- Motion should answer the user's actions: artwork crossfades on track change, panels slide when opened, the like button responds when pressed. No decorative motion on idle screens.
- Each source gets a small, consistent badge or dot so you always know where a track comes from. Don't color the whole UI by service.
- Glass blur lives on a `::before` layer (`glass`, `glass-strong`, `glass-bar` utilities in `app.css`), never on the panel itself, and never inside an element with `backdrop-filter`, `filter`, `opacity < 1` or `mask`: those become a "backdrop root" and the glass inside can no longer blur the page.
- Empty and error states tell the user what to do next ("Connect SoundCloud in Settings"), not just what went wrong.
- Self-check: after each UI change, launch the app with Playwright's Electron support, screenshot the screen you touched, and compare it to the references before calling the work done.

---

## Known constraints

- Spotify Development Mode requires a Premium account and is capped at five authorized users.
- Spotify search returns 10 results per request.
- Spotify has no recommendations or radio endpoint.
- SoundCloud comments can't be deleted through the official API. The web client has `DELETE comments/{id}`, but the app doesn't use it, so posting stays a confirmed, permanent action.
- Some SoundCloud tracks are blocked or preview-only.
- About a third of SoundCloud tracks (mostly major-label) are DRM-only. They play through Widevine (castLabs ECS, VMP-signed) and SoundCloud's license server; FairPlay (`cbc-`) streams are never used.
- The web-session SoundCloud adapter uses undocumented endpoints and will break without warning.
- Discord can't display embedded cover art from local files, so it falls back to the app icon.
- If the user's Discord account is linked to Spotify, Discord shows two presences. Unlink Spotify under Discord's Connections.

---

## Decision Log

| Date       | Decision                                                                                                                                                                                                                                                                                                                         | Why                                                                                                                                                                                                                                                           |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|            | Electron (castLabs) over Tauri                                                                                                                                                                                                                                                                                                   | Widevine is required for the Spotify Web Playback SDK                                                                                                                                                                                                         |
|            | No local-only likes                                                                                                                                                                                                                                                                                                              | Likes always sync to the real service to avoid drift                                                                                                                                                                                                          |
|            | Official download before yt-dlp                                                                                                                                                                                                                                                                                                  | Artist uploads are often lossless; streams are 128kbps                                                                                                                                                                                                        |
|            | yt-dlp lives in userData                                                                                                                                                                                                                                                                                                         | Self-update fails under Program Files                                                                                                                                                                                                                         |
|            | Tokens in safeStorage, keys in config                                                                                                                                                                                                                                                                                            | Tokens are per user; keys are per app                                                                                                                                                                                                                         |
| 2026-11-09 | castLabs `v45.2.1+wvcus` with better-sqlite3 13                                                                                                                                                                                                                                                                                  | better-sqlite3 13 ships N-API prebuilds that load on any Electron, so no compiler is needed. `electron-builder install-app-deps` was dropped from postinstall because it forced a source rebuild that fails without Visual Studio                             |
| 2026-11-09 | Native caption buttons via `titleBarOverlay`                                                                                                                                                                                                                                                                                     | The window is frameless and the renderer draws the title bar, but Windows draws minimize/maximize/close so Snap Layouts still work                                                                                                                            |
| 2026-11-09 | App keys inlined into the main bundle only                                                                                                                                                                                                                                                                                       | electron-vite `envPrefix` on main; the renderer gets `PublicConfig` booleans, never key values                                                                                                                                                                |
| 2026-11-09 | `Playlist.source` adds `'app'`                                                                                                                                                                                                                                                                                                   | Local mixed playlists (Phase 4) live only in this app and aren't a `Provider`                                                                                                                                                                                 |
| 2026-11-09 | Tests run in Electron's Node (`ELECTRON_RUN_AS_NODE=1`)                                                                                                                                                                                                                                                                          | Native modules load against the same runtime the app uses                                                                                                                                                                                                     |
| 2026-11-09 | `bin/*.exe` gitignored                                                                                                                                                                                                                                                                                                           | 130 MB of third-party binaries; they're copied into userData at runtime (Phase 7)                                                                                                                                                                             |
| 2026-11-09 | Local tracks keyed by sha1 of the normalized path; `media://local/<id>` and `media://art/<hash>` accept only sha1 hex                                                                                                                                                                                                            | The renderer never sends a filesystem path, so no path traversal through the protocol                                                                                                                                                                         |
| 2026-11-09 | Scanner never deletes rows with `source_sc_id`                                                                                                                                                                                                                                                                                   | Downloads (Phase 7) may live outside watched folders and must keep their link to SoundCloud                                                                                                                                                                   |
| 2026-11-09 | Repeat off: end of queue stays on the last track, paused at 0                                                                                                                                                                                                                                                                    | Matches the reference players; pressing play replays it                                                                                                                                                                                                       |
| 2026-11-09 | Ran Phase 1 UI without the frontend-design plugin                                                                                                                                                                                                                                                                                | It is enabled on the account but didn't load in this session; user approved proceeding                                                                                                                                                                        |
| 2026-11-10 | VMP signing moved into Phase 2 (dev) and Phase 9 hook changed to `afterSign`                                                                                                                                                                                                                                                     | castLabs: unsigned ECS builds get licence 403/500 from Spotify; Windows VMP signing must follow code signing. See docs/research/spotify-playback-widevine.md                                                                                                  |
| 2026-11-10 | No Premium check via `/me`                                                                                                                                                                                                                                                                                                       | Spotify removed `product` from `/me` in 2026; the SDK's `account_error` is the only signal                                                                                                                                                                    |
| 2026-11-10 | Redirect URI registered without a port (`http://127.0.0.1/callback`)                                                                                                                                                                                                                                                             | Spotify allows a dynamic loopback port when the registered URI omits it                                                                                                                                                                                       |
| 2026-11-10 | Scopes include `user-read-email` and `user-read-private`; logins missing a required scope must log in again                                                                                                                                                                                                                      | Without them the Web Playback SDK fails with `authentication_error`. Granted scopes are stored with the tokens and checked at startup                                                                                                                         |
| 2026-11-10 | `spotify:play` waits for the SDK device in `GET /me/player/devices` (10 s) before transfer + retry                                                                                                                                                                                                                               | The SDK fires `ready` before Spotify's backend lists the device, so the first play returned 404 "Device not found"                                                                                                                                            |
| 2026-11-10 | Re-run `npm run vmp:sign` after any `npm install` that reinstalls Electron                                                                                                                                                                                                                                                       | Reinstalling restores castLabs' development-only signature, which Spotify's licence server rejects                                                                                                                                                            |
| 2026-11-10 | Spotify loads with `autoplay` start playing directly; the app sends the queue's following Spotify tracks (max 50) in one play call and adopts Spotify's own advance                                                                                                                                                              | Removed the mute/pause/resume round trips (2s+ start delay, stale paused state freezing the timer) and gaps between tracks. Spotify-side shuffle/repeat are turned off once per device so they can't reorder the context                                      |
| 2026-11-10 | Spotify paging fetches remaining pages 4 at a time by offset; playlists load before likes                                                                                                                                                                                                                                        | Sequential 50-item pages plus simultaneous loads made playlists take up to a minute                                                                                                                                                                           |
| 2026-11-10 | SoundCloud official adapter skipped                                                                                                                                                                                                                                                                                              | No keys in `.env`; new app registrations need a paid Artist Pro plan. The web-session adapter covers Phase 3. "Both adapters pass the same smoke test" applies once official keys exist                                                                       |
| 2026-11-10 | SoundCloud api-v2 calls go through the login partition's `Session.fetch` (Chromium), with Electron's own user agent                                                                                                                                                                                                              | DataDome blocks non-browser TLS fingerprints, and hard-blocked the login window when its UA claimed to be Chrome                                                                                                                                              |
| 2026-11-10 | Paste-`oauth_token` fallback in Settings                                                                                                                                                                                                                                                                                         | Works when DataDome blocks the built-in login window. Checked with `/me` before it's stored in the partition cookie jar                                                                                                                                       |
| 2026-11-10 | `Track.availability` (`full`/`preview`/`blocked`/`drm`); the queue skips non-full tracks instantly                                                                                                                                                                                                                               | About a third of SoundCloud tracks are DRM-only (Widevine). Labelled for now; a Widevine attempt is the next step the user chose                                                                                                                              |
| 2026-11-10 | SoundCloud DRM-only tracks play through hls.js EME + Widevine                                                                                                                                                                                                                                                                    | Verified live: protected tracks play and hand off to the next track. Uses `ctr-encrypted-hls` with the `licenseAuthToken` from the stream lookup; the license host is in `connect-src`. Supersedes the earlier "label and skip DRM" row                       |
| 2026-11-10 | Likes live in the local `likes` table; the merged list reads it, reconciled per service (startup + 30 min) and after each successful like/unlike                                                                                                                                                                                 | Instant, offline-capable Liked Songs. A failed sync keeps the last saved likes; a like during a sync isn't undone by it                                                                                                                                       |
| 2026-11-10 | Track rows store `availability` (migration 3); service tracks are upserted when liked or added to an app playlist                                                                                                                                                                                                                | App playlists and likes reference `tracks` rows, so service tracks need a local copy                                                                                                                                                                          |
| 2026-11-10 | Service playlist removal works by track, not position                                                                                                                                                                                                                                                                            | Spotify (no `snapshot_id`) and SoundCloud remove every copy of a track; app playlists remove by position                                                                                                                                                      |
| 2026-11-10 | SoundCloud playlist edits write the full track-id list back (`PUT playlists/{id}`)                                                                                                                                                                                                                                               | Undocumented api-v2; guarded against wiping a playlist whose list came back empty                                                                                                                                                                             |
| 2026-11-10 | SoundCloud comments post `body` and `timestamp` as query parameters on `POST tracks/{id}/comments`                                                                                                                                                                                                                               | The web client's endpoint map declares them under `query`; a JSON body returned 400. Verified live                                                                                                                                                            |
| 2026-11-10 | Reading comments and waveforms works logged out; posting needs a login and a second confirmation step                                                                                                                                                                                                                            | Public data; posting is permanent from the app                                                                                                                                                                                                                |
| 2026-11-10 | Waveform bars stretch each track's quiet-to-loud range                                                                                                                                                                                                                                                                           | SoundCloud peaks for loud masters are nearly uniform, which drew a flat block                                                                                                                                                                                 |
| 2026-11-11 | Discord presence: the renderer sends only track change, pause, resume, seek (start time shifted 2 s or more) and stop; main merges rapid updates and connects lazily on the first update                                                                                                                                         | Keeps under Discord's activity rate limit; Discord not running isn't an error, it retries with backoff. Verified live for all three sources                                                                                                                   |
| 2026-11-11 | Paused shows the track with no timestamps and "Paused" as the small image's hover text; idle or error clears the activity                                                                                                                                                                                                        | Discord has no paused progress bar; a frozen bar would read as still playing                                                                                                                                                                                  |
| 2026-11-11 | Art assets (`app_icon`, `spotify`, `soundcloud`, `local`) are app-styled glyphs from `scripts/make-discord-assets.mjs`, not official logos                                                                                                                                                                                       | Avoids using service trademarks as-is; local files and tracks without https artwork use `app_icon`                                                                                                                                                            |
| 2026-11-11 | Pausing clears the Discord presence (renderer sends `stopped`); resuming shows it again with a fresh progress bar                                                                                                                                                                                                                | User request: a paused track shouldn't stay on the profile. Supersedes the "Paused shows the track" row                                                                                                                                                       |
| 2026-11-11 | Local files get Discord cover art from MusicBrainz recording search + Cover Art Archive (`release-group/{id}/front-500`, the archive.org redirect target), cached in `cover_art_cache` (migration 4; misses retried after 7 days)                                                                                                | User picked MusicBrainz: open data, no key. Genius needs a token; iTunes terms allow art only next to a purchase badge; Deezer terms limit use and its docs are login-walled. Requests are spaced 1.1 s apart with a generic User-Agent (no personal contact) |
| 2026-11-11 | Local-file cover art falls back to the app's Spotify search (when logged in), then SoundCloud search, when MusicBrainz has nothing; migration 5 clears cached misses so they're retried                                                                                                                                          | First live run: MusicBrainz had no covers for the user's SoundCloud-first artists. A result counts only if its cleaned title matches and the artist is credited or in the title                                                                               |
| 2026-11-11 | Local files without an artist tag get no cover-art lookup (logged as skipped)                                                                                                                                                                                                                                                    | User's choice. 68% of the user's local files are untagged, many with placeholder titles; title-only or folder-name guesses risk wrong covers                                                                                                                  |
| 2026-11-11 | Library scan keeps an artwork file when two tracks with the same embedded art race to write it                                                                                                                                                                                                                                   | Windows failed the second rename with EPERM and the whole track was skipped                                                                                                                                                                                   |
| 2026-11-11 | Downloader: official download first, else yt-dlp (`--embed-metadata --embed-thumbnail`, absolute `--ffmpeg-location`, `--progress` with `--print after_move:filepath`), URL `https://api.soundcloud.com/tracks/<id>`; two at a time; interrupted jobs resume next launch                                                         | Verified live with yt-dlp 2026.10.26. A relative ffmpeg path wasn't found; `--print` implies `--quiet`, so `--progress` is needed for progress lines; `--no-color` no longer exists (`--color never`)                                                         |
| 2026-11-11 | yt-dlp gets the SoundCloud login through a temporary cookies file (deleted after each run), never args or logs                                                                                                                                                                                                                   | Go+ tracks need the login; command-line args are visible to other local processes                                                                                                                                                                             |
| 2026-11-11 | Downloads whose duration is under 90% of the SoundCloud track are deleted and fail as preview-only; DRM tracks fail with a clear message                                                                                                                                                                                         | Logged-out Go+ tracks only yield 30 s previews; yt-dlp skips Widevine-encrypted formats                                                                                                                                                                       |
| 2026-11-11 | Quit waits (max 5 s) for every module's dispose, then closes the db and calls `app.exit(0)`                                                                                                                                                                                                                                      | The downloader records killed jobs as queued before the db closes; calling `app.quit()` again inside will-quit stalled for minutes                                                                                                                            |
| 2026-11-11 | Comments load with `threaded=1` (all) and `threaded=0` (top-level only); a comment missing from the top-level list is a reply to the top-level comment before it                                                                                                                                                                 | `threaded=0` alone left replies out entirely (230 of 400 on the test track). Grouping by timestamp lumped unrelated 0:00 comments together                                                                                                                    |
| 2026-11-11 | SoundCloud track descriptions are converted to plain text in main (tags stripped, links shown as text, entities decoded)                                                                                                                                                                                                         | Old descriptions contain raw HTML; the renderer never renders HTML from the service                                                                                                                                                                           |
| 2026-11-11 | Saved service tracks missing artist/album links are looked up again when an app playlist opens (Spotify one `GET /tracks/{id}` each, SoundCloud `tracks?ids=` 50 at a time)                                                                                                                                                      | Rows saved before migration 7 had no links, so app playlist names weren't clickable                                                                                                                                                                           |
| 2026-11-11 | Hardware media keys are taken system-wide through `globalShortcut` while a track is loaded (playing or paused), and released when nothing is loaded                                                                                                                                                                              | Media keys stopped working: Chromium routes them to the frame holding the playing media, which is the Spotify SDK's iframe during Spotify playback, and Windows may hand them to the Spotify desktop app. Releasing them when idle leaves them to other apps  |
| 2026-11-11 | The Spotify backend pauses any SDK "playing" state that arrives while it's stopped                                                                                                                                                                                                                                               | Skipping from a Spotify track to a SoundCloud one mid-load: the start request had already reached Spotify, so the Spotify track started after `stop()` and played over the next track                                                                         |
| 2026-11-11 | The mini player re-asserts always-on-top when it loses focus, undoes minimize/hide, and the play-bar button brings back a hidden mini player instead of closing it                                                                                                                                                               | It vanished after a click outside it (Start menu / taskbar) and, having no taskbar button, couldn't be brought back                                                                                                                                           |
| 2026-11-12 | Search shows SoundCloud playlists and albums (`search/playlists`), not Spotify playlists                                                                                                                                                                                                                                         | User's choice. Spotify Development Mode returns 403 for the items of playlists you don't own or collaborate on, so Spotify results couldn't open                                                                                                              |
| 2026-11-12 | QoL round 2 main pieces: `plays` table (migration 9) + smart playlists and stats; settings stored as JSON in `settings` (`playback.session`, `app.prefs`, `audio.settings`); tags written with the bundled ffmpeg (`-map 0 -c copy`, temp + rename-over, no backup fallback); cross-service matching always reviewed by the user | The user's rule: even exact artist + title matches are confirmed. A failed tag replace must never make the watcher drop the track row                                                                                                                         |
| 2026-11-12 | Audio processing (levelling, crossfade, EQ) only for local and non-DRM SoundCloud tracks; DRM streams play on a plain element outside Web Audio; `media://` sends CORS headers                                                                                                                                                   | Widevine media routed into Web Audio is silent; cross-origin media without CORS is silent in a MediaElementSource                                                                                                                                             |
| 2026-11-12 | SoundCloud follow is a signed POST (`me/followings/:id?signature=`) rebuilt from the web client; repost PUT/DELETE `me/track_reposts/:id`; feed `stream`                                                                                                                                                                         | From the web client's endpoint map. The signature is untested against SoundCloud                                                                                                                                                                              |
| 2026-11-12 | Spotify follows are read-only (`GET /me/following`, optional scope `user-follow-read`); no Spotify follow button                                                                                                                                                                                                                 | Feb 2026 removed the follow/unfollow endpoints; the docs conflict on whether `/me/library` accepts artist URIs. Optional scope so existing logins aren't marked expired                                                                                       |
| 2026-11-12 | Copy plans: one at a time (a new plan aborts the old), SoundCloud searches paced ≥ 1.5 s with 5/15/45 s backoff, progress never decreases                                                                                                                                                                                        | StrictMode ran the plan twice, doubling SoundCloud searches and making the bar bounce; SoundCloud flagged it as bot traffic                                                                                                                                   |
| 2026-11-12 | Details panel replaces Comments (SoundCloud waveform + comments; Spotify/local artwork, links, About the artist via `music:getArtistInfo`)                                                                                                                                                                                       | User request; monthly listeners/followers aren't in Spotify's 2026 API                                                                                                                                                                                        |
| 2026-11-12 | Jam relay on Cloudflare Workers + one SQLite-backed Durable Object per room; the room is authoritative; each client plays on its own accounts                                                                                                                                                                                    | User chose internet over same-Wi-Fi; free plan covers it; no audio or secrets pass through the relay                                                                                                                                                          |
| 2026-11-12 | During a Jam the playback controller's transport methods are swapped for Jam commands (host) or no-ops (guests)                                                                                                                                                                                                                  | Every control path (play bar, media keys, shortcuts, mini player, tray) goes through the Jam without touching each UI                                                                                                                                         |
| 2026-11-14 | Spotify Client ID can be entered in Settings (overrides .env/config.json); changing it signs out and applies after a restart                                                                                                                                                                                                     | Spotify Development Mode only lets the app owner and allow-listed accounts log in, so each person (e.g. Jam guests) uses their own developer app. Login uses PKCE, so no Client Secret is needed                                                              |
| 2026-11-14 | Built-in Jam relay `https://combined-player-jam.exxen.workers.dev` (`DEFAULT_JAM_RELAY_URL`); `JAM_RELAY_URL` in .env/config.json or Settings → Jam override it                                                                                                                                                                  | Everyone in a Jam must share one relay; the URL isn't a secret, so it ships in the app and friends don't have to paste it                                                                                                                                     |
| 2026-11-14 | Glass UI: `--glass-*` CSS variables per theme on `<html data-theme>`, Tailwind colours point at them (`@theme inline`); blur on `::before` layers; the sticky title strip sits beside the page's scroll area, not inside it                                                                                                      | A blurred panel turns into a backdrop root, so glass inside it (the play bar, a sticky header inside the masked scroll area) showed crisp text behind it. Found in the mockups and again by screenshot                                                        |
| 2026-11-14 | Zoom is CSS `zoom` on the app below the title bar, not Electron's `setZoomFactor`                                                                                                                                                                                                                                                | Chromium zoom is per origin, so it would also zoom the mini player (same origin). The title bar must stay 40 px to line up with the Windows caption buttons                                                                                                   |
| 2026-11-15 | Packaging: `electron-builder.yml` (NSIS, `electronDist` = the installed castLabs Electron, `npmRebuild: false`, `bin/` as extraResources), VMP signing in `scripts/vmp-sign.cjs` (`afterSign`, `EVS_NO_ASK`, `SKIP_VMP=1` to skip). `npm run dist` builds with `UNISON_RELEASE=1`, which inlines only `DISCORD_` and `JAM_` keys | The project is going open source and the exe is shared: Spotify/SoundCloud keys from .env must not be inside it. Discord app ID and relay URL are public identifiers. better-sqlite3 uses N-API prebuilds, so no rebuild against castLabs headers             |
| 2026-11-14 | No new npm packages for the glass UI (⋯ menu built in place instead of `@radix-ui/react-dropdown-menu`)                                                                                                                                                                                                                          | An install could disturb the VMP-signed Electron in `node_modules`                                                                                                                                                                                            |
