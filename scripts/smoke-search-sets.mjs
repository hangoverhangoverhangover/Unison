// Search check (no login): the combined Search page shows a top result, songs,
// artists and SoundCloud albums & playlists; a set opens with its tracks; quick
// search (Ctrl+K) finds results and hands its query to the full page.
// Usage: npm run build first, then node scripts/smoke-search-sets.mjs [query]
import { _electron as electron } from 'playwright-core'
import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const query = process.argv[2] ?? 'hi-c'
const userData = mkdtempSync(join(tmpdir(), 'cp-smoke-sets-'))
mkdirSync('screenshots', { recursive: true })
const results = {}

const app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`] })
try {
  const win = await app.firstWindow()
  win.on('console', (m) => {
    if (m.type() === 'error') console.log('[renderer:error]', m.text().slice(0, 300))
  })
  await win.waitForLoadState('domcontentloaded')

  // Quick search from anywhere.
  await win.getByRole('button', { name: /Search Spotify, SoundCloud/ }).click()
  const quick = win.getByRole('dialog', { name: 'Quick search' })
  await quick.getByRole('textbox', { name: 'Quick search' }).fill(query)
  await quick.getByRole('option').nth(1).waitFor({ timeout: 20000 })
  results.quickOptions = await quick.getByRole('option').count()
  await win.screenshot({ path: 'screenshots/35-quick-search.png' })
  await win.keyboard.press('Enter')

  // Full page, with the query handed over.
  await win.getByRole('textbox', { name: 'Search', exact: true }).waitFor({ timeout: 5000 })
  results.handedQuery = await win.getByRole('textbox', { name: 'Search', exact: true }).inputValue()
  const sets = win.getByRole('region', { name: 'Albums & playlists' })
  await sets.waitFor({ timeout: 20000 })
  await win.waitForTimeout(1200)
  results.topResult = await win.getByRole('region', { name: 'Top result' }).count()
  results.cards = await sets.getByRole('button').count()
  await win.screenshot({ path: 'screenshots/27-search-playlists.png' })

  // Albums & playlists filter: open one.
  await win.getByRole('radio', { name: 'Albums & playlists' }).click()
  await win.locator('main .grid button').first().click()
  await win.locator('h1').waitFor({ timeout: 20000 })
  await win.locator('[role=listitem]').first().waitFor({ timeout: 20000 })
  results.openedTitle = await win.locator('h1').textContent()
  results.openedTracks = await win.locator('[role=listitem]').count()

  // Ctrl+K opens quick search from any page once the window has focus.
  await win.locator('main h1').click()
  await win.keyboard.press('Control+k')
  await win.getByRole('dialog', { name: 'Quick search' }).waitFor({ timeout: 5000 })
  results.ctrlK = true
  await win.keyboard.press('Escape')
  await win
    .getByRole('dialog', { name: 'Quick search' })
    .waitFor({ state: 'detached', timeout: 5000 })
  results.escCloses = true
} catch (err) {
  results.failure = String(err?.message ?? err).slice(0, 500)
  await (await app.firstWindow()).screenshot({ path: 'screenshots/sets-failure.png' })
} finally {
  console.log(JSON.stringify(results, null, 2))
  await app.close()
  rmSync(userData, { recursive: true, force: true })
}
