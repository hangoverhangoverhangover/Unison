import { useRef, useState } from 'react'

/**
 * Drag handle on a panel's inner edge (Spotify-style). An invisible 8 px hit area
 * centred on the gap beside the panel; on hover or drag a thin accent line shows.
 * `side` is the edge of the handle's own panel: the sidebar uses 'right', the right
 * panel uses 'left'. `scale` is the CSS zoom of the panel, so a drag tracks the pointer.
 */
export default function ResizeHandle({
  side,
  value,
  scale = 1,
  label,
  onChange,
  onCommit,
  onDoubleClick
}: {
  side: 'left' | 'right'
  value: number
  scale?: number
  label: string
  onChange: (px: number) => void
  onCommit: (px: number) => void
  onDoubleClick?: () => void
}): React.JSX.Element {
  const start = useRef<{ x: number; value: number } | null>(null)
  const last = useRef(value)
  const [dragging, setDragging] = useState(false)

  const widthAt = (clientX: number): number => {
    const s = start.current!
    const dx = (clientX - s.x) / scale
    return side === 'right' ? s.value + dx : s.value - dx
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      tabIndex={-1}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.currentTarget.setPointerCapture(e.pointerId)
        start.current = { x: e.clientX, value }
        last.current = value
        setDragging(true)
      }}
      onPointerMove={(e) => {
        if (!start.current) return
        last.current = widthAt(e.clientX)
        onChange(last.current)
      }}
      onPointerUp={() => {
        if (!start.current) return
        start.current = null
        setDragging(false)
        onCommit(last.current)
      }}
      onPointerCancel={() => {
        if (!start.current) return
        start.current = null
        setDragging(false)
        onCommit(last.current)
      }}
      onDoubleClick={onDoubleClick}
      className={`group absolute top-0 bottom-0 z-30 w-2 cursor-col-resize ${
        side === 'right' ? '-right-[8px]' : '-left-[8px]'
      }`}
    >
      <span
        className={`absolute inset-y-3 left-1/2 w-0.5 -translate-x-1/2 rounded-full bg-accent transition-opacity duration-[140ms] ${
          dragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-70'
        }`}
      />
    </div>
  )
}
