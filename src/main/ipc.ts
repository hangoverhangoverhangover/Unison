import { ipcMain, type WebContents } from 'electron'
import type {
  EventChannel,
  InvokeArgs,
  InvokeChannel,
  InvokeResult,
  IpcEventMap
} from '@shared/ipc'

/** Register a handler for a channel in the shared IPC contract. */
export function handle<C extends InvokeChannel>(
  channel: C,
  fn: (...args: InvokeArgs<C>) => InvokeResult<C> | Promise<InvokeResult<C>>
): void {
  ipcMain.handle(channel, (_event, ...args) => fn(...(args as InvokeArgs<C>)))
}

/** Send a typed event to a renderer. No-op if it's gone. */
export function emit<C extends EventChannel>(
  target: WebContents | undefined,
  channel: C,
  payload: IpcEventMap[C]
): void {
  if (target && !target.isDestroyed()) target.send(channel, payload)
}
