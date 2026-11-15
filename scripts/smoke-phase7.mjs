// Phase 7 check (no login): the tools get copied into userData, a public SoundCloud
// track downloads through yt-dlp into a throwaway folder, lands in Local Files linked
// to SoundCloud, and the Downloads view and row button show it.
// Usage: npm run build first, then node scripts/smoke-phase7.mjs [query]
import { _electron as electron } from 'playwright-core'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const query = process.argv[2] ?? 'forss flickermood'
const userData = mkdtempSync(join(tmpdir(), 'cp-smoke-p7-'))
const folder = join(userData, 'downloads-out')
mkdirSync('screenshots', { recursive: true })
const results = {}

/** Poll main through IPC until `check(value)` holds (waitForFunction can't await). */
async function waitFor(win, channel, check, timeoutMs) {
  const end = Date.now() + timeoutMs
  for (;;) {
    const value = await win.evaluate((c) => window.api.invoke(c), channel)
    if (check(value)) return value
    if (Date.now() > end)
      throw new Error(`timed out waiting on ${channel}: ${JSON.stringify(value).slice(0, 300)}`)
    await new Promise((r) => setTimeout(r, 1000))
  }
}

const app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`] })
try {
  // Folder picker returns the throwaway folder instead of opening a dialog.
  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
  }, folder)
  const win = await app.firstWindow()
  win.on('console', (m) => {
    if (m.type() === 'error') console.log('[renderer:error]', m.text().slice(0, 300))
  })
  await win.waitForLoadState('domcontentloaded')

  await win.getByRole('button', { name: 'Downloads', exact: false }).first().click()
  await win.getByText('Nothing downloaded yet').waitFor({ timeout: 10000 })
  await win.getByRole('button', { name: 'Change folder' }).click()
  await win.getByText(`Saving to ${folder}`).waitFor({ timeout: 5000 })
  await win.screenshot({ path: 'screenshots/14-downloads-empty.png' })

  const ready = Date.now()
  results.status = await waitFor(win, 'downloads:getStatus', (s) => s.tools === 'ready', 300000)
  results.toolsReadyMs = Date.now() - ready
  results.toolsCopied = ['yt-dlp.exe', 'ffmpeg.exe'].every((f) =>
    existsSync(join(userData, 'bin', f))
  )

  await win.getByRole('button', { name: 'Search', exact: true }).click()
  await win.getByRole('checkbox', { name: /Spotify/ }).click()
  await win.getByRole('checkbox', { name: /Local/ }).click()
  await win.getByRole('textbox', { name: 'Search', exact: true }).fill(query)
  await win.getByRole('radio', { name: 'Songs' }).click()
  const row = win.locator('[role=listitem]', { hasText: 'Flickermood' }).first()
  await row.waitFor({ timeout: 20000 })
  await row.hover()
  await row.getByRole('button', { name: /^Download / }).click()
  await win.waitForTimeout(1200)
  await win.screenshot({ path: 'screenshots/15-search-downloading.png' })

  await win.getByRole('button', { name: 'Downloads', exact: false }).first().click()
  await win.waitForTimeout(400)
  await win.screenshot({ path: 'screenshots/16-downloads-active.png' })
  const [item] = await waitFor(
    win,
    'downloads:list',
    (l) => l.length > 0 && l.every((i) => i.status === 'done' || i.status === 'failed'),
    180000
  )
  results.item = {
    status: item.status,
    method: item.method,
    error: item.error,
    filePath: item.filePath
  }
  const locals = await win.evaluate(() => window.api.invoke('library:getTracks'))
  const local = locals.find((t) => t.id === item.localTrackId)
  results.localTrack = local && {
    title: local.title,
    artists: local.artists,
    sourceScId: local.sourceScId,
    durationMs: local.durationMs,
    art: !!local.artworkUrl
  }
  await win.waitForTimeout(500)
  await win.screenshot({ path: 'screenshots/17-downloads-done.png' })
  // Enqueueing again returns the same finished item.
  const again = await win.evaluate((t) => window.api.invoke('downloads:enqueue', t), item.track)
  results.dedupe = again.id === item.id
} catch (err) {
  results.failure = String(err?.message ?? err)
  await (await app.firstWindow()).screenshot({ path: 'screenshots/phase7-failure.png' })
} finally {
  console.log(JSON.stringify(results, null, 2))
  const t = Date.now()
  await app.close()
  console.log('closed in', Date.now() - t, 'ms')
  rmSync(userData, { recursive: true, force: true })
}
