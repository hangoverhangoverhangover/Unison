// Glass UI check (no login): generated local tracks with a white, a black and a busy
// cover; screenshots of the main views in every theme, the rail sidebar, 150% zoom
// and a 900 px window. Also samples text contrast on the white cover.
// Usage: npm run build first, then node scripts/smoke-glass.mjs [view ...]
import { _electron as electron } from 'playwright-core'
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

// Never hang a terminal: give up after 4 minutes.
setTimeout(() => {
  console.log('smoke-glass: timed out')
  process.exit(2)
}, 240000).unref()

const only = new Set(process.argv.slice(2))
const want = (name) => only.size === 0 || only.has(name)

const userData = mkdtempSync(join(tmpdir(), 'cp-smoke-glass-'))
const music = join(userData, 'music')
mkdirSync(music, { recursive: true })
const ffmpeg = resolve('bin/ffmpeg.exe')
const run = (args) => execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args])

/** A short silent mp3 with an embedded cover drawn by an ffmpeg lavfi source. */
function track(file, title, artist, album, coverSource) {
  const cover = join(userData, `${file}.png`)
  run(['-f', 'lavfi', '-i', coverSource, '-frames:v', '1', cover])
  run([
    ...['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-i', cover],
    // -t after the inputs: an output limit (before an -i it would bind to that input).
    ...['-t', '30', '-map', '0:a', '-map', '1:v', '-c:a', 'libmp3lame', '-q:a', '9'],
    ...['-c:v', 'png', '-disposition:v', 'attached_pic', '-id3v2_version', '3'],
    ...['-metadata', `title=${title}`, '-metadata', `artist=${artist}`],
    ...['-metadata', `album=${album}`],
    join(music, `${file}.mp3`)
  ])
}

track(
  '01',
  'Glasshouse',
  'Neon Harbor',
  'Afterglow',
  'gradients=s=600x600:c0=0xea580c:c1=0x7e22ce:c2=0x1d4ed8:n=3:speed=0'
)
track('02', 'White Room', 'Paper Moons', 'Blank', 'color=c=white:s=600x600')
track('03', 'Night Shift', 'Paper Moons', 'Blank', 'color=c=black:s=600x600')
for (let i = 4; i <= 24; i++) {
  track(
    String(i).padStart(2, '0'),
    `Filler ${i}`,
    'Neon Harbor',
    'Afterglow',
    'color=c=0x334155:s=200x200'
  )
}

console.log('tracks generated')
const out = 'screenshots/glass'
mkdirSync(out, { recursive: true })

