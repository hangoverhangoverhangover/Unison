import { Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

/**
 * "Search in this list": a magnifier that opens into a field. Ctrl+F opens it,
 * Escape clears and closes it. Filtering itself is up to the parent.
 */
export default function ListFilter({
  value,
  onChange,
  label
}: {
  value: string
  onChange: (value: string) => void
  /** Accessible name and placeholder, e.g. "Search in Liked Songs". */
  label: string
}): React.JSX.Element {
  const [open, setOpen] = useState(value !== '')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setOpen(true)
        requestAnimationFrame(() => inputRef.current?.focus())
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const close = (): void => {
    onChange('')
    setOpen(false)
  }

  return (
    <div
      className={`flex h-9 items-center rounded-full transition-[width,background-color] duration-[220ms] ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none ${
        open ? 'w-64 bg-raised' : 'w-9'
      }`}
    >
      <button
        aria-label={open ? 'Focus search' : label}
        title={label}
        onClick={() => {
          setOpen(true)
          requestAnimationFrame(() => inputRef.current?.focus())
        }}
        className="flex size-9 flex-none items-center justify-center rounded-full text-text-subdued transition-colors duration-[140ms] hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
      >
        <Search size={18} />
      </button>
      {open && (
        <>
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close()
            }}
            onBlur={() => {
              if (value === '') setOpen(false)
            }}
            placeholder={label}
            aria-label={label}
            className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-muted"
          />
          {value && (
            <button
              aria-label="Clear search"
              onMouseDown={(e) => e.preventDefault()}
              onClick={close}
              className="mr-2 flex size-6 flex-none items-center justify-center rounded-full text-text-subdued hover:text-text"
            >
              <X size={14} />
            </button>
          )}
        </>
      )}
    </div>
  )
}
