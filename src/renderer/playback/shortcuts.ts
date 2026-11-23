// Keyboard shortcuts for the main window (QoL round 2). The list lives in lib/shortcuts.ts.
import type { Track } from '@shared/types'
import { isTyping, SEEK_STEP_MS, VOLUME_STEP } from '@renderer/lib/shortcuts'
import { serviceStore } from '@renderer/state/services'
import { useUi } from '@renderer/state/ui'
import { useAppearance } from '@renderer/state/appearance'
import { stepZoom } from '@shared/layout'
import type { PlaybackController } from './controller'

function toggleLike(track: Track | undefined): void {
  if (!track || (track.provider !== 'spotify' && track.provider !== 'soundcloud')) return
  const store = serviceStore(track.provider === 'soundcloud' ? 'soundcloud' : 'spotify').getState()
  void store.setLiked(track, !(store.liked[track.id] ?? false)).catch(() => undefined)
}

function zoomBy(dir: 1 | -1 | 0): void {
  const { zoom, set } = useAppearance.getState()
  set({ zoom: stepZoom(zoom, dir) })
}

/** Ctrl + mouse wheel zooms, one step per notch (at most one step per 80 ms). */
const WHEEL_STEP_MS = 80

export function bindShortcuts(controller: PlaybackController): () => void {
  let lastWheel = 0
  const onWheel = (e: WheelEvent): void => {
    if (!e.ctrlKey || e.deltaY === 0) return
    e.preventDefault()
    const now = Date.now()
    if (now - lastWheel < WHEEL_STEP_MS) return
    lastWheel = now
    zoomBy(e.deltaY < 0 ? 1 : -1)
  }
  const onKey = (e: KeyboardEvent): void => {
    if (e.defaultPrevented || (e.repeat && e.key === ' ')) return
    const ctrl = e.ctrlKey || e.metaKey
    const typing = isTyping(e.target)

    // Work everywhere, even in text fields.
    if (ctrl && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      useUi.getState().openQuickSearch()
      return
    }
    // Zoom works everywhere too (Ctrl +/-/0, the numpad keys as well).
    if (ctrl && !e.altKey) {
      const dir =
        e.key === '=' || e.key === '+' || e.code === 'NumpadAdd'
          ? 1
          : e.key === '-' || e.code === 'NumpadSubtract'
            ? -1
            : e.key === '0' || e.code === 'Numpad0'
              ? 0
              : null
      if (dir !== null) {
        e.preventDefault()
        zoomBy(dir)
        return
      }
    }
    if (typing) return
    // Buttons and sliders handle Space/arrows themselves when focused.
    const el = e.target as HTMLElement | null
    const interactive = !!el?.closest?.('button, [role="slider"], [role="menuitem"], a')

    const s = controller.getState()
    switch (true) {
      case e.key === ' ' && !interactive:
        e.preventDefault()
        void controller.toggle()
        return
      case ctrl && e.key === 'ArrowRight':
        e.preventDefault()
        void controller.next()
        return
      case ctrl && e.key === 'ArrowLeft':
        e.preventDefault()
        void controller.previous()
        return
      case e.altKey && e.key === 'ArrowLeft':
        e.preventDefault()
        useUi.getState().back()
        return
      case e.altKey && e.key === 'ArrowRight':
        e.preventDefault()
        useUi.getState().goForward()
        return
      case !ctrl && !e.altKey && e.key === 'ArrowRight' && !interactive:
        e.preventDefault()
        controller.seek(controller.getPositionMs() + SEEK_STEP_MS)
        return
      case !ctrl && !e.altKey && e.key === 'ArrowLeft' && !interactive:
        e.preventDefault()
        controller.seek(Math.max(0, controller.getPositionMs() - SEEK_STEP_MS))
        return
      case !ctrl && e.key === 'ArrowUp' && !interactive:
        e.preventDefault()
        controller.setVolume(Math.min(1, s.volume + VOLUME_STEP))
        return
      case !ctrl && e.key === 'ArrowDown' && !interactive:
        e.preventDefault()
        controller.setVolume(Math.max(0, s.volume - VOLUME_STEP))
        return
      case !ctrl && !e.altKey && e.key.toLowerCase() === 'm':
        controller.setMuted(!s.muted)
        return
      case ctrl && e.key.toLowerCase() === 'l':
        e.preventDefault()
        toggleLike(s.current?.track)
        return
    }
  }
  window.addEventListener('keydown', onKey)
  window.addEventListener('wheel', onWheel, { passive: false })
  return () => {
    window.removeEventListener('keydown', onKey)
    window.removeEventListener('wheel', onWheel)
  }
}
