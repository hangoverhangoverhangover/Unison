// Child-process seam for yt-dlp, so tests can drive the downloader with a fake.
import { spawn as nodeSpawn } from 'child_process'
import { createInterface } from 'readline'

/** The parts of a ChildProcess the downloader uses. */
export interface ChildLike {
  pid?: number | undefined
  stdout: NodeJS.ReadableStream | null
  stderr: NodeJS.ReadableStream | null
  on(event: 'close', listener: (code: number | null) => void): unknown
  on(event: 'error', listener: (err: Error) => void): unknown
  kill(signal?: NodeJS.Signals): boolean
}

export interface SpawnOptions {
  env: NodeJS.ProcessEnv
  windowsHide: boolean
}

export type SpawnFn = (command: string, args: readonly string[], opts: SpawnOptions) => ChildLike

export const defaultSpawn: SpawnFn = (command, args, opts) =>
  nodeSpawn(command, [...args], { env: opts.env, windowsHide: opts.windowsHide, stdio: 'pipe' })

/** Kill a child and everything it started (yt-dlp runs ffmpeg). */
export type KillTreeFn = (child: ChildLike) => void

export const defaultKillTree: KillTreeFn = (child) => {
  if (process.platform === 'win32' && child.pid) {
    try {
      const killer = nodeSpawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      })
      killer.on('error', () => child.kill())
      return
    } catch {
      // fall through
    }
  }
  child.kill('SIGKILL')
}

/** Env for yt-dlp: UTF-8 output so titles with emoji survive. */
export function toolEnv(): NodeJS.ProcessEnv {
  return { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
}

export interface RunResult {
  code: number | null
  stdout: string
  stderr: string
}

export interface RunHandle {
  child: ChildLike
  done: Promise<RunResult>
}

/**
 * Spawn and collect output. `onLine` sees each stdout line as it arrives.
 * stderr is kept (last 64 KB) for error messages.
 */
export function runProcess(
  spawn: SpawnFn,
  command: string,
  args: readonly string[],
  onLine?: (line: string) => void
): RunHandle {
  const child = spawn(command, args, { env: toolEnv(), windowsHide: true })
  const done = new Promise<RunResult>((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    if (child.stdout) {
      ;(
        child.stdout as NodeJS.ReadableStream & { setEncoding?: (e: string) => void }
      ).setEncoding?.('utf8')
      const rl = createInterface({ input: child.stdout, crlfDelay: Infinity })
      rl.on('line', (line) => {
        if (stdout.length < 65536) stdout += `${line}\n`
        onLine?.(line)
      })
    }
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString()
      if (stderr.length > 65536) stderr = stderr.slice(-65536)
    })
    child.on('error', (err) => {
      if (settled) return
      settled = true
      reject(err)
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      // Let readline flush the last line before resolving.
      setImmediate(() => resolve({ code, stdout, stderr }))
    })
  })
  return { child, done }
}
