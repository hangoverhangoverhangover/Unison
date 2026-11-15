// Phase 7b check (no login): from a SoundCloud search row, open the artist page,
// then an album, confirm Download all asks first, and Back returns.
// Usage: npm run build first, then node scripts/smoke-phase7b.mjs [query] [artist]
import { _electron as electron } from 'playwright-core'
import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const query = process.argv[2] ?? 'forss flickermood'
const artistName = process.argv[3] ?? 'Forss'
const userData = mkdtempSync(join(tmpdir(), 'cp-smoke-p7b-'))
mkdirSync('screenshots', { recursive: true })
const results = {}

const app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`] })
try {
  const win = await app.firstWindow()
  win.on('console', (m) => {
    if (m.type() === 'error') console.log('[renderer:error]', m.text().slice(0, 300))
  })
  await win.waitForLoadState('domcontentloaded')
  await win.getByRole('button', { name: 'Search', exact: true }).click()
  await win.getByRole('checkbox', { name: /Spotify/ }).click()
  await win.getByRole('checkbox', { name: /Local/ }).click()
  await win.getByRole('textbox', { name: 'Search', exact: true }).fill(query)
  await win.getByRole('radio', { name: 'Songs' }).click()
  const row = win.locator('[role=listitem]').first()
  await row.waitFor({ timeout: 20000 })
  await row.getByRole('button', { name: artistName, exact: true }).first().click()

  await win.getByRole('heading', { level: 1, name: artistName }).waitFor({ timeout: 20000 })
  await win.waitForTimeout(1500)
  results.popular = await win
    .locator('section', { hasText: 'Popular' })
    .locator('[role=listitem]')
    .count()
  results.releases = await win
    .locator('section', { hasText: 'Discography' })
    .locator('button:has(img), button:has(svg)')
    .count()
  results.downloadAll = await win.getByRole('button', { name: /Download all/ }).textContent()
  await win.screenshot({ path: 'screenshots/18-artist-soundcloud.png' })

  await win
    .locator('section', { hasText: 'Discography' })
    .locator('button', { has: win.locator('img') })
    .first()
    .click()
  await win.locator('h1').waitFor({ timeout: 20000 })
  await win.locator('[role=listitem]').first().waitFor({ timeout: 20000 })
  await win.waitForTimeout(1200)
  results.albumTitle = await win.locator('h1').textContent()
  results.albumKicker = await win
    .locator('h1')
    .locator('xpath=preceding-sibling::p[1]')
    .textContent()
  results.albumTracks = await win.locator('[role=listitem]').count()
  await win.getByRole('button', { name: /Download all/ }).click()
  await win.getByRole('group', { name: 'Confirm download all' }).waitFor({ timeout: 5000 })
  results.confirmText = await win.getByRole('group', { name: 'Confirm download all' }).textContent()
  await win.screenshot({ path: 'screenshots/19-album-soundcloud.png' })
  await win.getByRole('button', { name: 'Cancel' }).click()

  await win.getByRole('button', { name: 'Back' }).first().click()
  await win.getByRole('heading', { level: 1, name: artistName }).waitFor({ timeout: 5000 })
  results.backToArtist = true
  results.queuedDownloads = (await win.evaluate(() => window.api.invoke('downloads:list'))).length
} catch (err) {
  results.failure = String(err?.message ?? err).slice(0, 500)
  await (await app.firstWindow()).screenshot({ path: 'screenshots/phase7b-failure.png' })
} finally {
  console.log(JSON.stringify(results, null, 2))
  await app.close()
  rmSync(userData, { recursive: true, force: true })
}
