import { EventEmitter } from 'events'
import { describe, expect, it, vi } from 'vitest'
import type { UpdateStatus } from '@shared/updates'
import { CHECK_EVERY_MS, FIRST_CHECK_MS, createUpdates, type Updater } from './service'

class FakeUpdater extends EventEmitter implements Updater {
  autoDownload = false
  autoInstallOnAppQuit = false
  checks = 0
  installs: [boolean, boolean][] = []
  fail?: Error
  async checkForUpdates(): Promise<unknown> {
    this.checks++
    this.emit('checking-for-update')
    if (this.fail) throw this.fail
    return null
  }
  quitAndInstall(isSilent = false, isForceRunAfter = false): void {
    this.installs.push([isSilent, isForceRunAfter])
  }
}

function setup(packaged = true): {
  updater: FakeUpdater
  seen: UpdateStatus[]
  updates: ReturnType<typeof createUpdates>
} {
  vi.useFakeTimers()
  const updater = new FakeUpdater()
  const seen: UpdateStatus[] = []
  const updates = createUpdates({
    updater,
    packaged,
    currentVersion: '0.1.0',
    emit: (s) => seen.push(s),
    now: () => 1000
  })
  return { updater, seen, updates }
}

describe('updates', () => {
  it('does nothing when running from source', async () => {
    const { updater, updates } = setup(false)
    expect(updates.status().state).toBe('unsupported')
    await updates.check()
    vi.advanceTimersByTime(FIRST_CHECK_MS + CHECK_EVERY_MS)
    expect(updater.checks).toBe(0)
    updates.dispose()
  })

  it('downloads by itself and checks soon after start, then every few hours', async () => {
    const { updater, updates } = setup()
    expect(updater.autoDownload).toBe(true)
    expect(updates.status()).toEqual({ state: 'idle', currentVersion: '0.1.0' })
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS)
    expect(updater.checks).toBe(1)
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS)
    expect(updater.checks).toBe(2)
    updates.dispose()
  })

  it('follows the updater through a download to ready', () => {
    const { updater, seen, updates } = setup()
    updater.emit('checking-for-update')
    expect(updates.status().state).toBe('checking')
    updater.emit('update-available', { version: '0.2.0' })
    expect(updates.status()).toMatchObject({ state: 'downloading', version: '0.2.0', percent: 0 })
    updater.emit('download-progress', { percent: 41.7 })
    expect(updates.status().percent).toBe(42)
    updater.emit('update-downloaded', { version: '0.2.0' })
    expect(updates.status()).toMatchObject({ state: 'ready', version: '0.2.0', checkedAt: 1000 })
    expect(seen.at(-1)?.state).toBe('ready')
    updates.dispose()
  })

  it('says when this is the newest version', () => {
    const { updater, updates } = setup()
    updater.emit('update-not-available', { version: '0.1.0' })
    expect(updates.status()).toEqual({ state: 'current', currentVersion: '0.1.0', checkedAt: 1000 })
    updates.dispose()
  })

  it('reports errors in plain words, without raw response bodies', async () => {
    const { updater, updates } = setup()
    updater.fail = new Error('net::ERR_INTERNET_DISCONNECTED')
    await updates.check()
    expect(updates.status()).toMatchObject({ state: 'error' })
    expect(updates.status().error).toMatch(/internet/i)
    updater.emit('error', new Error('HttpError: 400 \n "<html>…lots of page…"'))
    expect(updates.status().error).not.toMatch(/html/)
    // No published release yet: nothing newer, so not an error.
    updater.emit('error', new Error('HttpError: 404 \n "<html>…lots of page…"'))
    expect(updates.status()).toMatchObject({ state: 'current' })
    updates.dispose()
  })

  it('does not check again while a download is under way or ready', async () => {
    const { updater, updates } = setup()
    updater.emit('update-available', { version: '0.2.0' })
    await updates.check()
    updater.emit('update-downloaded', { version: '0.2.0' })
    await updates.check()
    expect(updater.checks).toBe(0)
    updates.dispose()
  })

  it('restarts into a ready update, and installs a ready one when the app quits', () => {
    const { updater, updates } = setup()
    updates.install()
    expect(updater.installs).toEqual([])
    updater.emit('update-downloaded', { version: '0.2.0' })
    updates.install()
    expect(updater.installs).toEqual([[false, true]])
    const quitting = setup()
    quitting.updater.emit('update-downloaded', { version: '0.2.0' })
    quitting.updates.dispose()
    // The app's own quit path skips Electron's 'quit' event, so install happens here.
    expect(quitting.updater.installs).toEqual([[true, false]])
    updates.dispose()
  })
})
