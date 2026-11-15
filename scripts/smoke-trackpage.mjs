// SoundCloud track page check (no login): open a track from search by its title,
// confirm the page shows description/stats/uploader, and that comment replies appear.
// Usage: npm run build first, then node scripts/smoke-trackpage.mjs [query] [title]
import { _electron as electron } from 'playwright-core'
import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const query = process.argv[2] ?? 'forss flickermood'
const title = process.argv[3] ?? 'Flickermood'
const userData = mkdtempSync(join(tmpdir(), 'cp-smoke-track-'))
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
  await row.getByRole('button', { name: title, exact: true }).click()
  await win.getByRole('heading', { level: 1, name: title }).waitFor({ timeout: 20000 })
  await win
    .getByText(/\d+ comments?$/)
    .first()
    .waitFor({ timeout: 30000 })
  await win.waitForTimeout(1500)
  results.commentsHeading = await win
    .getByText(/\d+ comments?$/)
    .first()
    .textContent()
  results.stats = await win
    .getByText(/\d[\d.]*[kM]? plays?/)
    .first()
    .textContent()
  results.markers = await win.getByRole('button', { name: /comments? at/ }).count()
  results.uploader = await win.locator('aside button').first().textContent()
  await win.screenshot({ path: 'screenshots/20-track-page.png' })
  const main = win.locator('main > div').first()
  for (let i = 0; i < 25 && (await win.locator('[aria-label^="Reply from"]').count()) === 0; i++) {
    await main.evaluate((el) => el.scrollBy(0, 1200))
    await win.waitForTimeout(250)
  }
  results.repliesVisible = await win.locator('[aria-label^="Reply from"]').count()
  if (results.repliesVisible > 0) {
    await win.locator('[aria-label^="Reply from"]').first().scrollIntoViewIfNeeded()
    await win.screenshot({ path: 'screenshots/21-track-replies.png' })
  }
} catch (err) {
  results.failure = String(err?.message ?? err).slice(0, 500)
  await (await app.firstWindow()).screenshot({ path: 'screenshots/trackpage-failure.png' })
} finally {
  console.log(JSON.stringify(results, null, 2))
  await app.close()
  rmSync(userData, { recursive: true, force: true })
}
