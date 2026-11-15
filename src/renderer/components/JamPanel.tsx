import { ArrowDown, ArrowUp, Copy, Crown, Play, Trash2, Users, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AppPrefs } from '@shared/config'
import type { JamEntry, JamParticipant } from '@shared/jam'
import { useJam } from '@renderer/state/jam'
import { useUi } from '@renderer/state/ui'
import Artwork from './Artwork'
import SourceBadge from './SourceBadge'

const pill =
  'rounded-full px-3 py-1.5 text-sm font-bold transition-colors duration-[140ms] disabled:opacity-40'

/** Not in a Jam: start one or join with a code. */
function Lobby(): React.JSX.Element {
  const start = useJam((s) => s.start)
  const join = useJam((s) => s.join)
  const busy = useJam((s) => s.busy)
  const error = useJam((s) => s.actionError ?? s.status.error ?? null)
  const setView = useUi((s) => s.setView)
  const [prefs, setPrefs] = useState<AppPrefs | null>(null)
  const [code, setCode] = useState('')
  useEffect(() => {
    void window.api.invoke('prefs:get').then(setPrefs)
    return window.api.on('prefs:changed', setPrefs)
  }, [])
  const [builtIn, setBuiltIn] = useState('')
  useEffect(() => {
    void window.api.invoke('config:getPublic').then((c) => setBuiltIn(c.defaultJamRelayUrl))
  }, [])
  const ready = !!(prefs?.jamRelayUrl || builtIn)

  return (
    <div className="flex flex-col gap-5 px-4 pb-4">
      <p className="text-sm text-text-subdued">
        Listen together. Everyone hears the same song at the same moment, each on their own Spotify
        and SoundCloud. Anyone can add songs; the host controls playback.
      </p>
      {!ready && (
        <div className="rounded-lg bg-raised/50 p-3 text-sm">
          <p>Add your relay URL first.</p>
          <button
            onClick={() => setView('settings')}
            className="mt-2 font-bold text-accent hover:text-accent-hover"
          >
            Open Settings → Jam
          </button>
        </div>
      )}
      <section>
        <h3 className="font-bold">Start a Jam</h3>
        <p className="mt-1 text-sm text-text-subdued">
          You&apos;ll get a code to share{prefs?.jamName ? ` as ${prefs.jamName}` : ''}.
        </p>
        <button
          disabled={!ready || busy}
          onClick={() => void start()}
          className={`${pill} mt-3 bg-accent text-on-accent hover:bg-accent-hover`}
        >
          {busy ? 'Starting…' : 'Start a Jam'}
        </button>
      </section>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (code.trim()) void join(code)
        }}
      >
        <h3 className="font-bold">Join a Jam</h3>
        <div className="mt-3 flex gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="Code"
            maxLength={12}
            aria-label="Jam code"
            className="w-32 rounded-lg bg-raised px-3 py-1.5 font-mono text-sm tracking-widest text-text uppercase outline-none ring-1 ring-divider focus:ring-2 focus:ring-accent"
          />
          <button
            type="submit"
            disabled={!ready || busy || !code.trim()}
            className={`${pill} text-text ring-1 ring-text-muted hover:ring-text`}
          >
            Join
          </button>
        </div>
      </form>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  )
}

function Person({ p, you }: { p: JamParticipant; you: boolean }): React.JSX.Element {
  return (
    <li className="flex items-center gap-2 py-1 text-sm">
      <span className="flex size-7 flex-none items-center justify-center rounded-full bg-raised font-bold uppercase">
        {p.name.slice(0, 1) || '?'}
      </span>
      <span className="min-w-0 flex-1 truncate">
        {p.name}
        {you && <span className="text-text-subdued"> (you)</span>}
      </span>
      {p.isHost && <Crown size={14} className="text-accent" aria-label="Host" />}
      <span className="flex gap-0.5" aria-label="Can play">
        {p.canPlay.spotify && <SourceBadge provider="spotify" />}
        {p.canPlay.soundcloud && <SourceBadge provider="soundcloud" />}
      </span>
    </li>
  )
}

