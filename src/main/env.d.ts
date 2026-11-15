/// <reference types="electron-vite/node" />

interface ImportMetaEnv {
  readonly SPOTIFY_CLIENT_ID?: string
  readonly JAM_RELAY_URL?: string
  readonly SOUNDCLOUD_CLIENT_ID?: string
  readonly SOUNDCLOUD_CLIENT_SECRET?: string
  readonly DISCORD_APP_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
