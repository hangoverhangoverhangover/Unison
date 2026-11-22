import { useState } from 'react'
import type { TitleOverride } from '@shared/scTitle'
import { playback } from '@renderer/playback/controller'
import { ipcMessage } from '@renderer/state/services'
import { useTitleFix } from '@renderer/state/titleFix'
import Modal, { DialogButton } from './Modal'

const field =
  'w-full rounded-lg bg-raised px-3 py-2 text-sm text-text outline-none ring-1 ring-divider placeholder:text-text-muted focus:ring-2 focus:ring-accent'

/**
 * Fix a SoundCloud song's artist and title, or keep it as uploaded. Saved on this
 * computer; wins over the automatic tidy-up. Updates the queue at once; lists show it
 * the next time they load.
 */
export default function TitleFixDialog(): React.JSX.Element {
  const track = useTitleFix((s) => s.track)
  const close = useTitleFix((s) => s.close)
  const [forId, setForId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [artists, setArtists] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fill the fields each time it opens for a track.
  if ((track?.id ?? null) !== forId) {
    setForId(track?.id ?? null)
    setTitle(track?.title ?? '')
    setArtists(track?.artists.join(', ') ?? '')
    setError(null)
  }

  const save = async (value: TitleOverride | 'original' | null): Promise<void> => {
    if (!track) return
    setBusy(true)
    try {
      await window.api.invoke('titles:setOverride', track.id, value)
      const original = {
        title: track.originalTitle ?? track.title,
        artists: track.originalArtist ? [track.originalArtist] : track.artists
      }
      playback.updateTrack(
        track.id,
        value && value !== 'original'
          ? {
              ...value,
              titleGuess: 'user',
              titleNote: 'Fixed by you',
              originalTitle: original.title
            }
          : { ...original, titleGuess: undefined, titleNote: undefined }
      )
      close()
    } catch (err) {
      setError(ipcMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const parsed: TitleOverride = {
    title: title.trim(),
    artists: artists
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean)
  }
  const uploaded = track?.originalTitle ?? track?.title

  return (
    <Modal
      open={!!track}
      onClose={close}
      busy={busy}
      title="Fix artist and title"
      subtitle={track?.uploader ? `Uploaded by ${track.uploader}` : undefined}
      footer={
        <>
          {track?.titleGuess === 'user' ? (
            <span className="mr-auto">
              <DialogButton onClick={() => void save(null)}>Undo my fix</DialogButton>
            </span>
          ) : (
            track?.originalTitle && (
              <span className="mr-auto">
                <DialogButton onClick={() => void save('original')}>Keep as uploaded</DialogButton>
              </span>
            )
          )}
          <DialogButton onClick={close}>Cancel</DialogButton>
          <DialogButton
            primary
            disabled={busy || !parsed.title || parsed.artists.length === 0}
            onClick={() => void save(parsed)}
          >
            Save
          </DialogButton>
        </>
      }
    >
      {uploaded && (
        <p className="mb-4 text-sm text-text-subdued">
          Uploaded as <span className="font-semibold text-text">{uploaded}</span>
          {track?.titleNote && track.titleGuess !== 'user' && (
            <span className="block text-xs text-text-muted">Tidied: {track.titleNote}</span>
          )}
        </p>
      )}
      <label className="mb-1 block text-sm font-semibold text-text-subdued">Title</label>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className={field}
        aria-label="Title"
      />
      <label className="mt-3 mb-1 block text-sm font-semibold text-text-subdued">
        Artists <span className="font-normal text-text-muted">(separate with commas)</span>
      </label>
      <input
        value={artists}
        onChange={(e) => setArtists(e.target.value)}
        className={field}
        aria-label="Artists"
      />
      <p className="mt-3 text-xs text-text-muted">
        Saved on this computer and used for scrobbles too. Lists show it the next time they load.
      </p>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </Modal>
  )
}
