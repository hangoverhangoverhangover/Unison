// The app log: <userData>/logs/unison.log. Main's console output, freezes, crashes,
// renderer errors and Jam events go here, so a "the app froze" report comes with
// evidence. Secrets never reach the file: every line goes through redact() first.
// The file is capped; past MAX_BYTES it moves to unison.old.log and starts again.
import { app, type BrowserWindow } from 'electron'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  type WriteStream
} from 'fs'
import { join } from 'path'
import { format } from 'util'

export const MAX_BYTES = 2 * 1024 * 1024
/** The main process counts as stuck when a 1 s timer fires this late. */
export const BUSY_MS = 2500
const TICK_MS = 1000

/**
 * Strips things that must never be written down: tokens, secrets, keys, passwords,
 * auth codes and cookies, in query strings, JSON, headers or "name: value" text.
 */
export function redact(text: string): string {
  return (
    text
      .replace(/\b(Bearer|Basic|OAuth)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [hidden]')
      .replace(
        // Bare numbers (close codes, exit codes) stay: they're never secrets.
        /\b((?:access_?|refresh_?|id_?|client_?|host_?|api_?|auth_?|session_?)?(?:token|secret|key|password|passwd|code|cookie|sig|signature|verifier)s?)(["']?\s*[:=]\s*["']?)(?!\d+(?:[\s"'&,;)}]|$))([^\s"'&,;}]+)/gi,
        '$1$2[hidden]'
      )
      // Long opaque strings (JWTs, keys) that slipped through without a name.
      .replace(/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/g, '[hidden]')
  )
}

/** One log line: ISO time, level, message (redacted, newlines kept readable). */
export function formatLine(level: string, message: string, at: Date): string {
  const body = redact(message).replace(/\r?\n/g, '\n    ')
  return `${at.toISOString()} ${level.toUpperCase().padEnd(5)} ${body}\n`
}

/** How long the main process was stuck, if a timer due at `expected` ran at `actual`. */
export function busyFor(expected: number, actual: number): number | null {
  const late = actual - expected
  return late >= BUSY_MS ? late : null
}

let stream: WriteStream | null = null
let file = ''
let written = 0
let dir = ''

export function logDir(): string {
  return dir || join(app.getPath('userData'), 'logs')
}

function rotate(): void {
  try {
    stream?.end()
    renameSync(file, join(dir, 'unison.old.log'))
  } catch {
    // Nothing to move.
  }
  stream = createWriteStream(file, { flags: 'a' })
  stream.on('error', () => (stream = null))
  written = 0
}

/** Write one line to the log (no-op before startLog). */
export function logLine(level: 'info' | 'warn' | 'error', message: string): void {
  if (!stream) return
  const line = formatLine(level, message, new Date())
  written += Buffer.byteLength(line)
  stream.write(line)
  if (written > MAX_BYTES) rotate()
}

/**
 * Start the log: open the file, copy console output into it, and watch for the main
 * process getting stuck, crashed child processes and uncaught errors. Call first thing.
 */
export function startLog(): () => void {
  dir = join(app.getPath('userData'), 'logs')
  file = join(dir, 'unison.log')
  try {
    mkdirSync(dir, { recursive: true })
    written = existsSync(file) ? statSync(file).size : 0
    if (written > MAX_BYTES) {
      renameSync(file, join(dir, 'unison.old.log'))
      written = 0
    }
    stream = createWriteStream(file, { flags: 'a' })
    stream.on('error', () => (stream = null))
  } catch {
    stream = null
    return () => undefined
  }
  logLine('info', `--- Unison ${app.getVersion()} started (Electron ${process.versions.electron})`)

  // Console output from main keeps going to the terminal and is copied here.
  const original = { log: console.log, warn: console.warn, error: console.error }
  const levels = { log: 'info', warn: 'warn', error: 'error' } as const
  for (const name of ['log', 'warn', 'error'] as const) {
    console[name] = (...args: unknown[]) => {
      original[name](...args)
      try {
        logLine(levels[name], format(...args))
      } catch {
        // Logging must never break the caller.
      }
    }
  }

  // A timer that fires late means main was stuck that long (clicks wait on main).
  let expected = Date.now() + TICK_MS
  const watchdog = setInterval(() => {
    const now = Date.now()
    const late = busyFor(expected, now)
    if (late !== null) logLine('warn', `main process was stuck for ${(late / 1000).toFixed(1)}s`)
    expected = now + TICK_MS
  }, TICK_MS)
  watchdog.unref()

  const onGone = (_e: unknown, details: { type: string; reason: string; exitCode: number }): void =>
    logLine('error', `${details.type} process gone: ${details.reason} (exit ${details.exitCode})`)
  app.on('child-process-gone', onGone)
  const onException = (err: Error): void =>
    logLine('error', `uncaught exception: ${err.stack ?? err.message}`)
  process.on('uncaughtExceptionMonitor', onException)
  const onRejection = (reason: unknown): void =>
    logLine(
      'error',
      `unhandled rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`
    )
  process.on('unhandledRejection', onRejection)

  return () => {
    clearInterval(watchdog)
    app.off('child-process-gone', onGone)
    process.off('uncaughtExceptionMonitor', onException)
    process.off('unhandledRejection', onRejection)
    Object.assign(console, original)
    logLine('info', '--- quit')
    stream?.end()
    stream = null
  }
}

/** Log a window freezing, recovering, crashing, and its page's errors. */
export function watchWindow(win: BrowserWindow, name: string): void {
  const started = { at: 0 }
  win.on('unresponsive', () => {
    started.at = Date.now()
    logLine('warn', `${name} window stopped responding`)
  })
  win.on('responsive', () => {
    const s = started.at ? ` after ${((Date.now() - started.at) / 1000).toFixed(1)}s` : ''
    started.at = 0
    logLine('info', `${name} window responding again${s}`)
  })
  const wc = win.webContents
  wc.on('render-process-gone', (_e, d) =>
    logLine('error', `${name} page crashed: ${d.reason} (exit ${d.exitCode})`)
  )
  wc.on('preload-error', (_e, path, err) =>
    logLine('error', `${name} preload failed (${path}): ${err.message}`)
  )
  wc.on('console-message', (e) => {
    if (e.level === 'error' || e.level === 'warning')
      logLine(
        e.level === 'error' ? 'error' : 'warn',
        `[${name}] ${e.message} (${e.sourceId}:${e.lineNumber})`
      )
  })
}
