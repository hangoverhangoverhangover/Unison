/**
 * Design tokens. Approved 2026-11-09. styles/app.css mirrors these for Tailwind.
 *
 * Source: design/references (Comfy-style). Hex values were sampled from
 * comfy.png and npv.png. Layout: floating rounded panels on a slightly
 * darker base, one periwinkle accent, a blurred-artwork hero on playlist pages.
 */

export const color = {
  // One accent for the whole UI: play button, progress, toggles, focus.
  accent: '#7289da',
  accentHover: '#8299e6',
  accentPressed: '#5f74c4',
  onAccent: '#1e2233', // icon/text on the accent

  like: '#f15e6c', // filled heart
  danger: '#e5484d',

  // Source dots and badges only. Never used to tint surfaces.
  source: {
    spotify: '#1ed760',
    soundcloud: '#ff5500',
    local: '#b3b5bc'
  }
} as const

/**
 * Glass UI surfaces and text, per theme (approved 2026-11-14, see
 * docs/superpowers/specs/2026-11-14-glass-ui-design.md). The 'artwork' theme uses
 * the dark set over the blurred artwork; 'light' is bright white frosted glass.
 * app.css sets these as --glass-* variables on :root (dark) and
 * :root[data-theme='light'], and the Tailwind colours point at them.
 */
const darkGlass = {
  base: '#141522', // solid fallback behind everything, inputs, scrims
  tint: 'rgba(20, 18, 32, 0.42)', // sidebar, main page, right panel
  tintStrong: 'rgba(24, 20, 38, 0.62)', // dialogs, menus, popovers, quick search
  playBar: 'rgba(18, 14, 30, 0.45)',
  border: 'rgba(255, 255, 255, 0.08)',
  highlight: 'rgba(255, 255, 255, 0.06)', // 1px inner top edge
  raised: 'rgba(255, 255, 255, 0.08)', // active row, chips, inputs
  raisedHover: 'rgba(255, 255, 255, 0.12)',
  scrim: 'rgba(0, 0, 0, 0.25)', // behind dialogs
  text: '#ffffff',
  textSubdued: 'rgba(255, 255, 255, 0.72)',
  textMuted: 'rgba(255, 255, 255, 0.58)',
  divider: 'rgba(255, 255, 255, 0.08)',
  progressTrack: 'rgba(255, 255, 255, 0.18)'
} as const

const lightGlass = {
  base: '#eef0f5',
  tint: 'rgba(255, 255, 255, 0.6)',
  tintStrong: 'rgba(255, 255, 255, 0.78)',
  playBar: 'rgba(255, 255, 255, 0.7)',
  border: 'rgba(0, 0, 0, 0.06)',
  highlight: 'rgba(255, 255, 255, 0.7)',
  raised: 'rgba(20, 21, 26, 0.05)',
  raisedHover: 'rgba(20, 21, 26, 0.09)',
  scrim: 'rgba(0, 0, 0, 0.15)',
  text: '#14151a',
  textSubdued: 'rgba(20, 21, 26, 0.72)',
  textMuted: 'rgba(20, 21, 26, 0.52)',
  divider: 'rgba(20, 21, 26, 0.08)',
  progressTrack: 'rgba(20, 21, 26, 0.14)'
} as const

export const glass = { dark: darkGlass, light: lightGlass } as const

/** backdrop-filter / filter blur strengths in px. */
export const blur = {
  panel: 28,
  playBar: 56,
  overlay: 40,
  ambient: 80
} as const

export const font = {
  // Figtree: geometric sans close to the references, bundled locally (CSP is 'self').
  family: '"Figtree Variable", "Segoe UI Variable", system-ui, sans-serif',
  weight: { regular: 400, medium: 500, bold: 700, black: 800 },
  /** [size px, line-height px] */
  size: {
    xs: [11, 14], // badges, timestamps under the seek bar
    sm: [13, 18], // secondary row text, artist names
    md: [14, 20], // body, track titles, nav items
    lg: [16, 22], // panel headers ("Your Library", "Queue")
    xl: [24, 30], // section headings ("Made for you")
    hero: [72, 76] // playlist / album title over the blurred hero
  }
} as const

/** 4px grid. */
export const space = {
  0: 0,
  1: 4,
  2: 8, // gap between panels
  3: 12,
  4: 16, // panel padding
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48
} as const

export const radius = {
  sm: 4, // artwork thumbnails, badges
  md: 6, // buttons, chips, inputs
  lg: 8, // cards, rows on hover
  panel: 12, // glass panels
  playBar: 18, // floating play bar
  full: 9999 // play button, avatars, seek thumb
} as const

export const size = {
  titleBar: 40,
  playBar: 64, // floating bar height
  playBarInset: 14, // gap between the bar and the main page's edges
  listFade: 24, // page content fades out over this much just above the play bar
  // Sidebar and right panel limits live in src/shared/layout.ts.
  row: 56, // track row
  thumb: { row: 40, nav: 48, playBar: 56 },
  card: 180 // grid card artwork
} as const

/**
 * Motion answers user actions only; nothing idles.
 * Animate transform and opacity only.
 */
export const motion = {
  duration: {
    instant: 80, // press feedback
    fast: 140, // hover, chip toggles
    base: 220, // panel slide, row reorder
    slow: 320, // page transitions
    crossfade: 400 // artwork / hero background on track change
  },
  easing: {
    standard: 'cubic-bezier(0.2, 0, 0, 1)',
    exit: 'cubic-bezier(0.4, 0, 1, 1)'
  },
  /** Like button pop and panel slide (Motion spring). */
  spring: { type: 'spring', stiffness: 520, damping: 30, mass: 0.8 }
} as const

export const effect = {
  heroBlur: 48, // px blur on artwork behind playlist headers
  heroDim: 0.45, // dark gradient over the blurred artwork, top to bottom
  shadowRaised: '0 8px 24px rgba(0, 0, 0, 0.35)' // menus, popovers, mini-player
} as const
