// Glass UI appearance: theme, zoom and panel sizes. Stored in AppPrefs (main validates),
// mirrored here so drags and key presses update the UI at once.
import { create } from 'zustand'
import { DEFAULT_APP_PREFS, type AppPrefs, type PanelTab, type Theme } from '@shared/config'
import {
  CUSTOM_THEME_VAR_NAMES,
  customThemeVars,
  isLightColor,
  type CustomTheme
} from '@shared/theme'

/** How long to wait after the last change before saving (drags fire many changes). */
const SAVE_DELAY_MS = 250

type AppearancePrefs = Pick<
  AppPrefs,
  'theme' | 'customTheme' | 'zoom' | 'sidebarWidth' | 'rightPanelWidth' | 'rightPanelTab'
>

interface AppearanceState extends AppearancePrefs {
  /** Update now, save to prefs shortly after. */
  set(patch: Partial<AppearancePrefs>): void
  /** The custom theme's background image (data URL), loaded from main. */
  customImage: string | null
  /** Save (or remove) the custom background image. */
  setCustomImage(image: string | null): Promise<void>
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
  customTheme: p.customTheme,
  zoom: p.zoom,
  sidebarWidth: p.sidebarWidth,
  rightPanelWidth: p.rightPanelWidth,
  rightPanelTab: p.rightPanelTab
})

export const useAppearance = create<AppearanceState>((set) => ({
  ...pick(DEFAULT_APP_PREFS),
  // The preload read the saved theme before the first paint.
  theme: (typeof window !== 'undefined' && window.boot?.theme) || DEFAULT_APP_PREFS.theme,
  customTheme:
    (typeof window !== 'undefined' && window.boot?.custom) || DEFAULT_APP_PREFS.customTheme,
  set(patch) {
    set(patch)
    save(patch)
  },
  customImage: null,
  async setCustomImage(image) {
    await window.api.invoke('theme:setImage', image)
    set({ customImage: image })
  }
}))

/** The glass is light (dark text): the Light theme, or a custom theme on a light colour. */
export function isLightTheme(theme: Theme, custom: CustomTheme): boolean {
  return theme === 'light' || (theme === 'custom' && isLightColor(custom.background))
}

export const useLightTheme = (): boolean =>
  useAppearance((s) => isLightTheme(s.theme, s.customTheme))

function applyTheme(theme: Theme, custom: CustomTheme): void {
  const root = document.documentElement
  root.dataset.theme = theme
  if (theme === 'custom')
    for (const [k, v] of Object.entries(customThemeVars(custom))) root.style.setProperty(k, v)
  else for (const k of CUSTOM_THEME_VAR_NAMES) root.style.removeProperty(k)
}

/**
 * Load appearance prefs, keep <html data-theme> in step and follow changes made
 * elsewhere (Settings, another prefs:set). The main window and the mini player both
 * call it (the mini player only uses the theme).
 */
export function bindAppearance(): () => void {
  let disposed = false
  const first = useAppearance.getState()
  applyTheme(first.theme, first.customTheme)
  void window.api.invoke('prefs:get').then((p) => {
    if (disposed) return
    useAppearance.setState(pick(p))
  })
  void window.api.invoke('theme:getImage').then((image) => {
    if (!disposed) useAppearance.setState({ customImage: image })
  })
  const offStore = useAppearance.subscribe((s, prev) => {
    if (s.theme !== prev.theme || s.customTheme !== prev.customTheme)
      applyTheme(s.theme, s.customTheme)
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
