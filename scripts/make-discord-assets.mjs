// Renders the Discord Rich Presence art assets (512x512 PNG) into design/discord-assets/.
// Upload them in the Discord Developer Portal > your app > Rich Presence > Art Assets,
// named exactly: app_icon, spotify, soundcloud, local.
// Usage: node scripts/make-discord-assets.mjs
import { _electron as electron } from 'playwright-core'
import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const OUT = 'design/discord-assets'

// Simple glyphs in the app's badge style (not the services' official logos).
const tile = (bg, glyph) => `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>${bg.defs ?? ''}</defs>
  <rect width="512" height="512" rx="112" fill="${bg.fill}"/>
  ${glyph}
</svg>`

const ASSETS = {
  app_icon: tile(
    {
      defs: `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#4f3fd1"/><stop offset="0.45" stop-color="#8a5cf0"/>
        <stop offset="1" stop-color="#ff7a2e"/></linearGradient>`,
      fill: 'url(#g)'
    },
    `<path fill="#fff" d="M200 136v176a56 56 0 1 0 32 50V208l128-28v100a56 56 0 1 0 32 50V100z"/>`
  ),
  spotify: tile(
    { fill: '#1e2233' },
    `<g fill="none" stroke="#1ed760" stroke-linecap="round">
      <path stroke-width="38" d="M116 196c96-30 200-22 284 22"/>
      <path stroke-width="32" d="M132 276c80-22 164-14 232 20"/>
      <path stroke-width="26" d="M150 348c62-16 124-10 176 14"/>
    </g>`
  ),
  soundcloud: tile(
    { fill: '#1e2233' },
    `<g fill="#ff5500">
      <path d="M296 176a96 96 0 0 1 92 72 60 60 0 1 1 12 120H272V184c8-5 16-8 24-8z"/>
      <rect x="236" y="200" width="20" height="168" rx="10"/>
      <rect x="196" y="228" width="20" height="140" rx="10"/>
      <rect x="156" y="252" width="20" height="116" rx="10"/>
      <rect x="116" y="284" width="20" height="84" rx="10"/>
    </g>`
  ),
  local: tile(
    { fill: '#1e2233' },
    `<g fill="#b3b5bc">
      <path d="M152 96h148l92 92v220a24 24 0 0 1-24 24H152a24 24 0 0 1-24-24V120a24 24 0 0 1 24-24z" opacity="0.25"/>
      <path d="M232 196v124a44 44 0 1 0 28 41V244l72-16v-40z"/>
    </g>`
  )
}

mkdirSync(OUT, { recursive: true })
const userData = mkdtempSync(join(tmpdir(), 'cp-assets-'))
const app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`] })
try {
  const win = await app.firstWindow()
  for (const [name, svg] of Object.entries(ASSETS)) {
    await win.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`)
    await win.locator('svg').screenshot({ path: `${OUT}/${name}.png`, omitBackground: true })
    console.log(`${OUT}/${name}.png`)
  }
} finally {
  await app.close()
  rmSync(userData, { recursive: true, force: true })
}
