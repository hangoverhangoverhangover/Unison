import { contextBridge, ipcRenderer } from 'electron'
import { EVENT_CHANNELS, INVOKE_CHANNELS, type Api } from '@shared/ipc'
import { BOOT_THEME_CHANNEL, THEMES, type Theme } from '@shared/config'

// Typed IPC bridge. Only channels in the shared allowlists get through;
// the renderer never sees ipcRenderer itself.
const api: Api = {
  invoke(channel, ...args) {
    if (!INVOKE_CHANNELS.includes(channel)) {
      return Promise.reject(new Error(`Blocked IPC channel: ${channel}`))
    }
    return ipcRenderer.invoke(channel, ...args)
  },
  on(channel, listener) {
    if (!EVENT_CHANNELS.includes(channel)) {
      throw new Error(`Blocked IPC channel: ${channel}`)
    }
    const wrapped = (_e: Electron.IpcRendererEvent, ...args: unknown[]): void =>
      listener(args[0] as Parameters<typeof listener>[0])
    ipcRenderer.on(channel, wrapped)
    return () => {
      ipcRenderer.removeListener(channel, wrapped)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)

// The saved theme, before the page paints, so a Light user never sees a dark flash.
function bootTheme(): Theme {
  try {
    const t = ipcRenderer.sendSync(BOOT_THEME_CHANNEL) as unknown
    return THEMES.includes(t as Theme) ? (t as Theme) : 'artwork'
  } catch {
    return 'artwork'
  }
}
const theme = bootTheme()
contextBridge.exposeInMainWorld('boot', { theme })
const apply = (): void => {
  document.documentElement.dataset.theme = theme
}
if (document.documentElement) apply()
else document.addEventListener('readystatechange', apply, { once: true })
