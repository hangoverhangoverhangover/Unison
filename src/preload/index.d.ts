import type { Api } from '../shared/ipc'
import type { BootTheme } from '../shared/config'

declare global {
  interface Window {
    api: Api
    /** Values the preload read before the first paint. */
    boot?: BootTheme
  }
}
