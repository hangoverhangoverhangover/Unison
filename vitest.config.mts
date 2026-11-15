import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

// Tests run inside Electron's Node (ELECTRON_RUN_AS_NODE=1, see the "test" script)
// so native modules like better-sqlite3 load against the same runtime the app uses.
export default defineConfig({
  resolve: {
    alias: { '@shared': resolve('src/shared'), '@renderer': resolve('src/renderer') }
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    pool: 'forks'
  }
})
