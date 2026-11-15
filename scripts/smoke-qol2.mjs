// QoL round 2 check (no login): settings sections, local sort + tag editor on a
// generated file, history -> stats/smart playlists, session restore across a restart,
// close to tray, and audio (SoundCloud through the Web Audio graph with EQ on).
// Usage: npm run build first, then node scripts/smoke-qol2.mjs
import { _electron as electron } from 'playwright-core'
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

const userData = mkdtempSync(join(tmpdir(), 'cp-smoke-qol2-'))
const music = join(userData, 'music')
mkdirSync(music, { recursive: true })
// A short silent mp3 with no tags, named "Artist - Title".
execFileSync(resolve('bin/ffmpeg.exe'), [
  '-hide_banner',
  '-loglevel',
  'error',
  '-f',
  'lavfi',
  '-i',
  'anullsrc=r=44100:cl=stereo',
  '-t',
  '3',
  '-c:a',
  'libmp3lame',
  '-q:a',
  '9',
  join(music, 'Smoke Artist - Smoke Title.mp3')
])
mkdirSync('screenshots', { recursive: true })
const results = {}

async function launch() {
  const app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`] })
  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
  }, music)
  const win = await app.firstWindow()
  win.on('console', (m) => {
    if (m.type() === 'error') console.log('[renderer:error]', m.text().slice(0, 300))
  })
  await win.waitForLoadState('domcontentloaded')
  return { app, win }
}

let { app, win } = await launch()
try {
  // Settings: behaviour, sound, shortcuts.
  await win.getByRole('button', { name: 'Settings', exact: true }).click()
  await win.getByRole('switch', { name: 'Equalizer' }).waitFor({ timeout: 10000 })
  await win.getByRole('switch', { name: 'Equalizer' }).click()
  await win.getByRole('button', { name: 'Bass boost' }).click()
  await win.getByRole('switch', { name: 'Volume levelling' }).click()
  await win.waitForTimeout(800)
  results.audioSaved = await win.evaluate(() => window.api.invoke('audio:get'))
  results.closeToTray = (await win.evaluate(() => window.api.invoke('prefs:get'))).closeToTray
  await win.getByRole('heading', { name: 'Sound', exact: true }).scrollIntoViewIfNeeded()
  await win.screenshot({ path: 'screenshots/28-settings-sound.png' })

  // Local files: add the folder, fill tags from the file name.
  await win.evaluate(() => window.api.invoke('library:addFolder'))
  await win
    .getByRole('button', { name: /Local Files/ })
    .first()
    .click()
  const fill = win.getByRole('button', { name: /Fill tags from file names/ })
  await fill.waitFor({ timeout: 20000 })
  await fill.click()
  await win.getByRole('button', { name: /Write tags to 1 file/ }).click()
  await win.getByText(/1 file updated/).waitFor({ timeout: 20000 })
  await win.getByRole('button', { name: 'Done' }).click()
  await win.waitForTimeout(1500)
  const local = await win.evaluate(() => window.api.invoke('library:getTracks'))
  results.taggedTrack = local.map((t) => ({ title: t.title, artists: t.artists }))
  await win.getByRole('radio', { name: 'Album' }).click()
  results.sortChips = await win
    .getByRole('radiogroup', { name: 'Sort local files' })
    .getByRole('radio')
    .allTextContents()

  // History: record plays directly, then Stats and On repeat.
  const t = local[0]
  for (let i = 0; i < 3; i++) {
    await win.evaluate(
      (tr) =>
        window.api.invoke('history:record', {
          track: tr,
          playedMs: 40000,
          startedAt: Date.now() - 1000
        }),
      t
    )
  }
  await win.getByRole('button', { name: 'Stats', exact: true }).click()
  await win.getByText('Top artists').waitFor({ timeout: 10000 })
  results.stats = await win.evaluate(() => window.api.invoke('history:stats', 'week'))
  results.stats = {
    totalPlays: results.stats.totalPlays,
    topArtist: results.stats.topArtists[0]?.name
  }
  await win.screenshot({ path: 'screenshots/29-stats.png' })
  await win
    .getByRole('button', { name: /On repeat/ })
    .first()
    .click()
  await win.locator('[role=listitem]').first().waitFor({ timeout: 10000 })
  results.onRepeat = await win.locator('[role=listitem]').count()

  // Audio: play a SoundCloud track through the graph (EQ + levelling on), check it plays.
  await win.getByRole('button', { name: 'Search', exact: true }).click()
  await win.getByRole('checkbox', { name: /Spotify/ }).click()
  await win.getByRole('checkbox', { name: /Local/ }).click()
  await win.getByRole('textbox', { name: 'Search', exact: true }).fill('forss flickermood')
  await win.getByRole('radio', { name: 'Songs' }).click()
  const row = win.locator('[role=listitem]').first()
  await row.waitFor({ timeout: 20000 })
  await row.dblclick()
  await win.getByRole('button', { name: 'Pause' }).first().waitFor({ timeout: 30000 })
  await win.waitForTimeout(4000)
  results.clockAfter4s = await win.evaluate(
    () => document.querySelector('[aria-label="Seek"]')?.previousElementSibling?.textContent
  )
  results.audioContext = await win.evaluate(() => {
    const els = [...document.querySelectorAll('audio')]
    return els.map((e) => ({
      paused: e.paused,
      crossOrigin: e.crossOrigin,
      t: Math.round(e.currentTime)
    }))
  })
  // Details panel: SoundCloud title links to the track page.
  await win.getByRole('button', { name: 'Queue, details and Jam' }).click()
  await win.getByRole('tab', { name: 'Details' }).click()
  await win.getByRole('tab', { name: 'Details', selected: true }).waitFor({ timeout: 5000 })
  results.detailsTitleLink = await win.locator('aside button', { hasText: 'Flickermood' }).count()
  await win.screenshot({ path: 'screenshots/31-details-soundcloud.png' })
  await win.locator('main').click({ position: { x: 5, y: 5 } })
  await win.keyboard.press('Space')
  await win.waitForTimeout(300)
  results.spacePaused = await win
    .getByRole('button', { name: 'Play', exact: true })
    .first()
    .isVisible()
  await win.waitForTimeout(1500) // let the session save

  // Close to tray: closing hides the window, the app keeps running.
  await win.evaluate(() => window.close())
  await app.waitForEvent('window', { timeout: 1500 }).catch(() => undefined)
  results.afterClose = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((w) => ({
      visible: w.isVisible(),
      destroyed: w.isDestroyed()
    }))
  )
} catch (err) {
  results.failure = String(err?.message ?? err).slice(0, 600)
  await win.screenshot({ path: 'screenshots/qol2-failure.png' }).catch(() => undefined)
} finally {
  await app.close()
}

// Session restore: relaunch with the same profile.
;({ app, win } = await launch())
try {
  await win.waitForTimeout(2500)
  results.restored = await win.evaluate(() => document.body.innerText.includes('Flickermood'))
  results.restoredClock = await win.evaluate(
    () => document.querySelector('[aria-label="Seek"]')?.previousElementSibling?.textContent
  )
  await win.screenshot({ path: 'screenshots/30-session-restored.png' })
} catch (err) {
  results.restoreFailure = String(err?.message ?? err).slice(0, 300)
} finally {
  console.log(JSON.stringify(results, null, 2))
  await app.close()
  rmSync(userData, { recursive: true, force: true })
}
