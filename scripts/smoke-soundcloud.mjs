// Anonymous SoundCloud check: search in the app, play the first playable result
// over HLS, confirm the clock moves. No login. Usage: npm run build first, then
// node scripts/smoke-soundcloud.mjs [query]
import { _electron as electron } from 'playwright-core'
import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const query = process.argv[2] ?? 'lofi beats'
const userData = mkdtempSync(join(tmpdir(), 'cp-smoke-sc-'))
mkdirSync('screenshots', { recursive: true })
const results = {}

const app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`] })
try {
  const win = await app.firstWindow()
  win.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning')
      console.log(`[renderer:${m.type()}]`, m.text())
  })
  await win.waitForLoadState('domcontentloaded')
  await win.getByRole('button', { name: 'Search', exact: true }).click()
  await win.getByRole('checkbox', { name: /Spotify/ }).click()
  await win.getByRole('checkbox', { name: /Local/ }).click()
  await win.getByRole('textbox', { name: 'Search', exact: true }).fill(query)
  await win.getByRole('radio', { name: 'Songs' }).click()
  await win.getByRole('listitem').first().waitFor({ timeout: 20000 })
  await win.waitForTimeout(800)
  results.rows = await win.getByRole('listitem').count()
  results.labelled = await win.locator('[role=listitem][title]').count()
  await win.screenshot({ path: 'screenshots/07-soundcloud-search.png' })

  // First row without an unplayable label.
  const playable = win.locator('[role=listitem]:not([title])').first()
  results.playing = await playable.locator('span.truncate').first().textContent()
  await playable.dblclick()
  await win.getByRole('button', { name: 'Pause' }).waitFor({ timeout: 20000 })
  await win.waitForTimeout(4000)
  const clock = () =>
    win.evaluate(
      () => document.querySelector('[aria-label="Seek"]')?.previousElementSibling?.textContent
    )
  results.clockAfter4s = await clock()
  await win.getByRole('slider', { name: 'Seek' }).focus()
  await win.keyboard.press('ArrowRight')
  await win.keyboard.press('ArrowRight')
  await win.waitForTimeout(1500)
  results.clockAfterSeek = await clock()
  results.error = await win.locator('[role=alert]').allTextContents()
  await win.screenshot({ path: 'screenshots/08-soundcloud-playing.png' })
  console.log(JSON.stringify(results, null, 2))
} finally {
  await app.close()
  rmSync(userData, { recursive: true, force: true })
}
