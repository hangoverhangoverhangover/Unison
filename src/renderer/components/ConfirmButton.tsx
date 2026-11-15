import { useState } from 'react'
import { ipcMessage } from '@renderer/state/services'

/**
 * A button for public actions (follow, repost): the first click asks, the second does it.
 * Shows the error inline when the action fails.
 */
export default function ConfirmButton({
  label,
  question,
  confirmLabel,
  active,
  onConfirm,
  icon
}: {
  /** Button text now ("Follow" / "Following"). */
  label: string
  /** Shown before acting, e.g. "Follow hi-c on SoundCloud? People can see who you follow." */
  question: string
  confirmLabel: string
  /** Pressed look (already following / reposted). */
  active?: boolean
  onConfirm: () => Promise<void>
  icon?: React.ReactNode
}): React.JSX.Element {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const run = async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      await onConfirm()
      setAsking(false)
    } catch (err) {
      setError(ipcMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const pill =
    'flex h-9 items-center gap-2 rounded-full px-4 text-sm font-bold transition-colors duration-[140ms] focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60'

  if (asking) {
    return (
      <span className="flex flex-wrap items-center gap-2" role="group" aria-label={question}>
        <span className="text-sm text-text">{question}</span>
        <button
          disabled={busy}
          onClick={() => void run()}
          className={`${pill} bg-accent text-on-accent hover:bg-accent-hover`}
        >
          {busy ? 'Working…' : confirmLabel}
        </button>
        <button
          disabled={busy}
          onClick={() => setAsking(false)}
          className={`${pill} text-text-subdued hover:text-text`}
        >
          Cancel
        </button>
        {error && <span className="text-sm text-danger">{error}</span>}
      </span>
    )
  }
  return (
    <button
      onClick={() => setAsking(true)}
      aria-pressed={active}
      className={`${pill} ${active ? 'bg-raised text-text ring-1 ring-text-muted' : 'text-text ring-1 ring-text-muted hover:ring-text'}`}
    >
      {icon}
      {label}
    </button>
  )
}