function Entry({
  e,
  index,
  current,
  isHost,
  addedBy,
  last
}: {
  e: JamEntry
  index: number
  current: boolean
  isHost: boolean
  addedBy: string
  last: boolean
}): React.JSX.Element {
  const send = useJam((s) => s.send)
  return (
    <li
      className={`group flex items-center gap-2 rounded-lg px-2 py-1.5 ${current ? 'bg-raised' : 'hover:bg-raised/50'}`}
    >
      <Artwork src={e.track.artworkUrl} size={36} />
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-sm ${current ? 'text-accent' : 'text-text'}`}>
          {e.track.title}
        </span>
        <span className="flex items-center gap-1 text-xs text-text-subdued">
          <SourceBadge provider={e.track.provider} />
          <span className="truncate">
            {e.track.artists.join(', ') || 'Unknown artist'}, added by {addedBy}
          </span>
        </span>
      </span>
      {isHost && (
        <span className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          {!current && (
            <IconBtn label="Play now" onClick={() => void send({ type: 'play', index })}>
              <Play size={14} />
            </IconBtn>
          )}
          {index > 0 && (
            <IconBtn
              label="Move up"
              onClick={() => void send({ type: 'move', entryId: e.entryId, toIndex: index - 1 })}
            >
              <ArrowUp size={14} />
            </IconBtn>
          )}
          {!last && (
            <IconBtn
              label="Move down"
              onClick={() => void send({ type: 'move', entryId: e.entryId, toIndex: index + 1 })}
            >
              <ArrowDown size={14} />
            </IconBtn>
          )}
          <IconBtn label="Remove" onClick={() => void send({ type: 'remove', entryId: e.entryId })}>
            <Trash2 size={14} />
          </IconBtn>
        </span>
      )}
    </li>
  )
}

function IconBtn({
  label,
  onClick,
  children
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex size-7 items-center justify-center rounded-full text-text-subdued hover:bg-raised hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
    >
      {children}
    </button>
  )
}

/** In a Jam: code, people, notices, the shared queue. */
function Room(): React.JSX.Element {
  const status = useJam((s) => s.status)
  const leave = useJam((s) => s.leave)
  const notice = useJam((s) => s.notice)
  const clearNotice = useJam((s) => s.clearNotice)
  const substitute = useJam((s) => s.substitute)
  const skipped = useJam((s) => s.skipped)
  const actionError = useJam((s) => s.actionError)
  const [copied, setCopied] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const room = status.room
  const isHost = status.role === 'host'
  if (!room) return <p className="px-4 text-sm text-text-subdued">Connecting…</p>
  const names = new Map(room.participants.map((p) => [p.id, p.name]))
  const current = room.queue[room.currentIndex]

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 page-fade pb-page">
      <div className="rounded-lg bg-raised/50 p-3">
        <p className="text-xs text-text-subdued">Jam code</p>
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-2xl font-black tracking-[0.2em]">{room.code}</span>
          <button
            onClick={() => {
              void navigator.clipboard.writeText(room.code).then(() => setCopied(true))
            }}
            className="flex items-center gap-1 text-sm font-bold text-text-subdued hover:text-text"
          >
            <Copy size={14} /> {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        {status.state === 'reconnecting' && (
          <p className="mt-1 text-xs text-danger">Reconnecting…</p>
        )}
      </div>

      {(notice || actionError) && (
        <p className="mt-3 flex items-start justify-between gap-2 text-sm text-danger">
          {notice ?? actionError}
          {notice && (
            <button aria-label="Dismiss" onClick={clearNotice}>
              <X size={14} />
            </button>
          )}
        </p>
      )}
      {current && substitute?.entryId === current.entryId && (
        <p className="mt-3 rounded-lg bg-raised/50 p-2 text-xs text-text-subdued">
          You&apos;re hearing the{' '}
          {substitute.track.provider === 'spotify' ? 'Spotify' : 'SoundCloud'} version:{' '}
          {substitute.track.title}. {substitute.reason}
        </p>
      )}
      {current && skipped?.entryId === current.entryId && (
        <p className="mt-3 rounded-lg bg-raised/50 p-2 text-xs text-text-subdued">
          Skipped for you: {skipped.reason}
        </p>
      )}

      <h3 className="mt-4 flex items-center gap-2 text-sm font-bold">
        <Users size={14} /> {room.participants.length} listening
      </h3>
      <ul className="mt-1">
        {room.participants.map((p) => (
          <Person key={p.id} p={p} you={p.id === status.you} />
        ))}
      </ul>

      <h3 className="mt-4 text-sm font-bold">Queue</h3>
      {room.queue.length === 0 ? (
        <p className="mt-1 text-sm text-text-subdued">
          Empty. Right-click a song and choose Add to queue, or press play on any track: it&apos;s
          added here for everyone.
        </p>
      ) : (
        <ul className="mt-1 flex flex-col">
          {room.queue.map((e, i) => (
            <Entry
              key={e.entryId}
              e={e}
              index={i}
              current={i === room.currentIndex}
              isHost={isHost}
              addedBy={names.get(e.addedBy) ?? 'someone who left'}
              last={i === room.queue.length - 1}
            />
          ))}
        </ul>
      )}
      {isHost && room.currentIndex < 0 && room.queue.length > 0 && (
        <button
          onClick={() => void useJam.getState().send({ type: 'play', index: 0 })}
          className={`${pill} mt-3 bg-accent text-on-accent hover:bg-accent-hover`}
        >
          Start playing
        </button>
      )}

      <div className="mt-6 border-t border-divider pt-3">
        {confirmLeave ? (
          <span className="flex flex-wrap items-center gap-2 text-sm">
            {isHost ? 'End the Jam for everyone?' : 'Leave the Jam?'}
            <button
              onClick={() => void leave()}
              className={`${pill} bg-danger text-text hover:opacity-90`}
            >
              {isHost ? 'End Jam' : 'Leave'}
            </button>
            <button
              onClick={() => setConfirmLeave(false)}
              className={`${pill} text-text-subdued hover:text-text`}
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            onClick={() => setConfirmLeave(true)}
            className={`${pill} text-text-subdued ring-1 ring-text-muted hover:text-text hover:ring-text`}
          >
            {isHost ? 'End Jam' : 'Leave Jam'}
          </button>
        )}
      </div>
    </div>
  )
}

/** Jam tab of the right panel. */
export default function JamPanel(): React.JSX.Element {
  const state = useJam((s) => s.status.state)
  const role = useJam((s) => s.status.role)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {state !== 'off' && (
        <p className="px-4 pb-1 text-sm text-text-subdued">
          {role === 'host' ? 'You’re the host' : 'You’re a guest'}
        </p>
      )}
      {state === 'off' ? <Lobby /> : <Room />}
    </div>
  )
}
