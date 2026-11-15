// Unit tests for the pure room logic. They run in plain Node; see vitest.workers.config.ts
// for the integration tests that run inside the Workers runtime.
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/**/*.workers.test.ts'],
    environment: 'node'
  }
})
