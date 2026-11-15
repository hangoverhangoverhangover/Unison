// jam:* IPC handlers: the Jam (shared listening) client.
import { ipcMain, type WebContents } from 'electron'
import type { AppPrefs } from '@shared/config'
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

export interface JamOptions {
  getWebContents(): WebContents | undefined
  getPrefs(): AppPrefs
  /** For tests: WebSocket, fetch, timers, clock. */
  deps?: Partial<Omit<JamClientDeps, 'getPrefs' | 'onStatus'>>
}

export function registerJam(opts: JamOptions): { client: JamClient; dispose(): Promise<void> } {
  const client = createJamClient({
    ...opts.deps,
    getPrefs: opts.getPrefs,
    onStatus: (status) => emit(opts.getWebContents(), 'jam:status', status)
  })

  handle('jam:getStatus', () => client.getStatus())
  handle('jam:start', () => client.start())
  handle('jam:join', (code) => client.join(code))
  handle('jam:leave', () => client.leave())
  handle('jam:send', (command) => client.send(command))
  handle('jam:setCapabilities', (canPlay) => client.setCapabilities(canPlay))

  return {
    client,
    async dispose() {
      for (const channel of CHANNELS) ipcMain.removeHandler(channel)
      await client.dispose()
    }
  }
}
