import { MoreHorizontal, type LucideIcon } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export interface MoreMenuItem {
  label: string
  icon?: LucideIcon
  onSelect: () => void
  danger?: boolean
}

/**
 * "⋯" menu for a page's less common actions (copy to the other service, change
 * cover, rename, delete). A small frosted popover; arrow keys move, Esc closes.
 * Built in place rather than with another Radix package, to keep installs (and the
 * VMP-signed Electron) untouched.
 */
export default function MoreMenu({
  items,
  label = 'More options'
}: {
  items: MoreMenuItem[]
  label?: string
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  /** Where the menu opens (viewport px, under the button). */
  const [at, setAt] = useState({ top: 0, left: 0 })
  const boxRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const first = menuRef.current?.querySelector<HTMLElement>('[role=menuitem]')
    first?.focus({ preventScroll: true })
    const onDown = (e: PointerEvent): void => {
      const t = e.target as Node
      if (!boxRef.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false)
    }
    // Anchored by position, so close it when the page under it moves.
    const onMove = (): void => setOpen(false)
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
    }
  }, [open])

  // Keep the menu inside the window (flip up / shift left near the edges).
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!open || !el) return
    const r = el.getBoundingClientRect()
    const button = buttonRef.current!.getBoundingClientRect()
    const top = r.bottom > window.innerHeight - 8 ? Math.max(8, button.top - 6 - r.height) : at.top
    const left = Math.max(8, Math.min(at.left, window.innerWidth - 8 - r.width))
    if (top !== at.top || left !== at.left) setAt({ top, left })
  }, [open, at])

  if (items.length === 0) return null

  const onKeyDown = (e: React.KeyboardEvent): void => {
    const all = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])]
    const at = all.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      buttonRef.current?.focus()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      all[(at + 1) % all.length]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      all[(at - 1 + all.length) % all.length]?.focus()
    }
  }

  return (
    <div ref={boxRef} className="relative">
      <button
        ref={buttonRef}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          const r = buttonRef.current!.getBoundingClientRect()
          setAt({ top: r.bottom + 6, left: r.left })
          setOpen(!open)
        }}
        className={`flex size-10 items-center justify-center rounded-full transition-colors duration-[140ms] ${
          open ? 'bg-raised text-text' : 'text-text-subdued hover:bg-raised hover:text-text'
        }`}
      >
        <MoreHorizontal size={22} />
      </button>
      {open &&
        // Portalled so a page hero's overflow clipping can't cut the menu off.
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={label}
            onKeyDown={onKeyDown}
            onBlur={(e) => {
              // Tabbing out of the menu closes it.
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false)
            }}
            className="glass-strong fixed z-50 min-w-56 rounded-xl p-1"
            style={at}
          >
            {items.map(({ label: l, icon: Icon, onSelect, danger }) => (
              <button
                key={l}
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  onSelect()
                }}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-md outline-none transition-colors duration-[80ms] hover:bg-raised-hover focus-visible:bg-raised-hover ${
                  danger ? 'text-danger' : 'text-text'
                }`}
              >
                {Icon && <Icon size={16} className={danger ? '' : 'text-text-subdued'} />}
                {l}
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  )
}
