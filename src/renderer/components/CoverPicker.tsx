import { ImagePlus } from 'lucide-react'
import { useState } from 'react'
import { ipcMessage } from '@renderer/state/services'
import { usePlaylists } from '@renderer/state/playlists'

/**
 * An app playlist's hero cover that you can click to choose an image. Hover shows
 * "Choose cover"; errors (too big, not an image) show under it.
 */
export default function CoverPicker({
  playlistId,
  children
}: {
  playlistId: string
  children: React.ReactNode
}): React.JSX.Element {
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const pick = async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      const updated = await window.api.invoke('playlists:chooseCover', playlistId)
      if (updated) await usePlaylists.getState().refresh()
    } catch (err) {
      setError(ipcMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="relative size-full">
      <button
        onClick={() => void pick()}
        disabled={busy}
        aria-label="Choose a cover image"
        className="group relative block size-full focus-visible:outline-2 focus-visible:outline-accent"
      >
        {children}
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-base/70 text-sm font-bold opacity-0 transition-opacity duration-[140ms] group-hover:opacity-100 group-focus-visible:opacity-100">
          <ImagePlus size={36} strokeWidth={1.5} />
          {busy ? 'Opening…' : 'Choose cover'}
        </span>
      </button>
      {error && (
        <p
          role="alert"
          className="absolute inset-x-0 -bottom-6 truncate text-xs text-danger"
          title={error}
        >
          {error}
        </p>
      )}
    </div>
  )
}
