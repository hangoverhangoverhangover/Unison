// Launch the built app with Playwright's Electron support, drive the main
// flows, and screenshot each screen into screenshots/.
//
// Usage: npm run smoke [-- <music folder>]
// Runs against a throwaway userData dir so it never touches your real library.
// With a music folder, it stubs the folder picker to return it, scans, plays
// a track and opens the queue.
import { _electron as electron } from 'playwright-core'
import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

const musicDir = process.argv[2] ? resolve(process.argv[2]) : undefined
const userData = mkdtempSync(join(tmpdir(), 'cp-smoke-'))
mkdirSync('screenshots', { recursive: true })
/** @returns {Promise<Buffer>} */
function shot(win, name) {
  return win.screenshot({ path: `screenshots/${name}.png` })
}
const results = {}

const app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`] })
try {
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(800)

  results.info = await win.evaluate(() => window.api.invoke('app:getInfo'))
  results.nodeLeakedToRenderer = await win.evaluate(
    () => typeof window.require !== 'undefined' || typeof window.process !== 'undefined'
  )
  results.autoplay = await app.evaluate(({ app }) =>
    app.commandLine.getSwitchValue('autoplay-policy')
  )
  await shot(win, '01-empty')

  results.spotifyStatus = await win.evaluate(() => window.api.invoke('spotify:getStatus'))
  results.widevine = await app.evaluate(({ components }) =>
    components.status ? components.status() : 'n/a'
  )
  await win.getByRole('button', { name: /Liked Songs/ }).click()
  await win.waitForTimeout(300)
  await shot(win, '05-likes-disconnected')
  await win.getByRole('button', { name: 'Search', exact: true }).click()
  await win.waitForTimeout(300)
  await shot(win, '06-search-disconnected')
  await win.getByRole('button', { name: /Local Files/ }).click()

  if (musicDir) {
    await app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
    }, musicDir)
    await win.getByRole('button', { name: 'Add a music folder' }).click()
    await win.getByRole('listitem').first().waitFor({ timeout: 15000 })
    await win.waitForTimeout(600)
    results.rows = await win.getByRole('listitem').count()
    await shot(win, '02-library')

    await win.getByRole('listitem').nth(1).dblclick()
    await win.getByRole('button', { name: 'Pause' }).waitFor({ timeout: 10000 })
    await win.waitForTimeout(1500)
    results.mediaSessionTitle = await win.evaluate(() => navigator.mediaSession.metadata?.title)
    results.positionAdvanced = await win.evaluate(
      () => document.querySelector('[aria-label="Seek"]')?.previousElementSibling?.textContent
    )

    // Seek via keyboard on the seek bar (exercises Range requests on media://).
    await win.getByRole('slider', { name: 'Seek' }).focus()
    await win.keyboard.press('ArrowRight')
    await win.keyboard.press('ArrowRight')
    await win.waitForTimeout(500)
    results.afterSeek = await win.evaluate(
      () => document.querySelector('[aria-label="Seek"]')?.previousElementSibling?.textContent
    )

    // Queue: right-click the last row, Add to queue, open the panel.
    await win.getByRole('listitem').last().click({ button: 'right' })
    await win.getByRole('menuitem', { name: 'Add to queue' }).click()
    await win.getByRole('button', { name: 'Queue, details and Jam' }).click()
    await win.getByRole('tab', { name: 'Queue' }).click()
    await win.waitForTimeout(500)
    await shot(win, '03-playing-queue')

    await win.getByRole('button', { name: 'Settings', exact: true }).click()
    await win.waitForTimeout(300)
    await shot(win, '04-settings')
  }
  console.log(JSON.stringify(results, null, 2))
} finally {
  await app.close()
  rmSync(userData, { recursive: true, force: true })
}
