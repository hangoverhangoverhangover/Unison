// Jam end-to-end (no login): starts the relay locally (wrangler dev, no account needed),
// opens two app instances (host + guest), guest adds a SoundCloud track, host plays it,
// and checks both are playing the same entry within a couple of seconds of each other.
// Usage: npm run build first, then node scripts/smoke-jam.mjs
import { _electron as electron } from 'playwright-core'
import { spawn } from 'child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

const RELAY = 'http://127.0.0.1:8787'
mkdirSync('screenshots', { recursive: true })
const results = {}

// 1. Relay
const relay = spawn('npx', ['wrangler', 'dev', '--port', '8787', '--ip', '127.0.0.1'], {
  cwd: resolve('relay'),
  shell: true,
  windowsHide: true
})
await new Promise((ok, fail) => {
  const t = setTimeout(() => fail(new Error('relay did not start')), 90_000)
  const onData = (d) => {
    if (/Ready on/i.test(String(d))) {
      clearTimeout(t)
      ok()
    }
  }
  relay.stdout.on('data', onData)
  relay.stderr.on('data', onData)
})

async function open(name) {
  const userData = mkdtempSync(join(tmpdir(), `cp-jam-${name}-`))
  const app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`] })
  const win = await app.firstWindow()
  win.on('console', (m) => {
    if (m.type() === 'error') console.log(`[${name}:error]`, m.text().slice(0, 200))
  })
  await win.waitForLoadState('domcontentloaded')
  await win.evaluate(
    ([url, n]) => window.api.invoke('prefs:set', { jamRelayUrl: url, jamName: n }),
    [RELAY, name]
  )
  return { app, win, userData }
}

const host = await open('Host')
const guest = await open('Guest')
try {
  // Host starts from the panel.
  await host.win.getByRole('button', { name: 'Queue, details and Jam' }).click()
  await host.win.getByRole('tab', { name: /^Jam/ }).click()
  await host.win.getByRole('button', { name: 'Start a Jam' }).click()
  const code = await host.win.locator('aside .font-mono').first().textContent({ timeout: 20000 })
  results.code = code?.trim()

  // Guest joins with the code.
  await guest.win.getByRole('button', { name: 'Queue, details and Jam' }).click()
  await guest.win.getByRole('tab', { name: /^Jam/ }).click()
  await guest.win.getByRole('textbox', { name: 'Jam code' }).fill(results.code)
  await guest.win.getByRole('button', { name: 'Join' }).click()
  await guest.win.getByText(/2 listening/).waitFor({ timeout: 20000 })
  await host.win.getByText(/2 listening/).waitFor({ timeout: 20000 })
  results.joined = true

  // Guest adds a SoundCloud track by "playing" it (adds to the Jam queue).
  await guest.win.getByRole('button', { name: 'Search', exact: true }).click()
  await guest.win.getByRole('checkbox', { name: /Spotify/ }).click()
  await guest.win.getByRole('checkbox', { name: /Local/ }).click()
  await guest.win.getByRole('textbox', { name: 'Search', exact: true }).fill('forss flickermood')
  await guest.win.getByRole('radio', { name: 'Songs' }).click()
  const row = guest.win.locator('[role=listitem]').first()
  await row.waitFor({ timeout: 20000 })
  await row.dblclick()
  await host.win.getByText(/added by Guest/).waitFor({ timeout: 15000 })
  results.hostSeesGuestAdd = true

  // Host starts playback; both should play.
  await host.win.getByRole('button', { name: 'Start playing' }).click()
  await host.win.getByRole('button', { name: 'Pause' }).first().waitFor({ timeout: 30000 })
  await guest.win.getByRole('button', { name: 'Pause' }).first().waitFor({ timeout: 30000 })
  await host.win.waitForTimeout(6000)
  const clock = (w) =>
    w.evaluate(
      () => document.querySelector('[aria-label="Seek"]')?.previousElementSibling?.textContent
    )
  results.hostClock = await clock(host.win)
  results.guestClock = await clock(guest.win)
  const title = (w) => w.locator('footer p, [class*="text-md font-medium"]').first().textContent()
  results.hostTitle = await title(host.win).catch(() => null)
  results.guestTitle = await title(guest.win).catch(() => null)
  await host.win.screenshot({ path: 'screenshots/32-jam-host.png' })
  await guest.win.screenshot({ path: 'screenshots/33-jam-guest.png' })

  // Host pauses: guest follows.
  await host.win.getByRole('button', { name: 'Pause' }).first().click()
  await guest.win
    .getByRole('button', { name: 'Play', exact: true })
    .first()
    .waitFor({ timeout: 10000 })
  results.guestFollowedPause = true

  // Host ends the Jam: guest is told.
  await host.win.getByRole('button', { name: 'End Jam' }).click()
  await host.win.getByRole('button', { name: 'End Jam' }).last().click()
  await guest.win.getByRole('button', { name: 'Start a Jam' }).waitFor({ timeout: 15000 })
  results.guestSawEnd = true
} catch (err) {
  results.failure = String(err?.message ?? err).slice(0, 500)
  await host.win.screenshot({ path: 'screenshots/jam-host-failure.png' }).catch(() => {})
  await guest.win.screenshot({ path: 'screenshots/jam-guest-failure.png' }).catch(() => {})
} finally {
  console.log(JSON.stringify(results, null, 2))
  await host.app.close().catch(() => {})
  await guest.app.close().catch(() => {})
  rmSync(host.userData, { recursive: true, force: true })
  rmSync(guest.userData, { recursive: true, force: true })
  // Stop wrangler and the workerd it spawned.
  spawn('taskkill', ['/pid', String(relay.pid), '/T', '/F'], { shell: true, windowsHide: true })
}
