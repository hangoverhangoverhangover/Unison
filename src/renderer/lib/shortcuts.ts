/** Shortcut list, shared by the key handler and the cheat sheet in Settings. */
export interface Shortcut {
  keys: string[]
  action: string
}

export const SHORTCUTS: Shortcut[] = [
  { keys: ['Space'], action: 'Play or pause' },
  { keys: ['Ctrl', '→'], action: 'Next track' },
  { keys: ['Ctrl', '←'], action: 'Previous track' },
  { keys: ['→'], action: 'Forward 5 seconds' },
  { keys: ['←'], action: 'Back 5 seconds' },
  { keys: ['↑'], action: 'Volume up' },
  { keys: ['↓'], action: 'Volume down' },
  { keys: ['M'], action: 'Mute or unmute' },
  { keys: ['Ctrl', 'L'], action: 'Like or unlike the playing track' },
  { keys: ['Ctrl', 'K'], action: 'Search' },
  { keys: ['Ctrl', 'F'], action: 'Search in the current list' },
  { keys: ['Alt', '←'], action: 'Back' },
  { keys: ['Alt', '→'], action: 'Forward' },
  { keys: ['Ctrl', '+'], action: 'Zoom in' },
  { keys: ['Ctrl', '−'], action: 'Zoom out' },
  { keys: ['Ctrl', '0'], action: 'Reset zoom' }
]

export const SEEK_STEP_MS = 5000
export const VOLUME_STEP = 0.05

/** True when the key press is meant for a text field, not a shortcut. */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || typeof el.tagName !== 'string') return false
  if (el.isContentEditable) return true
  const tag = el.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag !== 'INPUT') return false
  const type = (el as HTMLInputElement).type
  return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset'].includes(type)
}
