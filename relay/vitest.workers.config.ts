// Integration tests that run the Worker and Durable Object inside workerd (Miniflare).
// WebSockets to Durable Objects need --max-workers=1 --no-isolate (see the "test:workers"
// script), per the plugin's known issues.
import { cloudflareTest } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
  test: {
    include: ['test/**/*.workers.test.ts']
  }
})
