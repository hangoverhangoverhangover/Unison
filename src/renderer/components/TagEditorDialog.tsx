import { useEffect, useMemo, useState } from 'react'
import {
  COVER_FORMATS,
  type FilenameTagProposal,
  type PickedCover,
  type TagEdit,
  type TagFileResult
} from '@shared/tags'
import type { Track } from '@shared/types'
import { ipcMessage } from '@renderer/state/services'
import { useTagEditor, type TagDialog } from '@renderer/state/tagEditor'
import Modal, { DialogButton } from './Modal'

type Field = 'title' | 'artist' | 'album' | 'albumArtist' | 'trackNo' | 'year' | 'genre'
const FIELDS: { key: Field; label: string; single?: boolean }[] = [
  { key: 'title', label: 'Title', single: true },
  { key: 'artist', label: 'Artist' },
  { key: 'album', label: 'Album' },
  { key: 'albumArtist', label: 'Album artist' },
  { key: 'trackNo', label: 'Track number', single: true },
  { key: 'year', label: 'Year' },
  { key: 'genre', label: 'Genre' }
]

const inputClass =
  'w-full rounded-lg bg-raised px-3 py-2 text-sm text-text outline-none ring-1 ring-divider placeholder:text-text-muted focus:ring-2 focus:ring-accent'

function summary(results: TagFileResult[]): { ok: number; failed: TagFileResult[] } {
  return { ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok) }
}

