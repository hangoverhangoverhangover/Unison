import { useEffect, useMemo, useState } from 'react'
import type { MatchConfidence, TransferPlan } from '@shared/transfer'
import type { Track } from '@shared/types'
import { SERVICE_NAME } from '@renderer/lib/services'
import { ipcMessage } from '@renderer/state/services'
import { useUi } from '@renderer/state/ui'
import { useTransfer } from '@renderer/state/transfer'
import Artwork from './Artwork'
import Modal, { DialogButton } from './Modal'
import SourceBadge from './SourceBadge'

const CONFIDENCE: Record<MatchConfidence, { label: string; className: string }> = {
  isrc: { label: 'Same recording', className: 'bg-accent/20 text-accent' },
  exact: { label: 'Same artist and title', className: 'bg-accent/10 text-text' },
  close: { label: 'Close match, check it', className: 'bg-raised text-text-subdued' }
}

/** Index of the chosen match per source row, or -1 to skip it. */
type Choices = number[]

function initialChoices(plan: TransferPlan): Choices {
  // Same recording or exact artist + title: ticked. Close: the user opts in.
  return plan.candidates.map((c) => (c.matches[0] && c.matches[0].confidence !== 'close' ? 0 : -1))
}

function TrackLine({ track }: { track: Track }): React.JSX.Element {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Artwork src={track.artworkUrl} size={32} />
      <span className="min-w-0">
        <span className="block truncate text-sm text-text">{track.title}</span>
        <span className="flex items-center gap-1 text-xs text-text-subdued">
          <SourceBadge provider={track.provider} />
          <span className="truncate">{track.artists.join(', ') || 'Unknown artist'}</span>
        </span>
      </span>
    </span>
  )
}

/** Copy a playlist to the other service: match, review every match, then create. */
/** Mounted once in App: one fresh session per opened dialog. */
export default function TransferDialog(): React.JSX.Element | null {
  const open = useTransfer((s) => s.open)
  if (!open) return null
  return <TransferSession key={`${open.playlistId}>${open.target}`} open={open} />
}

