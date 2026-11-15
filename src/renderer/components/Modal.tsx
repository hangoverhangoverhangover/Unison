import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { motion as m } from '@renderer/styles/tokens'

/** Centered dialog over the window. Escape or the backdrop closes it (unless `busy`). */
export default function Modal({
  open,
  onClose,
  title,
  subtitle,
  busy,
  width = 'w-[min(720px,90vw)]',
  footer,
  children
}: {
  open: boolean
  onClose: () => void
  title: React.ReactNode
  subtitle?: React.ReactNode
  /** While true the dialog can't be dismissed (a write is in progress). */
  busy?: boolean
  width?: string
  footer?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    panelRef.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      // A panel above this one (quick search) handled Esc already.
      if (e.key === 'Escape' && !busy && !e.defaultPrevented) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, onClose])

  return (
    <AnimatePresence>
      {open && (
        <div
          key="modal"
          // no-drag: the title bar's drag region must not act through the overlay.
          className="no-drag fixed inset-0 z-50 flex items-start justify-center pt-[8vh]"
        >
          {/* Only the scrim fades: fading an ancestor of the glass panel would switch
              its blur off until the fade ends. */}
          <motion.div
            aria-hidden
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14 }}
            className="absolute inset-0 bg-scrim"
            onMouseDown={() => !busy && onClose()}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            initial={{ y: 12, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 12, scale: 0.98 }}
            transition={m.spring}
            className={`relative flex max-h-[80vh] ${width} flex-col overflow-hidden rounded-2xl glass-strong outline-none`}
          >
            <header className="flex items-start justify-between gap-4 px-5 pt-5 pb-3">
              <div className="min-w-0">
                <h2 className="text-lg font-bold">{title}</h2>
                {subtitle && <p className="mt-1 text-sm text-text-subdued">{subtitle}</p>}
              </div>
              <button
                aria-label="Close"
                disabled={busy}
                onClick={onClose}
                className="rounded-full p-1 text-text-subdued transition-colors duration-[140ms] hover:text-text disabled:opacity-40"
              >
                <X size={18} />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>
            {footer && (
              <footer className="flex items-center justify-end gap-2 border-t border-divider px-5 py-3">
                {footer}
              </footer>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

export function DialogButton({
  primary,
  disabled,
  onClick,
  children
}: {
  primary?: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`rounded-md px-4 py-2 text-sm font-bold transition-colors duration-[140ms] disabled:opacity-40 ${
        primary
          ? 'bg-accent text-on-accent hover:bg-accent-hover'
          : 'text-text-subdued hover:text-text'
      }`}
    >
      {children}
    </button>
  )
}
