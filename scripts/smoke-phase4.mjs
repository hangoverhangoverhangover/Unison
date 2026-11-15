// Phase 4 check (no service login needed): create an app playlist, add local tracks
// to it from the right-click menu, open it, remove one, rename it, and run a "Both"
// search. Usage: npm run build first, then node scripts/smoke-phase4.mjs <music folder>
import { _electron as electron } from 'playwright-core'
import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

const musicDir = resolve(process.argv[2] ?? '.')
const userData = mkdtempSync(join(tmpdir(), 'cp-smoke-p4-'))
mkdirSync('screenshots', { recursive: true })
const results = {}

const app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`] })
try {
  const win = await app.firstWindow()
  win.on('console', (m) => {
    if (m.type() === 'error') console.log('[renderer:error]', m.text().slice(0, 400))
  })
  await win.waitForLoadState('domcontentloaded')
  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
  }, musicDir)
  await win.getByRole('button', { name: 'Add a music folder' }).click()
  await win.getByRole('listitem').first().waitFor({ timeout: 15000 })

  // Liked Songs with no service connected.
  await win.getByRole('button', { name: /Liked Songs/ }).click()
  await win.waitForTimeout(400)
  await win.screenshot({ path: 'screenshots/10-liked-empty.png' })

  // Add two local tracks to a new playlist from the right-click menu.
  await win.getByRole('button', { name: /Local Files/ }).click()
  const rows = win.getByRole('listitem')
  await rows.nth(1).click({ button: 'right' })
  await win.getByRole('menuitem', { name: 'Add to playlist' }).hover()
  await win.getByRole('menuitem', { name: 'New playlist' }).click()
  await win.waitForTimeout(600)
  await win.getByRole('button', { name: /Local Files/ }).click()
  await rows.nth(2).click({ button: 'right' })
  await win.getByRole('menuitem', { name: 'Add to playlist' }).hover()
  await win.getByRole('menuitem', { name: 'New playlist', exact: true }).last().click()
  await win.waitForTimeout(600)
  // Adding to an existing playlist keeps you where you are; open it from the sidebar.
  await win
    .locator('nav')
    .getByRole('button', { name: /^New playlist [0-9]+ tracks?$/ })
    .click()
  await win.waitForTimeout(600)
  results.playlistRows = await win.getByRole('listitem').count()
  await win.screenshot({ path: 'screenshots/11-app-playlist.png' })

  // Remove the first entry, then rename the playlist.
  await win.getByRole('listitem').first().click({ button: 'right' })
  await win.getByRole('menuitem', { name: 'Remove from this playlist' }).click()
  await win.waitForTimeout(500)
  results.afterRemove = await win.getByRole('listitem').count()
  await win.getByRole('button', { name: 'Rename playlist' }).click()
  await win.getByRole('textbox', { name: 'Playlist name' }).fill('Road trip')
  await win.keyboard.press('Enter')
  await win.waitForTimeout(500)
  results.title = await win.locator('h1').first().textContent()
  results.sidebarHasIt = await win.getByRole('button', { name: /Road trip/ }).count()

  // Search everything (SoundCloud works logged out; Spotify shows a connect hint).
  await win.getByRole('button', { name: 'Search', exact: true }).click()
  await win.getByRole('textbox', { name: 'Search', exact: true }).fill('lofi')
  await win.getByRole('region', { name: 'Songs' }).waitFor({ timeout: 20000 })
  await win.waitForTimeout(800)
  results.sections = await win.getByRole('region').count()
  results.connectHint = await win.getByText(/Connect Spotify in Settings/).count()
  await win.screenshot({ path: 'screenshots/12-search-both.png' })
} catch (err) {
  results.failure = String(err?.message ?? err)
  await (await app.firstWindow()).screenshot({ path: 'screenshots/phase4-failure.png' })
} finally {
  console.log(JSON.stringify(results, null, 2))
  await app.close()
  rmSync(userData, { recursive: true, force: true })
}
