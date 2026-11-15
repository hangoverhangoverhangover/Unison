import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = { '@shared': resolve('src/shared') }

// Release builds (npm run dist) are shared publicly, so they only inline the keys
// that are public identifiers: the Discord application ID and the Jam relay URL.
// Spotify and SoundCloud keys from .env stay out; each person adds their own
// Spotify Client ID in Settings.
const release = process.env.UNISON_RELEASE === '1'

export default defineConfig({
  main: {
    // App keys from .env are inlined into the main bundle at build time.
    // They never reach the preload or renderer bundles.
    envPrefix: release ? ['DISCORD_', 'JAM_'] : ['SPOTIFY_', 'SOUNDCLOUD_', 'DISCORD_', 'JAM_'],
    resolve: { alias: shared }
  },
  preload: {
    resolve: { alias: shared }
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: { ...shared, '@renderer': resolve('src/renderer') }
    },
    plugins: [react(), tailwindcss()]
  }
})
