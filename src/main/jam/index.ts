// jam:* IPC handlers: the Jam (shared listening) client.
import { ipcMain, type WebContents } from 'electron'
import type { AppPrefs } from '@shared/config'
import type { JamStatus } from '@shared/jam'
import type { InvokeChannel } from '@shared/ipc'
import { emit, handle } from '../ipc'
import { createJamClient, type JamClient, type JamClientDeps } from './client'

export { createJamClient, type JamClient } from './client'

const CHANNELS: InvokeChannel[] = [
  'jam:getStatus',
  'jam:start',
  'jam:join',
  'jam:leave',
  'jam:send',
  'jam:setCapabilities'
]

/**
 * One line about where the Jam is, for the app log: state, role, people, song, playing.
 * No names, track titles or keys: just enough to see what the Jam was doing.
 */
export function jamSummary(s: JamStatus): string {
  const parts = [`jam: ${s.state}`]
  if (s.role) parts.push(`as ${s.role}`)
  const r = s.room
  if (r) {
    parts.push(`${r.participants.length} in room`)
    parts.push(`song ${r.currentIndex + 1}/${r.queue.length}`)
    parts.push(r.playing ? 'playing' : 'paused')
  }
  if (s.error) parts.push(`error: ${s.error}`)
  return parts.join(', ')
}

export interface JamOptions {
  getWebContents(): WebContents | undefined
  getPrefs(): AppPrefs
  /** For tests: WebSocket, fetch, timers, clock. */
  deps?: Partial<Omit<JamClientDeps, 'getPrefs' | 'onStatus'>>
}

export function registerJam(opts: JamOptions): { client: JamClient; dispose(): Promise<void> } {
  let lastLine = ''
  const client = createJamClient({
    ...opts.deps,
    getPrefs: opts.getPrefs,
    onStatus: (status) => {
      // Clock updates resend the same summary; only changes are logged.
      const line = jamSummary(status)
      if (line !== lastLine) console.log(line)
      lastLine = line
      emit(opts.getWebContents(), 'jam:status', status)
    }
  })

  handle('jam:getStatus', () => client.getStatus())
  handle('jam:start', () => client.start())
  handle('jam:join', (code) => client.join(code))
  handle('jam:leave', () => client.leave())
  handle('jam:send', (command) => {
    console.log(`jam: sent ${command.type}`)
    return client.send(command)
  })
  handle('jam:setCapabilities', (canPlay) => client.setCapabilities(canPlay))

  return {
    client,
    async dispose() {
      for (const channel of CHANNELS) ipcMain.removeHandler(channel)
      await client.dispose()
    }
  }
}
