import { Download } from 'lucide-react'
import { useState } from 'react'
import type { Track } from '@shared/types'
import { ipcMessage } from '@renderer/state/services'
import { useDownloads } from '@renderer/state/downloads'
import { useUi } from '@renderer/state/ui'

/**
 * "Download all" for SoundCloud albums and profiles. Asks first with the count,
 * because a profile can have hundreds of tracks. `getTracks` may load them on demand.
 */
export default function DownloadAllButton({
  getTracks,
  count
}: {
  getTracks: () => Promise<Track[] | undefined>
  /** Shown in the confirmation when known up front. */
  count?: number
}): React.JSX.Element {
  const [step, setStep] = useState<'idle' | 'loading' | 'confirm' | 'queued'>('idle')
  const [tracks, setTracks] = useState<Track[]>([])
  const [error, setError] = useState<string>()
  const setView = useUi((s) => s.setView)

  const start = async (): Promise<void> => {
    setError(undefined)
    setStep('loading')
    const list = (await getTracks())?.filter((t) => t.provider === 'soundcloud') ?? []
    if (list.length === 0) {
      setError('No SoundCloud tracks to download here.')
      setStep('idle')
      return
    }
    setTracks(list)
    setStep('confirm')
  }

  const confirm = async (): Promise<void> => {
    try {
      await window.api.invoke('downloads:enqueueMany', tracks)
      await useDownloads.getState().refresh()
      setStep('queued')
    } catch (err) {
      setError(ipcMessage(err))
      setStep('idle')
    }
  }

  const pill =
    'flex h-9 items-center gap-2 rounded-full px-4 text-sm font-bold transition-colors duration-[140ms] focus-visible:outline-2 focus-visible:outline-accent'

  if (step === 'confirm') {
    return (
      <span className="flex items-center gap-2" role="group" aria-label="Confirm download all">
        <span className="text-sm text-text">
          Download {tracks.length} {tracks.length === 1 ? 'track' : 'tracks'}?
        </span>
        <button
          onClick={() => void confirm()}
          className={`${pill} bg-accent text-on-accent hover:bg-accent-hover`}
        >
          Download
        </button>
        <button
          onClick={() => setStep('idle')}
          className={`${pill} text-text-subdued hover:text-text`}
        >
          Cancel
        </button>
      </span>
    )
  }
  if (step === 'queued') {
    return (
      <button
        onClick={() => setView('downloads')}
        className={`${pill} bg-raised text-text hover:bg-raised/70`}
      >
        Added {tracks.length} to Downloads
      </button>
    )
  }
  return (
    <span className="flex items-center gap-3">
      <button
        onClick={() => void start()}
        disabled={step === 'loading'}
        className={`${pill} border border-text-muted text-text hover:border-text disabled:opacity-60`}
      >
        <Download size={16} />
        {step === 'loading' ? 'Getting tracks…' : count ? `Download all ${count}` : 'Download all'}
      </button>
      {error && <span className="text-sm text-danger">{error}</span>}
    </span>
  )
}
