import { contextBridge, ipcRenderer } from 'electron'
import { EVENT_CHANNELS, INVOKE_CHANNELS, type Api } from '@shared/ipc'
import { BOOT_THEME_CHANNEL, THEMES, type BootTheme, type Theme } from '@shared/config'
import { customThemeVars, validateCustomTheme } from '@shared/theme'

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

// The saved theme, before the page paints, so a Light (or custom) user never sees a
// dark flash.
function bootTheme(): BootTheme {
  try {
    const b = ipcRenderer.sendSync(BOOT_THEME_CHANNEL) as Partial<BootTheme> | null
    const theme = THEMES.includes(b?.theme as Theme) ? (b!.theme as Theme) : 'artwork'
    return theme === 'custom' ? { theme, custom: validateCustomTheme(b?.custom) } : { theme }
  } catch {
    return { theme: 'artwork' }
  }
}
const boot = bootTheme()
contextBridge.exposeInMainWorld('boot', boot)
const apply = (): void => {
  const root = document.documentElement
  root.dataset.theme = boot.theme
  if (boot.custom)
    for (const [k, v] of Object.entries(customThemeVars(boot.custom))) root.style.setProperty(k, v)
}
if (document.documentElement) apply()
else document.addEventListener('readystatechange', apply, { once: true })