function Results({
  results,
  byId
}: {
  results: TagFileResult[]
  byId: Map<string, Track>
}): React.JSX.Element {
  const { ok, failed } = summary(results)
  return (
    <div className="mt-4 rounded-lg bg-raised/50 p-3 text-sm" aria-live="polite">
      <p className="font-bold">
        {ok} {ok === 1 ? 'file' : 'files'} updated
        {failed.length > 0 && `, ${failed.length} failed`}
      </p>
      {failed.length > 0 && (
        <ul className="mt-2 max-h-40 overflow-y-auto">
          {failed.map((r) => (
            <li key={r.trackId} className="py-0.5">
              <span className="text-text">{byId.get(r.trackId)?.title ?? r.trackId}</span>
              <span className="text-danger">: {r.error}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Edit tags of one file (prefilled) or a folder (blank fields stay unchanged). */
function EditForm({ dialog }: { dialog: Extract<TagDialog, { mode: 'edit' }> }): React.JSX.Element {
  const close = useTagEditor((s) => s.close)
  const single = dialog.tracks.length === 1
  const first = dialog.tracks[0]
  const [values, setValues] = useState<Partial<Record<Field, string>>>(() =>
    single && first
      ? {
          title: first.title,
          artist: first.artists.join(', '),
          album: first.album ?? ''
        }
      : {}
  )
  const [clear, setClear] = useState<Partial<Record<Field, boolean>>>({})
  /** Cover change: keep what each file has, use a picked image, or remove it. */
  const [cover, setCover] = useState<'keep' | 'remove' | PickedCover>('keep')
  const coverable = dialog.tracks.every((t) =>
    COVER_FORMATS.some((ext) => t.localPath?.toLowerCase().endsWith(ext))
  )
  const pickCover = async (): Promise<void> => {
    setError(undefined)
    try {
      const picked = await window.api.invoke('tags:pickCover')
      if (picked) setCover(picked)
    } catch (err) {
      setError(ipcMessage(err))
    }
  }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [results, setResults] = useState<TagFileResult[]>()
  const byId = useMemo(() => new Map(dialog.tracks.map((t) => [t.id, t])), [dialog.tracks])

  const buildEdit = (): TagEdit => {
    const edit: TagEdit = {}
    for (const f of FIELDS) {
      if (!single && f.single) continue
      const v = values[f.key]?.trim() ?? ''
      if (clear[f.key]) {
        if (f.key === 'trackNo') edit.trackNo = null
        else edit[f.key] = ''
        continue
      }
      // Single file: send what changed. Several files: send only what was filled in.
      const before =
        single && first
          ? f.key === 'title'
            ? first.title
            : f.key === 'artist'
              ? first.artists.join(', ')
              : f.key === 'album'
                ? (first.album ?? '')
                : ''
          : ''
      if (v === '' || v === before) continue
      if (f.key === 'trackNo') edit.trackNo = Number(v)
      else edit[f.key] = v
    }
    if (cover === 'remove') edit.cover = null
    else if (cover !== 'keep') edit.cover = cover.token
    return edit
  }

  const save = async (): Promise<void> => {
    const edit = buildEdit()
    if (Object.keys(edit).length === 0) {
      setError('Nothing to change.')
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      setResults(
        await window.api.invoke(
          'tags:edit',
          dialog.tracks.map((t) => t.id),
          edit
        )
      )
    } catch (err) {
      setError(ipcMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      busy={busy}
      onClose={close}
      title={single ? 'Edit tags' : `Edit tags for ${dialog.tracks.length} files`}
      subtitle={
        single
          ? first?.localPath
          : `${dialog.folder ?? ''}. Fields you leave blank stay as they are in each file.`
      }
      width="w-[min(560px,90vw)]"
      footer={
        results ? (
          <DialogButton primary onClick={close}>
            Done
          </DialogButton>
        ) : (
          <>
            <DialogButton onClick={close} disabled={busy}>
              Cancel
            </DialogButton>
            <DialogButton primary onClick={() => void save()} disabled={busy}>
              {busy ? 'Saving…' : 'Save to files'}
            </DialogButton>
          </>
        )
      }
    >
      <div className="grid grid-cols-[8rem_1fr_auto] items-center gap-x-3 gap-y-2">
        {FIELDS.filter((f) => single || !f.single).map((f) => (
          <div key={f.key} className="contents">
            <label htmlFor={`tag-${f.key}`} className="text-sm text-text-subdued">
              {f.label}
            </label>
            <input
              id={`tag-${f.key}`}
              value={values[f.key] ?? ''}
              disabled={busy || !!results || !!clear[f.key]}
              inputMode={f.key === 'trackNo' ? 'numeric' : undefined}
              placeholder={f.key === 'year' ? 'YYYY' : single ? '' : 'Unchanged'}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              className={`${inputClass} disabled:opacity-50`}
            />
            <label className="flex items-center gap-1.5 text-xs text-text-subdued">
              <input
                type="checkbox"
                checked={!!clear[f.key]}
                disabled={busy || !!results}
                onChange={(e) => setClear((c) => ({ ...c, [f.key]: e.target.checked }))}
                className="accent-[var(--color-accent)]"
              />
              Clear
            </label>
          </div>
        ))}
      </div>
      <section className="mt-5 border-t border-divider pt-4">
        <p className="text-sm font-bold">Cover art</p>
        {coverable ? (
          <div className="mt-3 flex items-center gap-4">
            <span className="size-20 flex-none overflow-hidden rounded-md bg-raised">
              {cover !== 'keep' && cover !== 'remove' && cover.previewUrl ? (
                <img src={cover.previewUrl} alt="" className="size-full object-cover" />
              ) : cover === 'keep' && single && first?.artworkUrl ? (
                <img src={first.artworkUrl} alt="" className="size-full object-cover" />
              ) : null}
            </span>
            <div className="min-w-0 text-sm">
              <p className="truncate text-text-subdued">
                {cover === 'keep'
                  ? single
                    ? 'Current cover is kept.'
                    : "Each file's cover is kept."
                  : cover === 'remove'
                    ? 'The embedded cover will be removed.'
                    : `New cover: ${cover.name}`}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  disabled={busy || !!results}
                  onClick={() => void pickCover()}
                  className="rounded-full px-3 py-1 font-bold text-text ring-1 ring-text-muted hover:ring-text disabled:opacity-40"
                >
                  Choose image…
                </button>
                {cover !== 'remove' && (
                  <button
                    disabled={busy || !!results}
                    onClick={() => setCover('remove')}
                    className="rounded-full px-3 py-1 font-bold text-text-subdued hover:text-text disabled:opacity-40"
                  >
                    Remove cover
                  </button>
                )}
                {cover !== 'keep' && (
                  <button
                    disabled={busy || !!results}
                    onClick={() => setCover('keep')}
                    className="rounded-full px-3 py-1 font-bold text-text-subdued hover:text-text disabled:opacity-40"
                  >
                    Keep current
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <p className="mt-1 text-sm text-text-subdued">
            Cover art can be changed for MP3, M4A, MP4 and FLAC files
            {single ? '; this file type can’t hold one.' : '; some of these files can’t hold one.'}
          </p>
        )}
      </section>
      <p className="mt-4 text-xs text-text-subdued">
        This rewrites the files on disk. Audio and cover art are kept.
      </p>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      {results && <Results results={results} byId={byId} />}
    </Modal>
  )
}

/** Preview "Artist - Title" from file names, untick any that look wrong, then write. */
function FilenameForm({
  dialog
}: {
  dialog: Extract<TagDialog, { mode: 'filenames' }>
}): React.JSX.Element {
  const close = useTagEditor((s) => s.close)
  const [proposals, setProposals] = useState<FilenameTagProposal[]>()
  const [keep, setKeep] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [results, setResults] = useState<TagFileResult[]>()
  const byId = useMemo(() => new Map(dialog.tracks.map((t) => [t.id, t])), [dialog.tracks])

  useEffect(() => {
    let cancelled = false
    window.api
      .invoke(
        'tags:proposeFromFilenames',
        dialog.tracks.map((t) => t.id)
      )
      .then(
        (list) => {
          if (cancelled) return
          setProposals(list)
          setKeep(new Set(list.filter((p) => !p.skipped).map((p) => p.trackId)))
        },
        (err: unknown) => !cancelled && setError(ipcMessage(err))
      )
    return () => {
      cancelled = true
    }
  }, [dialog.tracks])

  const usable = proposals?.filter((p) => !p.skipped) ?? []
  const skipped = (proposals?.length ?? 0) - usable.length

  const apply = async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      setResults(
        await window.api.invoke(
          'tags:applyProposals',
          usable.filter((p) => keep.has(p.trackId))
        )
      )
    } catch (err) {
      setError(ipcMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      busy={busy}
      onClose={close}
      title="Fill tags from file names"
      subtitle={
        proposals
          ? `${usable.length} of ${proposals.length} files are named "Artist - Title".${skipped ? ` ${skipped} have no " - " and are left alone.` : ''} Untick any that look wrong.`
          : 'Reading file names…'
      }
      footer={
        results ? (
          <DialogButton primary onClick={close}>
            Done
          </DialogButton>
        ) : (
          <>
            <DialogButton onClick={close} disabled={busy}>
              Cancel
            </DialogButton>
            <DialogButton primary onClick={() => void apply()} disabled={busy || keep.size === 0}>
              {busy
                ? 'Writing…'
                : `Write tags to ${keep.size} ${keep.size === 1 ? 'file' : 'files'}`}
            </DialogButton>
          </>
        )
      }
    >
      {usable.length > 0 && !results && (
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-base/95 text-text-subdued">
            <tr>
              <th className="w-8 py-2">
                <input
                  type="checkbox"
                  aria-label="Select all"
                  checked={keep.size === usable.length}
                  onChange={(e) =>
                    setKeep(e.target.checked ? new Set(usable.map((p) => p.trackId)) : new Set())
                  }
                  className="accent-[var(--color-accent)]"
                />
              </th>
              <th className="py-2 font-normal">Artist</th>
              <th className="py-2 font-normal">Title</th>
            </tr>
          </thead>
          <tbody>
            {usable.map((p) => (
              <tr key={p.trackId} className="border-t border-divider" title={p.fileName}>
                <td className="py-2">
                  <input
                    type="checkbox"
                    aria-label={`Use ${p.fileName}`}
                    checked={keep.has(p.trackId)}
                    onChange={(e) =>
                      setKeep((k) => {
                        const next = new Set(k)
                        if (e.target.checked) next.add(p.trackId)
                        else next.delete(p.trackId)
                        return next
                      })
                    }
                    className="accent-[var(--color-accent)]"
                  />
                </td>
                <td className="max-w-0 truncate py-2 pr-3 font-bold">{p.artist}</td>
                <td className="max-w-0 truncate py-2">{p.title}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {proposals && usable.length === 0 && (
        <p className="py-4 text-sm text-text-subdued">
          None of these files are named &quot;Artist - Title&quot;.
        </p>
      )}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      {results && <Results results={results} byId={byId} />}
    </Modal>
  )
}

/** Mounted once in App; shows whichever tag dialog is open. */
export default function TagEditorDialog(): React.JSX.Element | null {
  const open = useTagEditor((s) => s.open)
  if (!open) return null
  return open.mode === 'edit' ? (
    <EditForm key={open.tracks.map((t) => t.id).join('|')} dialog={open} />
  ) : (
    <FilenameForm key="filenames" dialog={open} />
  )
}
