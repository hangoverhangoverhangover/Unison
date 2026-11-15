// QoL round check (no login): artist results in search, in-list search, app playlist
// cover, hide/unhide via the Library tab, and drag-reordering playlists in the sidebar.
// Usage: npm run build first, then node scripts/smoke-qol.mjs <path-to-a-png>
import { _electron as electron } from 'playwright-core'
import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

const coverPng = resolve(process.argv[2] ?? 'design/discord-assets/app_icon.png')
const userData = mkdtempSync(join(tmpdir(), 'cp-smoke-qol-'))
mkdirSync('screenshots', { recursive: true })
const results = {}
const sidebarNames = (win) => win.locator('nav li span.font-bold').allTextContents()

const app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`] })
try {
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, coverPng)
  const win = await app.firstWindow()
  win.on('console', (m) => {
    if (m.type() === 'error') console.log('[renderer:error]', m.text().slice(0, 300))
  })
  await win.waitForLoadState('domcontentloaded')

  // 1. Artists in search (SoundCloud, logged out).
  await win.getByRole('button', { name: 'Search', exact: true }).click()
  await win.getByRole('textbox', { name: 'Search', exact: true }).fill('forss')
  const artists = win.getByRole('region', { name: 'Artists' })
  await artists.waitFor({ timeout: 20000 })
  results.artistCards = await artists.getByRole('button').count()
  results.firstArtist = await artists.getByRole('button').first().textContent()
  await win.waitForTimeout(800)
  await win.screenshot({ path: 'screenshots/23-search-artists.png' })

  // 2. In-list search on an album page (opened from the artist).
  await artists.getByRole('button').first().click()
  await win.getByRole('heading', { level: 1, name: 'Forss' }).waitFor({ timeout: 20000 })
  await win
    .locator('section', { hasText: 'Discography' })
    .locator('button', { has: win.locator('img') })
    .first()
    .click()
  await win.locator('[role=listitem]').first().waitFor({ timeout: 20000 })
  const before = await win.locator('[role=listitem]').count()
  await win.keyboard.press('Control+f')
  await win.getByRole('textbox', { name: 'Search in this release' }).fill('voca')
  await win.waitForTimeout(300)
  results.albumRowsBefore = before
  results.albumRowsFiltered = await win.locator('[role=listitem]').count()
  await win.screenshot({ path: 'screenshots/24-list-filter.png' })

  // 3. Two app playlists, one with a custom cover.
  for (const name of ['Alpha', 'Beta', 'Gamma']) {
    await win.evaluate((n) => window.api.invoke('playlists:create', n), name)
  }
  await win.evaluate(async () => {
    await window.api.invoke('playlists:getApp')
  })
  await win.reload()
  await win.waitForLoadState('domcontentloaded')
  await win.locator('nav li', { hasText: 'Beta' }).waitFor({ timeout: 10000 })
  results.sidebarStart = await sidebarNames(win)
  await win.locator('nav li', { hasText: 'Beta' }).locator('button').click()
  await win.getByRole('button', { name: 'Choose a cover image' }).click()
  await win.getByRole('button', { name: 'Use automatic cover' }).waitFor({ timeout: 10000 })
  results.coverSrc = await win
    .locator('nav li', { hasText: 'Beta' })
    .locator('img')
    .getAttribute('src')
  await win.screenshot({ path: 'screenshots/25-playlist-cover.png' })

  // 4. Drag Alpha (last) to the top of the sidebar list.
  const gamma = win.locator('nav li', { hasText: 'Alpha' }).locator('button')
  const first = win.locator('nav li').first().locator('button')
  const g = await gamma.boundingBox()
  const f = await first.boundingBox()
  await win.mouse.move(g.x + 40, g.y + g.height / 2)
  await win.mouse.down()
  for (let i = 1; i <= 12; i++) {
    await win.mouse.move(g.x + 40, g.y + g.height / 2 + ((f.y - g.y - 10) * i) / 12)
    await win.waitForTimeout(30)
  }
  await win.mouse.up()
  await win.waitForTimeout(600)
  results.sidebarAfterDrag = await sidebarNames(win)
  results.savedOrder = (await win.evaluate(() => window.api.invoke('playlists:getPrefs'))).order

  // 5. Hide Alpha from the sidebar, then unhide it in the Library tab.
  await win.locator('nav li', { hasText: 'Alpha' }).locator('button').click({ button: 'right' })
  await win.getByRole('menuitem', { name: 'Hide from sidebar' }).click()
  await win.waitForTimeout(300)
  results.sidebarAfterHide = await sidebarNames(win)
  await win.getByRole('button', { name: /hidden playlist/ }).click()
  await win.getByRole('heading', { level: 1, name: 'Your Library' }).waitFor()
  await win.getByRole('radio', { name: /Hidden/ }).click()
  results.libraryHidden = await win.locator('main li span.font-bold').allTextContents()
  await win.screenshot({ path: 'screenshots/26-library-hidden.png' })
  await win.getByRole('button', { name: 'Show Alpha in the sidebar' }).click()
  await win.waitForTimeout(300)
  results.sidebarAfterUnhide = await sidebarNames(win)
  results.prefsAfter = await win.evaluate(() => window.api.invoke('playlists:getPrefs'))
} catch (err) {
  results.failure = String(err?.message ?? err).slice(0, 600)
  await (await app.firstWindow()).screenshot({ path: 'screenshots/qol-failure.png' })
} finally {
  console.log(JSON.stringify(results, null, 2))
  await app.close()
  rmSync(userData, { recursive: true, force: true })
}
