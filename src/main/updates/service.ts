// App updates via electron-updater and GitHub Releases. The updater is passed in, so
// this logic is tested without Electron.
import type { UpdateStatus } from '@shared/updates'

/** The part of electron-updater's autoUpdater this uses. */
export interface Updater {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  checkForUpdates(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- event payloads vary
  on(event: string, listener: (...args: any[]) => void): unknown
  removeAllListeners(event?: string): unknown
}

/** First check a little after start (not during the busy launch), then every 6 h. */
export const FIRST_CHECK_MS = 15_000
export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

const EVENTS = [
  'checking-for-update',
  'update-available',
  'update-not-available',
  'download-progress',
  'update-downloaded',
  'error'
]

const NO_RELEASES = 'No releases found yet.'

/** A short readable message. Updater errors can carry whole HTTP response bodies. */
export function updateErrorMessage(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err)
  if (
    /ERR_INTERNET_DISCONNECTED|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ERR_NAME_NOT_RESOLVED/i.test(text)
  )
    return 'No internet connection.'
  if (/\b404\b/.test(text)) return 'No releases found yet.'
  if (/sha512|checksum/i.test(text)) return 'The download was damaged. It will try again later.'
  return "Couldn't check for updates. It will try again later."
}

export function createUpdates(deps: {
  updater: Updater
  /** Installed app (updates can't work when running from source). */
  packaged: boolean
  currentVersion: string
  emit(status: UpdateStatus): void
  now?: () => number
}): {
  status(): UpdateStatus
  check(): Promise<void>
  /** Restart into a downloaded update. */
  install(): void
  dispose(): void
} {
  const { updater, currentVersion } = deps
  const now = deps.now ?? Date.now
  let status: UpdateStatus = deps.packaged
    ? { state: 'idle', currentVersion }
    : { state: 'unsupported', currentVersion }
  let installed = false

  const set = (next: UpdateStatus): void => {
    status = next
    deps.emit(status)
  }
  // No published release (404) just means there is nothing newer yet.
  const fail = (err: unknown): void => {
    const error = updateErrorMessage(err)
    set(
      error === NO_RELEASES
        ? { state: 'current', currentVersion, checkedAt: now() }
        : { state: 'error', currentVersion, error, checkedAt: now() }
    )
  }
  const busy = (): boolean => status.state === 'downloading' || status.state === 'ready'

  if (!deps.packaged)
    return {
      status: () => status,
      check: async () => {},
      install: () => {},
      dispose: () => {}
    }

  updater.autoDownload = true
  // The app quits through app.exit (after its own cleanup), which skips Electron's
  // 'quit' event; dispose() installs a ready update instead.
  updater.autoInstallOnAppQuit = false

  updater.on('checking-for-update', () => {
    if (!busy()) set({ state: 'checking', currentVersion, checkedAt: status.checkedAt })
  })
  updater.on('update-available', (info: { version: string }) =>
    set({ state: 'downloading', currentVersion, version: info.version, percent: 0 })
  )
  updater.on('update-not-available', () =>
    set({ state: 'current', currentVersion, checkedAt: now() })
  )
  updater.on('download-progress', (p: { percent: number }) => {
    if (status.state === 'downloading') set({ ...status, percent: Math.round(p.percent) })
  })
  updater.on('update-downloaded', (info: { version: string }) =>
    set({ state: 'ready', currentVersion, version: info.version, checkedAt: now() })
  )
  updater.on('error', (err: unknown) => {
    // A failed check while an update is ready leaves it ready.
    if (status.state === 'ready') return
    fail(err)
  })

  const check = async (): Promise<void> => {
    if (busy() || status.state === 'checking') return
    try {
      await updater.checkForUpdates()
      // Never stay stuck on "checking" if the updater ended without saying more.
      // (status changes inside the await, through the updater's events)
      if ((status.state as UpdateStatus['state']) === 'checking')
        set({ state: 'idle', currentVersion, checkedAt: now() })
    } catch (err) {
      if (status.state !== 'ready') fail(err)
    }
  }

  const first = setTimeout(() => void check(), FIRST_CHECK_MS)
  const every = setInterval(() => void check(), CHECK_EVERY_MS)

  return {
    status: () => status,
    check,
    install() {
      if (status.state !== 'ready' || installed) return
      installed = true
      updater.quitAndInstall(false, true)
    },
    dispose() {
      clearTimeout(first)
      clearInterval(every)
      for (const e of EVENTS) updater.removeAllListeners(e)
      if (status.state === 'ready' && !installed) {
        installed = true
        updater.quitAndInstall(true, false)
      }
    }
  }
}