const app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`] })
await app.evaluate(({ dialog }, dir) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
}, music)
const win = await app.firstWindow()
win.on('console', (m) => {
  if (m.type() === 'error') console.log('[renderer:error]', m.text().slice(0, 300))
})
await win.waitForLoadState('domcontentloaded')
console.log('window loaded')

const setPrefs = (patch) => win.evaluate((p) => window.api.invoke('prefs:set', p), patch)
const shot = async (name) => {
  await win.waitForTimeout(700)
  await win.screenshot({ path: `${out}/${name}.png` })
  console.log('shot', name)
}
const go = async (label) => {
  const name = typeof label === 'string' ? new RegExp(`^${label}`) : label
  await win.getByRole('button', { name }).first().click()
  await win.waitForTimeout(400)
}

try {
  await win.evaluate(() => window.api.invoke('library:addFolder'))
  await win.waitForFunction(
    async () => (await window.api.invoke('library:getTracks')).length >= 24,
    null,
    { timeout: 60000, polling: 500 }
  )
  console.log('library scanned')
  await go('Local Files')
  await win.getByRole('radio', { name: 'Unsorted' }).click()
  await win.getByText('Glasshouse').first().dblclick()
  await win.waitForTimeout(1500)

  for (const theme of ['artwork', 'dark', 'light']) {
    await setPrefs({ theme })
    await win.waitForTimeout(600)
    if (want('local')) {
      await go('Local Files')
      await shot(`${theme}-local`)
    }
    if (want('settings')) {
      await go('Settings')
      await shot(`${theme}-settings`)
    }
  }
  await setPrefs({ theme: 'artwork' })

  if (want('headers')) {
    // Scroll a long list: the sticky title strip appears above the column header.
    await go('Local Files')
    await win
      .locator('main .page-fade')
      .first()
      .evaluate((el) => el.scrollTo(0, 700))
    await shot('artwork-sticky')
    // An app playlist: its rarer actions live behind ⋯.
    await win.evaluate(async () => {
      const tracks = await window.api.invoke('library:getTracks')
      await window.api.invoke('playlists:create', 'Late drive', tracks.slice(0, 6))
    })
    await win.waitForTimeout(800)
    await go('Late drive')
    await win.getByRole('button', { name: 'Playlist options' }).click()
    await shot('artwork-playlist-menu')
    await win.keyboard.press('Escape')
  }

  if (want('contrast')) {
    // Worst case for the Artwork theme: a pure white cover behind everything.
    await setPrefs({ theme: 'artwork' })
    await go('Local Files')
    await win.getByText('White Room').first().dblclick()
    await win.waitForTimeout(1500)
    await shot('artwork-white-cover')
    await win
      .locator('main .page-fade')
      .first()
      .evaluate((el) => el.scrollTo(0, 900))
    await shot('artwork-white-cover-scrolled')
    await win
      .getByText('Glasshouse')
      .first()
      .dblclick()
      .catch(() => undefined)
  }

  if (want('views')) {
    // Give Stats and the history playlists something to show.
    await win.evaluate(async () => {
      const tracks = await window.api.invoke('library:getTracks')
      for (const t of tracks.slice(0, 4)) {
        await window.api.invoke('history:record', {
          track: t,
          playedMs: 40000,
          startedAt: Date.now() - 1000
        })
      }
    })
    for (const theme of ['artwork', 'light']) {
      await setPrefs({ theme })
      for (const [label, name] of [
        ['Stats', 'stats'],
        [/^Recently played/, 'recent'],
        ['Liked Songs', 'liked'],
        [/^Search$/, 'search-empty']
      ]) {
        await go(label)
        await shot(`${theme}-${name}`)
      }
      await win.getByRole('button', { name: /^Downloads/ }).click()
      await shot(`${theme}-downloads`)
      await win.getByRole('button', { name: 'Your Library' }).click()
      await shot(`${theme}-library`)
      // A dialog and a context menu over a list.
      await go('Local Files')
      await win.getByText('White Room').first().click({ button: 'right' })
      await shot(`${theme}-context-menu`)
      await win
        .getByRole('menuitem', { name: /Edit tags/ })
        .first()
        .click()
      await shot(`${theme}-dialog`)
      await win.keyboard.press('Escape')
      await win.waitForTimeout(300)
    }
    await setPrefs({ theme: 'artwork' })
  }

  if (want('zoom')) {
    // Keyboard zoom: one step per press, and Electron's own page zoom stays at 100%.
    await go('Local Files')
    await win.locator('main h1').click()
    await win.keyboard.press('Control+Equal')
    await win.waitForTimeout(500)
    const z = await win.evaluate(() => window.api.invoke('prefs:get'))
    const factor = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.getZoomFactor()
    )
    console.log('zoom after Ctrl+=:', z.zoom, 'electron factor:', factor)
    await win.keyboard.press('Control+Minus')
    await win.waitForTimeout(500)
    console.log(
      'zoom after Ctrl+-:',
      (await win.evaluate(() => window.api.invoke('prefs:get'))).zoom,
      'electron factor:',
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].webContents.getZoomFactor()
      )
    )
    await win.keyboard.press('Control+Equal')
    await win.waitForTimeout(300)
    await shot('artwork-zoom-toast')
    await setPrefs({ zoom: 1.5 })
    await shot('artwork-zoom-150')
    await win.getByRole('button', { name: /Search Spotify, SoundCloud/ }).click()
    await shot('artwork-zoom-150-quick')
    await win.keyboard.press('Escape')
    await win.keyboard.press('Control+0')
    await win.waitForTimeout(400)
    console.log(
      'zoom after Ctrl+0:',
      (await win.evaluate(() => window.api.invoke('prefs:get'))).zoom
    )
  }

  if (want('review')) {
    const result = {}
    const quick = win.getByRole('dialog', { name: 'Quick search' })
    // 1. Ctrl+K inside a dialog: quick search shows on top; Esc closes only quick search.
    try {
      await go('Local Files')
      await win.getByText('White Room').first().click({ button: 'right' })
      await win
        .getByRole('menuitem', { name: /Edit tags/ })
        .first()
        .click()
      await win.getByRole('dialog').first().waitFor({ timeout: 5000 })
      await win.locator('[role=dialog] input').first().click()
      await win.keyboard.press('Control+k')
      await quick.waitFor({ timeout: 5000 })
      const box = await quick.boundingBox()
      result.quickOnTop = await win.evaluate(
        ([x, y]) => !!document.elementFromPoint(x, y)?.closest('[aria-label="Quick search"]'),
        [box.x + box.width / 2, box.y + 30]
      )
      await win.keyboard.press('Escape')
      await win.waitForTimeout(900)
      result.focusAtEsc = await win.evaluate(() => document.activeElement?.outerHTML.slice(0, 120))
      result.quickClosed = (await quick.count()) === 0
      result.dialogStillOpen = (await win.getByRole('dialog').count()) > 0
      await win.keyboard.press('Escape')
      await win.waitForTimeout(400)
    } catch (err) {
      result.step1Error = String(err?.message ?? err).split(String.fromCharCode(10))[0]
      await win.keyboard.press('Escape').catch(() => undefined)
      await win.keyboard.press('Escape').catch(() => undefined)
    }

    // 2. Clicking blank space in quick search keeps the keyboard working.
    try {
      await win.getByRole('button', { name: /Search Spotify, SoundCloud/ }).click()
      await quick.waitFor({ timeout: 5000 })
      const qb = await quick.boundingBox()
      await win.mouse.click(qb.x + qb.width / 2, qb.y + qb.height - 12)
      result.focusAfterBlankClick = await win.evaluate(
        () =>
          document.activeElement?.tagName +
          ':' +
          (document.activeElement?.getAttribute('aria-label') ?? '')
      )
      await win.keyboard.press('Escape')
      await win.waitForTimeout(400)
      result.escAfterBlankClick = (await quick.count()) === 0
    } catch (err) {
      result.step2Error = String(err?.message ?? err).split(String.fromCharCode(10))[0]
      await win.keyboard.press('Escape').catch(() => undefined)
      await win.keyboard.press('Escape').catch(() => undefined)
    }

    // 3. The right panel opens on a 1000 px window.
    try {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1020, 760))
      await win.waitForTimeout(500)
      await win.getByRole('button', { name: 'Queue, details and Jam' }).click({ timeout: 5000 })
      await win.waitForTimeout(600)
      result.panelAt1020 = (await win.getByRole('tablist', { name: 'Panel' }).count()) > 0
      await shot('artwork-1020-panel')
      await win
        .getByRole('button', { name: /Hide panel|Close panel/ })
        .first()
        .click()
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 800))
      await win.waitForTimeout(500)
    } catch (err) {
      result.step3Error = String(err?.message ?? err).split(String.fromCharCode(10))[0]
      await win.keyboard.press('Escape').catch(() => undefined)
      await win.keyboard.press('Escape').catch(() => undefined)
    }

    // 4. Dragging the zoom slider lands on the value under the pointer, without jitter.
    try {
      await win.getByRole('button', { name: 'Settings', exact: true }).click()
      await win.getByRole('button', { name: 'Appearance' }).click()
      const thumb = win.locator('[aria-label="Zoom"] [role=slider]')
      await thumb.waitFor({ timeout: 5000 })
      await win.waitForTimeout(1000) // let the smooth scroll finish before measuring
      const tb = await thumb.boundingBox()
      const track = await win.locator('[aria-label="Zoom"]').first().boundingBox()
      await win.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2)
      await win.mouse.down()
      // Right end of the track = 150%.
      for (let i = 1; i <= 10; i++) {
        await win.mouse.move(tb.x + ((track.x + track.width - tb.x) * i) / 10, tb.y + tb.height / 2)
        await win.waitForTimeout(30)
      }
      await win.mouse.up()
      await win.waitForTimeout(600)
      result.zoomAfterDrag = (await win.evaluate(() => window.api.invoke('prefs:get'))).zoom
    } catch (err) {
      result.step4Error = String(err?.message ?? err).split(String.fromCharCode(10))[0]
      await win.keyboard.press('Escape').catch(() => undefined)
      await win.keyboard.press('Escape').catch(() => undefined)
    }
    // 5. Light theme reaches the mini player and is there before the first paint.
    try {
      await setPrefs({ theme: 'light' })
      await win.reload()
      await win.waitForLoadState('domcontentloaded')
      result.bootTheme = await win.evaluate(() => ({
        boot: window.boot?.theme,
        html: document.documentElement.dataset.theme
      }))
      await win.waitForTimeout(1500)
      await win.getByRole('button', { name: 'Mini player' }).click()
      const mini = await app.waitForEvent('window', { timeout: 5000 })
      await mini.waitForLoadState('domcontentloaded')
      await mini.waitForTimeout(800)
      result.miniTheme = await mini.evaluate(() => document.documentElement.dataset.theme)
      await mini.screenshot({ path: `${out}/light-mini.png` })
      await setPrefs({ theme: 'artwork' })
      await mini.waitForTimeout(600)
      result.miniThemeAfter = await mini.evaluate(() => document.documentElement.dataset.theme)
      await mini.screenshot({ path: `${out}/artwork-mini.png` })
      await win.getByRole('button', { name: /mini player/i }).click()
    } catch (err) {
      result.step5Error = String(err?.message ?? err).split(String.fromCharCode(10))[0]
    }
    await setPrefs({ zoom: 1 })
    console.log('review:', JSON.stringify(result))
  }

  if (want('nowplaying')) {
    // Playing from Local Files: its sidebar entry shows the bars; its play button pauses.
    await go('Local Files')
    // Already playing from here (the setup double-clicked a Local Files row)?
    if ((await win.locator('main').getByRole('button', { name: 'Pause' }).count()) === 0) {
      await win.locator('main').getByRole('button', { name: 'Play', exact: true }).first().click()
    }
    await win.waitForTimeout(1200)
    await shot('artwork-nowplaying')
    console.log(
      'hero button after play:',
      await win.locator('main').getByRole('button', { name: 'Pause' }).count()
    )
    // Narrow window: Settings chips sit above the cards, not over them.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 720))
    await win.getByRole('button', { name: 'Settings', exact: true }).click()
    await win.waitForTimeout(600)
    await win
      .locator('main .page-fade')
      .first()
      .evaluate((el) => el.scrollTo(0, 1400))
    await shot('artwork-settings-narrow')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 800))
    await win.getByRole('button', { name: 'Your Library' }).click()
    await shot('artwork-library')
  }

  if (want('soundcloud')) {
    // Needs network. An artist with reposts; open a reposted playlist in place.
    await win.getByRole('button', { name: /Search Spotify, SoundCloud/ }).click()
    await win.getByRole('textbox', { name: 'Quick search' }).fill('hi-c')
    await win
      .getByRole('dialog', { name: 'Quick search' })
      .getByRole('option')
      .first()
      .waitFor({ timeout: 20000 })
    await win.waitForTimeout(1500)
    await win.keyboard.press('ArrowDown')
    await win.keyboard.press('Enter')
    await win.locator('main h1').waitFor({ timeout: 20000 })
    await win.waitForTimeout(2500)
    const reposts = win.locator('section', { hasText: 'Reposts' }).last()
    if (await reposts.count()) {
      await reposts.scrollIntoViewIfNeeded()
      const unfold = reposts.getByRole('button', { name: /Show the songs in/ }).first()
      if (await unfold.count()) {
        await unfold.click()
        await win.waitForTimeout(2500)
      }
      await shot('artwork-artist-reposts')
    } else console.log('no reposts section for this artist')
    // Play the first popular song and open Details.
    await win
      .locator('main')
      .getByRole('button', { name: /^Play / })
      .first()
      .click()
    await win.waitForTimeout(3000)
    await win.getByRole('button', { name: 'Queue, details and Jam' }).click()
    await win.getByRole('tab', { name: 'Details' }).click()
    await win.waitForTimeout(3500)
    await shot('artwork-details')
  }

  if (want('queue')) {
    // Start mid-list: Previous reaches the song above; Shuffle queues the whole list.
    await go('Local Files')
    await win.getByRole('radio', { name: 'Unsorted' }).click()
    await win.getByText('Filler 4').first().dblclick()
    await win.waitForTimeout(1200)
    await win.getByRole('button', { name: 'Previous', exact: true }).click()
    await win.waitForTimeout(1200)
    const titleAfterPrev = await win.locator('footer p').first().textContent()
    await win.locator('main').getByRole('button', { name: 'Shuffle play' }).click()
    await win.waitForTimeout(1200)
    const q = await win.evaluate(() => {
      const raw = document.querySelectorAll('[aria-label="Playing"]').length
      return raw
    })
    await win.getByRole('button', { name: 'Queue, details and Jam' }).click()
    await win.getByRole('tab', { name: 'Queue' }).click()
    await win.waitForTimeout(600)
    const upcoming = await win.locator('aside li, aside [role=listitem]').count()
    console.log('queue:', JSON.stringify({ titleAfterPrev, upcoming, playingMarks: q }))
    await shot('artwork-queue-shuffled')
    await win.getByRole('button', { name: 'Shuffle', exact: true }).click()
  }

  if (want('lastfm')) {
    // Empty card, then saved keys (not real ones: Connect should explain the refusal).
    await win.getByRole('button', { name: 'Settings', exact: true }).click()
    const card = win.locator('section', { hasText: 'Last.fm' }).first()
    await card.scrollIntoViewIfNeeded()
    await shot('artwork-lastfm-empty')
    await card
      .getByRole('textbox', { name: 'Last.fm API key' })
      .fill('0123456789abcdef0123456789abcdef')
    await card.getByLabel('Last.fm shared secret').fill('fedcba9876543210fedcba9876543210')
    await card.getByRole('button', { name: 'Save' }).click()
    await card.getByRole('button', { name: 'Connect' }).click()
    await win.waitForTimeout(3000)
    await shot('artwork-lastfm-bad-key')
    console.log(
      'lastfm:',
      JSON.stringify(await win.evaluate(() => window.api.invoke('lastfm:getStatus')))
    )
  }

  if (want('layout')) {
    // Drag the sidebar edge left past the snap point: it becomes the icon rail.
    await go('Local Files')
    const handle = win.getByRole('separator', { name: 'Resize sidebar' })
    const box = await handle.boundingBox()
    await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await win.mouse.down()
    await win.mouse.move(box.x - 60, box.y + box.height / 2, { steps: 5 })
    await win.mouse.move(box.x - 160, box.y + box.height / 2, { steps: 5 })
    await win.mouse.up()
    await win.waitForTimeout(600)
    const railPrefs = await win.evaluate(() => window.api.invoke('prefs:get'))
    console.log('sidebar after drag:', railPrefs.sidebarWidth)
    await shot('artwork-rail')
    await setPrefs({ sidebarWidth: 360 })
    await shot('artwork-wide-sidebar')
    await setPrefs({ sidebarWidth: 280 })

    // A 900 px window with the queue open: the queue gives way to the main page.
    await win.getByRole('button', { name: 'Queue, details and Jam' }).click({ timeout: 5000 })
    await win.getByRole('tab', { name: 'Queue' }).click()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 700))
    await shot('artwork-900')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 800))
    await shot('artwork-queue')
  }
} finally {
  await app.close()
  rmSync(userData, { recursive: true, force: true })
}
