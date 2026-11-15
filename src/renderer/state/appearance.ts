// Glass UI appearance: theme, zoom and panel sizes. Stored in AppPrefs (main validates),
// mirrored here so drags and key presses update the UI at once.
import { create } from 'zustand'
import { DEFAULT_APP_PREFS, type AppPrefs, type PanelTab, type Theme } from '@shared/config'

/** How long to wait after the last change before saving (drags fire many changes). */
const SAVE_DELAY_MS = 250

type AppearancePrefs = Pick<
  AppPrefs,
  'theme' | 'zoom' | 'sidebarWidth' | 'rightPanelWidth' | 'rightPanelTab'
>

interface AppearanceState extends AppearancePrefs {
  /** Update now, save to prefs shortly after. */
  set(patch: Partial<AppearancePrefs>): void
}

let pending: Partial<AppPrefs> = {}
let timer: ReturnType<typeof setTimeout> | undefined

function save(patch: Partial<AppPrefs>): void {
  pending = { ...pending, ...patch }
  clearTimeout(timer)
  timer = setTimeout(() => {
    const out = pending
    pending = {}
    void window.api.invoke('prefs:set', out).catch((err) => {
      console.warn('saving appearance failed', err)
    })
  }, SAVE_DELAY_MS)
}

const pick = (p: AppPrefs): AppearancePrefs => ({
  theme: p.theme,
  zoom: p.zoom,
  sidebarWidth: p.sidebarWidth,
  rightPanelWidth: p.rightPanelWidth,
  rightPanelTab: p.rightPanelTab
})

export const useAppearance = create<AppearanceState>((set) => ({
  ...pick(DEFAULT_APP_PREFS),
  // The preload read the saved theme before the first paint.
  theme: (typeof window !== 'undefined' && window.boot?.theme) || DEFAULT_APP_PREFS.theme,
  set(patch) {
    set(patch)
    save(patch)
  }
}))

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
}

/**
 * Load appearance prefs, keep <html data-theme> in step and follow changes made
 * elsewhere (Settings, another prefs:set). The main window and the mini player both
 * call it (the mini player only uses the theme).
 */
export function bindAppearance(): () => void {
  let disposed = false
  applyTheme(useAppearance.getState().theme)
  void window.api.invoke('prefs:get').then((p) => {
    if (disposed) return
    useAppearance.setState(pick(p))
  })
  const offStore = useAppearance.subscribe((s, prev) => {
    if (s.theme !== prev.theme) applyTheme(s.theme)
  })
  const offPrefs = window.api.on('prefs:changed', (p) => {
    // A save of ours still in flight wins over the echo of an older one.
    const mine = Object.keys(pending) as (keyof AppearancePrefs)[]
    const next = pick(p)
    for (const key of mine) delete (next as Partial<AppearancePrefs>)[key]
    useAppearance.setState(next)
  })
  return () => {
    disposed = true
    offStore()
    offPrefs()
  }
}

export type { PanelTab, Theme }
