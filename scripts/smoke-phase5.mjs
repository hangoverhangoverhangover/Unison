// Phase 5 check (no login): play a SoundCloud track, open Comments, confirm the
// waveform draws, timed comments load as avatars, and clicking the waveform seeks.
// Usage: npm run build first, then node scripts/smoke-phase5.mjs [query]
import { _electron as electron } from 'playwright-core'
import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const query = process.argv[2] ?? 'lofi beats'
const userData = mkdtempSync(join(tmpdir(), 'cp-smoke-p5-'))
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
  await win.getByRole('listitem').first().waitFor({ timeout: 20000 })
  await win.waitForTimeout(800)
  await win.locator('[role=listitem]:not([title])').nth(1).dblclick()
  await win.getByRole('button', { name: 'Pause' }).waitFor({ timeout: 20000 })

  await win.getByRole('button', { name: 'Queue, details and Jam' }).click()
  await win.getByRole('tab', { name: 'Details' }).click()
  await win.getByRole('slider', { name: 'Waveform' }).waitFor({ timeout: 20000 })
  await win.waitForTimeout(2500)
  results.commentHeading = await win.locator('aside h3').first().textContent()
  results.avatars = await win
    .locator('aside [aria-label$="comments" i], aside [aria-label*="comment at" i]')
    .count()
  results.composer = await win.getByText('Log in to SoundCloud in Settings to comment.').count()

  // Click 75% across the waveform and read the clock.
  const box = await win.getByRole('slider', { name: 'Waveform' }).boundingBox()
  await win.mouse.click(box.x + box.width * 0.75, box.y + box.height / 2)
  await win.waitForTimeout(1500)
  results.clockAfterWaveClick = await win.evaluate(
    () => document.querySelector('[aria-label="Seek"]')?.previousElementSibling?.textContent
  )
  results.duration = await win.evaluate(
    () => document.querySelector('[aria-label="Seek"]')?.nextElementSibling?.textContent
  )
  await win.screenshot({ path: 'screenshots/13-comments-panel.png' })
} catch (err) {
  results.failure = String(err?.message ?? err)
  await (await app.firstWindow()).screenshot({ path: 'screenshots/phase5-failure.png' })
} finally {
  console.log(JSON.stringify(results, null, 2))
  await app.close()
  rmSync(userData, { recursive: true, force: true })
}
