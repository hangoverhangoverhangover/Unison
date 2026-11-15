// Panel sizes and zoom limits for the glass UI. Shared by main (prefs validation)
// and the renderer (resize handles, zoom keys).

export const SIDEBAR = { rail: 72, min: 220, max: 420, snapBelow: 180, default: 280 } as const
export const RIGHT_PANEL = { min: 280, max: 480, default: 320 } as const
/** The main page never gets narrower than this; side panels give way first. */
export const MAIN_MIN = 420
/** Keys step by 10%, the Settings slider by 5%; every level snaps to 5%. */
export const ZOOM = { min: 0.7, max: 1.5, step: 0.1, sliderStep: 0.05 } as const

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
/** Nearest 5%, so repeated steps never drift (1.1 - 0.1 is 1, not 1.0000000000000002). */
const snap = (v: number): number => Math.round(v * 20) / 20

/** Below `snapBelow` the sidebar becomes the icon rail; otherwise min..max. */
export function clampSidebarWidth(px: number): number {
  if (!Number.isFinite(px)) return SIDEBAR.default
  if (px < SIDEBAR.snapBelow) return SIDEBAR.rail
  return Math.round(clamp(px, SIDEBAR.min, SIDEBAR.max))
}

export function clampRightPanelWidth(px: number): number {
  if (!Number.isFinite(px)) return RIGHT_PANEL.default
  return Math.round(clamp(px, RIGHT_PANEL.min, RIGHT_PANEL.max))
}

export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 1
  return clamp(snap(z), ZOOM.min, ZOOM.max)
}

/** 1 zooms in, -1 out, 0 resets to 100%. */
export function stepZoom(current: number, dir: 1 | -1 | 0): number {
  if (dir === 0) return 1
  return clampZoom(clampZoom(current) + dir * ZOOM.step)
}
