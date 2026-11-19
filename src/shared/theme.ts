// Custom theme (QoL 3): your own colours, background, glass and font. Stored in the app
// prefs (validated in main); the background image is kept apart (see theme:getImage),
// so prefs stay small. Applied as CSS variables on <html>, over the dark/light glass.

export type Backdrop = 'solid' | 'gradient' | 'image'
export const BACKDROPS: readonly Backdrop[] = ['solid', 'gradient', 'image']

export const FONTS = {
  figtree: {
    label: 'Figtree',
    stack: "'Figtree Variable', 'Segoe UI Variable', system-ui, sans-serif"
  },
  segoe: { label: 'Segoe UI', stack: "'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif" },
  bahnschrift: { label: 'Bahnschrift', stack: "Bahnschrift, 'Segoe UI', system-ui, sans-serif" },
  system: { label: 'System', stack: 'system-ui, sans-serif' },
  serif: { label: 'Serif', stack: "Georgia, 'Times New Roman', serif" },
  mono: { label: 'Mono', stack: "'Cascadia Code', Consolas, ui-monospace, monospace" }
} as const
export type FontId = keyof typeof FONTS
export const FONT_IDS = Object.keys(FONTS) as FontId[]

export interface CustomTheme {
  /** Buttons, highlights, sliders. */
  accent: string
  /** The window colour, and the tint of the glass. */
  background: string
  /** Second colour of a gradient background. */
  background2: string
  text: string
  backdrop: Backdrop
  /** Gradient direction, degrees. */
  gradientAngle: number
  /** Shade over a background image so text reads (0-0.85). */
  imageDim: number
  /** Panel blur in px; the play bar and dialogs blur more. */
  blur: number
  /** How solid the glass is (0.1-0.95). */
  opacity: number
  /** Panel corner radius in px. */
  radius: number
  font: FontId
}

export const DEFAULT_CUSTOM_THEME: CustomTheme = {
  accent: '#7289da',
  background: '#141522',
  background2: '#3a1f5c',
  text: '#ffffff',
  backdrop: 'gradient',
  gradientAngle: 135,
  imageDim: 0.45,
  blur: 28,
  opacity: 0.42,
  radius: 12,
  font: 'figtree'
}

export const THEME_LIMITS = {
  blur: { min: 0, max: 80 },
  opacity: { min: 0.1, max: 0.95 },
  radius: { min: 0, max: 28 },
  imageDim: { min: 0, max: 0.85 },
  gradientAngle: { min: 0, max: 360 }
} as const