function TransferSession({
  open
}: {
  open: NonNullable<ReturnType<typeof useTransfer.getState>['open']>
}): React.JSX.Element {
  const close = useTransfer((s) => s.close)
  const setView = useUi((s) => s.setView)
  const [plan, setPlan] = useState<TransferPlan>()
  const [progress, setProgress] = useState<{ done: number; total: number }>()
  const [choices, setChoices] = useState<Choices>([])
  const [name, setName] = useState(`${open.name} (copy)`)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [created, setCreated] = useState<{ id: string; added: number }>()

  useEffect(() => {
    let cancelled = false
    const off = window.api.on('transfer:progress', (p) => !cancelled && setProgress(p))
    window.api.invoke('transfer:plan', open.playlistId, open.target).then(
      (p) => {
        if (cancelled) return
        setPlan(p)
        setChoices(initialChoices(p))
      },
      (err: unknown) => !cancelled && setError(ipcMessage(err))
    )
    return () => {
      cancelled = true
      off()
    }
  }, [open])

  const chosen = useMemo(
    () =>
      plan
        ? plan.candidates
            .map((c, i) => (choices[i]! >= 0 ? c.matches[choices[i]!]?.track : undefined))
            .filter((t): t is Track => !!t)
        : [],
    [plan, choices]
  )

  const target = SERVICE_NAME[open.target]

  const create = async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      const r = await window.api.invoke('transfer:create', {
        target: open.target,
        name: name.trim(),
        tracks: chosen
      })
      setCreated({ id: r.playlistId, added: r.added })
    } catch (err) {
      setError(ipcMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const counts = plan
    ? {
        found: plan.candidates.filter((c) => c.matches.length > 0).length,
        none: plan.candidates.filter((c) => c.matches.length === 0).length
      }
    : undefined

  return (
    <Modal
      open
      busy={busy}
      onClose={close}
      title={`Copy to ${target}`}
      subtitle={
        created
          ? undefined
          : plan
            ? `Found ${counts!.found} of ${plan.candidates.length} tracks on ${target}${counts!.none ? `; ${counts!.none} not found` : ''}. Check each match before creating the playlist.`
            : `Looking for each track on ${target}…`
      }
      width="w-[min(880px,94vw)]"
      footer={
        created ? (
          <>
            <DialogButton onClick={close}>Close</DialogButton>
            <DialogButton
              primary
              onClick={() => {
                close()
                setView(`playlist:${created.id}`)
              }}
            >
              Open playlist
            </DialogButton>
          </>
        ) : (
          <>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              aria-label="New playlist name"
              disabled={!plan || busy}
              className="mr-auto w-72 rounded-lg bg-raised px-3 py-2 text-sm text-text outline-none ring-1 ring-divider focus:ring-2 focus:ring-accent"
            />
            <DialogButton onClick={close} disabled={busy}>
              Cancel
            </DialogButton>
            <DialogButton
              primary
              disabled={!plan || busy || chosen.length === 0 || !name.trim()}
              onClick={() => void create()}
            >
              {busy ? 'Creating…' : `Create playlist with ${chosen.length} tracks`}
            </DialogButton>
          </>
        )
      }
    >
      {created ? (
        <p className="py-4">
          Created &quot;{name.trim()}&quot; on {target} with {created.added}{' '}
          {created.added === 1 ? 'track' : 'tracks'}. It&apos;s private.
        </p>
      ) : !plan ? (
        <div className="py-6" aria-live="polite">
          {error ? (
            <p className="text-sm text-danger">{error}</p>
          ) : (
            <>
              <div className="h-1.5 overflow-hidden rounded-full bg-progress-track">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-300"
                  style={{
                    width: progress
                      ? `${(progress.done / Math.max(1, progress.total)) * 100}%`
                      : '4%'
                  }}
                />
              </div>
              <p className="mt-2 text-sm text-text-subdued tabular-nums">
                {progress ? `${progress.done} of ${progress.total}` : 'Starting…'}
              </p>
            </>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-divider">
          {plan.candidates.map((c, i) => (
            <li
              key={`${i}:${c.source.id}`}
              className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-4 py-2"
            >
              <TrackLine track={c.source} />
              {c.matches.length === 0 ? (
                <span className="self-center text-sm text-text-muted">Not found on {target}</span>
              ) : (
                <fieldset className="flex min-w-0 flex-col gap-1">
                  <legend className="sr-only">Match for {c.source.title}</legend>
                  {c.matches.map((mt, j) => (
                    <label
                      key={mt.track.id}
                      className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 ${choices[i] === j ? 'bg-raised' : 'hover:bg-raised/50'}`}
                    >
                      <input
                        type="radio"
                        name={`m-${i}`}
                        checked={choices[i] === j}
                        onChange={() => setChoices((ch) => ch.map((v, k) => (k === i ? j : v)))}
                        className="accent-[var(--color-accent)]"
                      />
                      <TrackLine track={mt.track} />
                      <span
                        className={`ml-auto flex-none rounded-full px-2 py-0.5 text-xs ${CONFIDENCE[mt.confidence].className}`}
                      >
                        {CONFIDENCE[mt.confidence].label}
                      </span>
                    </label>
                  ))}
                  <label
                    className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm text-text-subdued ${choices[i] === -1 ? 'bg-raised' : 'hover:bg-raised/50'}`}
                  >
                    <input
                      type="radio"
                      name={`m-${i}`}
                      checked={choices[i] === -1}
                      onChange={() => setChoices((ch) => ch.map((v, k) => (k === i ? -1 : v)))}
                      className="accent-[var(--color-accent)]"
                    />
                    Skip this track
                  </label>
                </fieldset>
              )}
            </li>
          ))}
        </ul>
      )}
      {plan && error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </Modal>
  )
}
