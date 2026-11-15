// Anonymous check for SoundCloud's DRM-only (Widevine) tracks: find one via search,
// play it, confirm the clock moves. Needs a VMP-signed Electron (npm run vmp:sign).
// Usage: npm run build first, then node scripts/smoke-soundcloud-drm.mjs [query]
import { _electron as electron } from 'playwright-core'
import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const query = process.argv[2] ?? 'Drake'
const userData = mkdtempSync(join(tmpdir(), 'cp-smoke-drm-'))
mkdirSync('screenshots', { recursive: true })
const results = {}

const app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`] })
try {
  const win = await app.firstWindow()
  win.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning')
      console.log(`[renderer:${m.type()}]`, m.text().slice(0, 300))
  })
  await win.waitForLoadState('domcontentloaded')
  const tracks = await win.evaluate(
    (q) => window.api.invoke('music:search', 'soundcloud', q, 0),
    query
  )
  const drm = tracks.find((t) => t.availability === 'drm')
  results.searched = tracks.length
  results.drmFound = tracks.filter((t) => t.availability === 'drm').length
  if (!drm) throw new Error('No DRM-only track in the results; try another query.')
  results.track = `${drm.title} — ${drm.artists.join(', ')}`

  results.stream = await win.evaluate(async (id) => {
    const s = await window.api.invoke('soundcloud:getStream', id)
    return { protocol: s.protocol, drm: s.drm?.keySystem, hasLicense: !!s.drm?.licenseUrl }
  }, drm.nativeId)

  await win.getByRole('button', { name: 'Search', exact: true }).click()
  await win.getByRole('checkbox', { name: /Spotify/ }).click()
  await win.getByRole('checkbox', { name: /Local/ }).click()
  await win.getByRole('textbox', { name: 'Search', exact: true }).fill(query)
  await win.getByRole('radio', { name: 'Songs' }).click()
  await win.getByRole('listitem').first().waitFor({ timeout: 20000 })
  await win.waitForTimeout(800)
  await win.getByRole('listitem').filter({ hasText: drm.title }).first().dblclick()
  const clock = () =>
    win.evaluate(
      () => document.querySelector('[aria-label="Seek"]')?.previousElementSibling?.textContent
    )
  await win.waitForTimeout(8000)
  results.nowPlaying = await win.locator('footer p.truncate').first().textContent()
  results.clockAfter8s = await clock()
  await win.waitForTimeout(4000)
  results.clockAfter12s = await clock()
  results.error = await win.locator('[role=alert]').allTextContents()
  await win.screenshot({ path: 'screenshots/09-soundcloud-drm.png' })
} catch (err) {
  results.failure = String(err?.message ?? err)
} finally {
  console.log(JSON.stringify(results, null, 2))
  await app.close()
  rmSync(userData, { recursive: true, force: true })
}
