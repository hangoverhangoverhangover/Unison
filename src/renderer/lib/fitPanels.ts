import { MAIN_MIN, SIDEBAR } from '@shared/layout'

/** Gap between panels. */
const GAP = 8

/**
 * What to render at this width (the root's content box) so the main page keeps
 * MAIN_MIN. An opened right panel is something the user asked for, so the sidebar
 * folds to the icon rail first; the right panel closes only if it doesn't fit even
 * beside the rail. Only shapes what is shown; saved widths and the open state stay.
 */
export function fitPanels(
  width: number,
  sidebar: number,
  right: number,
  rightOpen: boolean
): { sidebar: number; rightOpen: boolean } {
  const main = (s: number, open: boolean): number => width - s - GAP - (open ? right + GAP : 0)
  if (main(sidebar, rightOpen) >= MAIN_MIN) return { sidebar, rightOpen }
  if (rightOpen && main(SIDEBAR.rail, true) >= MAIN_MIN) return { sidebar: SIDEBAR.rail, rightOpen }
  if (main(sidebar, false) >= MAIN_MIN) return { sidebar, rightOpen: false }
  return { sidebar: SIDEBAR.rail, rightOpen: false }
}
