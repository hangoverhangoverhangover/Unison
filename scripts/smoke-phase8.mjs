// Phase 8 check (no login): Find on SoundCloud for a local-style track, the results
// dialog, then the mini player window: it opens, follows playback, and its controls
// drive the main window.
// Usage: npm run build first, then node scripts/smoke-phase8.mjs
import { _electron as electron } from 'playwright-core'
import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const userData = mkdtempSync(join(tmpdir(), 'cp-smoke-p8-'))
mkdirSync('screenshots', { recursive: true })
const results = {}

const app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`] })
try {
  const win = await app.firstWindow()
  win.on('console', (m) => {
    if (m.type() === 'error') console.log('[renderer:error]', m.text().slice(0, 300))
  })
  await win.waitForLoadState('domcontentloaded')

  // Find on SoundCloud (main process), with a local-style source track.
  const local = {
    id: 'local:x',
    provider: 'local',
    nativeId: 'x',
    title: 'Flickermood',
    artists: ['Forss'],
    durationMs: 213_000
  }
  const found = await win.evaluate((t) => window.api.invoke('music:findOn', t, 'soundcloud'), local)
  results.find = found.matches.map((m) => `${m.reason}: ${m.track.artists[0]} - ${m.track.title}`)

  // Same thing through the UI: search, right-click a SoundCloud row... the menu offers
  // Spotify only (not connected here), so drive the dialog store directly.
  await win.getByRole('button', { name: 'Search', exact: true }).click()
  await win.getByRole('checkbox', { name: /Spotify/ }).click()
  await win.getByRole('checkbox', { name: /Local/ }).click()
  await win.getByRole('textbox', { name: 'Search', exact: true }).fill('forss flickermood')
  await win.getByRole('radio', { name: 'Songs' }).click()
  const row = win.locator('[role=listitem]').first()
  await row.waitFor({ timeout: 20000 })
  await row.click({ button: 'right' })
  results.menuItems = await win.getByRole('menuitem').allTextContents()
  await win.keyboard.press('Escape')

  // Play the first result, then open the mini player.
  await row.dblclick()
  await win.getByRole('button', { name: 'Pause' }).first().waitFor({ timeout: 30000 })
  const miniPromise = app.waitForEvent('window')
  await win.getByRole('button', { name: 'Mini player' }).click()
  const mini = await miniPromise
  await mini.waitForLoadState('domcontentloaded')
  await mini.getByRole('button', { name: 'Pause' }).waitFor({ timeout: 10000 })
  await mini.waitForTimeout(1500)
  results.miniTitle = await mini.locator('p').first().textContent()
  results.miniBounds = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((w) => ({ top: w.isAlwaysOnTop(), size: w.getSize() }))
  )
  results.miniClock1 = await mini.locator('span.tabular-nums').first().textContent()
  await mini.waitForTimeout(4000)
  results.miniClock2 = await mini.locator('span.tabular-nums').first().textContent()
  results.mainClock = await win.evaluate(
    () => document.querySelector('[aria-label="Seek"]')?.previousElementSibling?.textContent
  )
  await mini.screenshot({ path: 'screenshots/22-mini-player.png' })
  results.mainButtonActive = await win.getByRole('button', { name: 'Close mini player' }).count()

  // Pause from the mini player: the main window pauses.
  await mini.getByRole('button', { name: 'Pause' }).click()
  await win.getByRole('button', { name: 'Play', exact: true }).first().waitFor({ timeout: 5000 })
  results.pausedFromMini = true
  await mini.getByRole('button', { name: 'Play', exact: true }).waitFor({ timeout: 5000 })
  results.miniShowsPaused = true

  // Close from the mini player.
  // The window closes during the click, which Playwright reports as a closed target.
  await mini
    .getByRole('button', { name: 'Close mini player' })
    .click({ noWaitAfter: true })
    .catch((err) => {
      if (!/closed/i.test(String(err))) throw err
    })
  await win.getByRole('button', { name: 'Mini player' }).waitFor({ timeout: 5000 })
  results.closedFromMini = true
} catch (err) {
  results.failure = String(err?.message ?? err).slice(0, 500)
  await (await app.firstWindow()).screenshot({ path: 'screenshots/phase8-failure.png' })
} finally {
  console.log(JSON.stringify(results, null, 2))
  await app.close()
  rmSync(userData, { recursive: true, force: true })
}
