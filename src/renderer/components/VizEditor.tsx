// The visualizer settings in a panel floating over the Player page (right-click →
// "Edit visualizer…"), so every change shows live behind it. Drag it by its header;
// Esc or the cross closes it. The same controls are in Settings → Player.
import { GripHorizontal, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { usePlayerPage } from '@renderer/state/playerPage'
import { VisualizerSettings } from './PlayerMediaSection'
import Switch from './Switch'

const MARGIN = 12

export default function VizEditor({ onClose }: { onClose: () => void }): React.JSX.Element {
  const visible = usePlayerPage((s) => s.parts.visualizer)
  const setPart = usePlayerPage((s) => s.setPart)
  const panel = useRef<HTMLDivElement>(null)
  // Offset from the top-right corner where it opens. Kept in a ref and written straight
  // to the element while dragging: re-rendering on every move made the sliding option
  // highlights (layout animations) chase the panel.
  const pos = useRef({ x: 0, y: 0 })
  const place = (el: HTMLElement): void => {
    const { x, y } = pos.current
    el.style.top = `${MARGIN + y}px`
    el.style.right = `${MARGIN - x}px`
    // Always ends above the play bar, wherever it's dragged.
    el.style.maxHeight = `calc(100% - ${MARGIN * 2 + y}px - var(--play-bar-height) - var(--play-bar-inset))`
  }
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null)

  // React re-renders (any setting change) would put the opening style back: re-apply.
  useLayoutEffect(() => {
    if (panel.current) place(panel.current)
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const onPointerDown = (e: React.PointerEvent): void => {
    if ((e.target as HTMLElement).closest('button')) return
    // No text selection while dragging.
    e.preventDefault()
    drag.current = { x: e.clientX, y: e.clientY, px: pos.current.x, py: pos.current.y }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent): void => {
    const d = drag.current
    const el = panel.current
    const box = el?.offsetParent?.getBoundingClientRect()
    if (!d || !el || !box) return
    // Keep the header on screen.
    const maxLeft = box.width - el.offsetWidth - MARGIN * 2
    const x = Math.min(0, Math.max(-maxLeft, d.px + e.clientX - d.x))
    const y = Math.max(0, Math.min(box.height - 240, d.py + e.clientY - d.y))
    pos.current = { x, y }
    place(el)
  }
  const onPointerUp = (): void => {
    drag.current = null
  }

  return (
    <div
      ref={panel}
      role="dialog"
      aria-label="Edit visualizer"
      // The page's own right-click menu shouldn't open over the panel.
      onContextMenu={(e) => e.stopPropagation()}
      className="glass-strong absolute z-20 flex w-[min(380px,calc(100%-24px))] flex-col overflow-hidden rounded-xl text-text shadow-2xl"
      style={{
        top: MARGIN,
        right: MARGIN,
        maxHeight: `calc(100% - ${MARGIN * 2}px - var(--play-bar-height) - var(--play-bar-inset))`
      }}
    >
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="flex flex-none cursor-grab items-center gap-2 border-b border-divider px-4 py-2.5 select-none active:cursor-grabbing"
      >
        <GripHorizontal size={14} className="text-text-muted" />
        <p className="flex-1 text-sm font-bold">Visualizer</p>
        <Switch
          label="Show visualizer"
          checked={visible}
          onChange={(on) => setPart('visualizer', on)}
        />
        <button
          onClick={onClose}
          aria-label="Close"
          title="Close (Esc)"
          className="rounded-md p-1 text-text-subdued hover:bg-raised hover:text-text"
        >
          <X size={16} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <VisualizerSettings inPanel />
      </div>
    </div>
  )
}