const HEX = /^#[0-9a-f]{6}$/i

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const rgba = (hex: string, a: number): string => {
  const [r, g, b] = rgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${Math.round(a * 1000) / 1000})`
}

/** WCAG relative luminance, 0-1. */
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/** Light enough that dark text reads better on it than white. */
export function isLightColor(hex: string): boolean {
  return contrastRatio(hex, '#14151a') > contrastRatio(hex, '#ffffff')
}

/** Mix a colour towards white (amount > 0) or black (amount < 0). */
function shade(hex: string, amount: number): string {
  const target = amount > 0 ? 255 : 0
  const t = Math.abs(amount)
  return (
    '#' +
    rgb(hex)
      .map((c) => Math.round(c + (target - c) * t))
      .map((c) => c.toString(16).padStart(2, '0'))
      .join('')
  )
}

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

/** A clean theme: each bad or missing field falls back to the default on its own. */
export function validateCustomTheme(raw: unknown): CustomTheme {
  const out: CustomTheme = { ...DEFAULT_CUSTOM_THEME }
  if (typeof raw !== 'object' || raw === null) return out
  const r = raw as Record<string, unknown>
  for (const key of ['accent', 'background', 'background2', 'text'] as const) {
    const v = r[key]
    if (typeof v === 'string' && HEX.test(v)) out[key] = v.toLowerCase()
  }
  if (BACKDROPS.includes(r.backdrop as Backdrop)) out.backdrop = r.backdrop as Backdrop
  if (FONT_IDS.includes(r.font as FontId)) out.font = r.font as FontId
  for (const key of Object.keys(THEME_LIMITS) as (keyof typeof THEME_LIMITS)[]) {
    const v = r[key]
    if (typeof v === 'number' && Number.isFinite(v))
      out[key] = clamp(v, THEME_LIMITS[key].min, THEME_LIMITS[key].max)
  }
  return out
}

/**
 * The CSS variables for a custom theme, set inline on <html>. They override the glass
 * set of app.css (and the accent, radius and font tokens Tailwind utilities read).
 */
export function customThemeVars(t: CustomTheme): Record<string, string> {
  const light = isLightColor(t.background)
  const strong = Math.min(t.opacity + 0.2, 0.95)
  return {
    '--glass-base': t.background,
    '--glass-tint': rgba(t.background, t.opacity),
    '--glass-tint-strong': rgba(t.background, strong),
    '--glass-play-bar': rgba(t.background, Math.min(t.opacity + 0.05, 0.95)),
    '--glass-border': rgba(t.text, 0.08),
    '--glass-highlight': light ? 'rgba(255, 255, 255, 0.7)' : 'rgba(255, 255, 255, 0.06)',
    '--glass-raised': rgba(t.text, light ? 0.05 : 0.08),
    '--glass-raised-hover': rgba(t.text, light ? 0.09 : 0.12),
    '--glass-scrim': light ? 'rgba(0, 0, 0, 0.15)' : 'rgba(0, 0, 0, 0.25)',
    '--glass-text': t.text,
    '--glass-text-subdued': rgba(t.text, 0.72),
    '--glass-text-muted': rgba(t.text, 0.55),
    '--glass-divider': rgba(t.text, 0.08),
    '--glass-progress-track': rgba(t.text, 0.18),
    '--scrollbar-thumb': rgba(t.text, 0.16),
    '--scrollbar-thumb-hover': rgba(t.text, 0.28),
    '--color-accent': t.accent,
    '--color-accent-hover': shade(t.accent, 0.12),
    '--color-accent-pressed': shade(t.accent, -0.12),
    '--color-on-accent': isLightColor(t.accent) ? '#14151a' : '#ffffff',
    '--blur-panel': `${t.blur}px`,
    '--blur-play-bar': `${t.blur * 2}px`,
    '--blur-overlay': `${Math.round(t.blur * 1.4)}px`,
    '--radius-panel': `${t.radius}px`,
    '--radius-play-bar': `${t.radius + 6}px`,
    '--font-sans': FONTS[t.font].stack,
    'color-scheme': light ? 'light' : 'dark'
  }
}

/** Every variable customThemeVars sets, to clear them when leaving the custom theme. */
export const CUSTOM_THEME_VAR_NAMES = Object.keys(customThemeVars(DEFAULT_CUSTOM_THEME))

/** The window background for a custom theme (the image is drawn separately). */
export function customBackdrop(t: CustomTheme): string {
  return t.backdrop === 'gradient'
    ? `linear-gradient(${t.gradientAngle}deg, ${t.background}, ${t.background2})`
    : t.background
}

/** Largest theme file we read (a downsized background image fits well inside). */
export const MAX_THEME_FILE_BYTES = 12 * 1024 * 1024
const IMAGE_DATA_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/

/** A shareable theme file: the theme and, if it has one, its background image. */
export function themeFile(theme: CustomTheme, image: string | null): string {
  return JSON.stringify(
    { app: 'Unison', kind: 'theme', version: 1, theme, image: image ?? null },
    null,
    2
  )
}

export function parseThemeFile(text: string): { theme: CustomTheme; image: string | null } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    raw = null
  }
  const r = raw as Record<string, unknown> | null
  if (!r || typeof r !== 'object' || r.kind !== 'theme' || typeof r.theme !== 'object')
    throw new Error('This is not a Unison theme file.')
  const image = typeof r.image === 'string' && IMAGE_DATA_URL.test(r.image) ? r.image : null
  return { theme: validateCustomTheme(r.theme), image }
}

export function isImageDataUrl(v: unknown): v is string {
  return typeof v === 'string' && IMAGE_DATA_URL.test(v)
}
