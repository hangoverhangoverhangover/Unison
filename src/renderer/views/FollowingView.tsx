import { BadgeCheck, UserRound } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { ServiceProvider } from '@shared/ipc'
import type { Artist } from '@shared/types'
import { fold } from '@renderer/lib/filter'
import { SERVICE_NAME } from '@renderer/lib/services'
import { ipcMessage, useSoundCloud, useSpotify } from '@renderer/state/services'
import { useUi } from '@renderer/state/ui'
import { GhostButton, Message } from '@renderer/components/CollectionView'
import ListFilter from '@renderer/components/ListFilter'
import SourceBadge from '@renderer/components/SourceBadge'
import ActivePill from '@renderer/components/ActivePill'

type Filter = 'all' | ServiceProvider
type Load =
  { state: 'loading' } | { state: 'ok'; data: Artist[] } | { state: 'error'; error: string }

const CHANNEL = {
  spotify: 'spotify:getFollowings',
  soundcloud: 'soundcloud:getFollowings'
} as const

/** Load one service's follows while it's connected; nothing while it isn't. */
function useFollowings(provider: ServiceProvider, connected: boolean): Load | undefined {
  const [load, setLoad] = useState<{ key: boolean; value: Load }>()
  useEffect(() => {
    if (!connected) return
    let cancelled = false
    window.api.invoke(CHANNEL[provider]).then(
      (data) => !cancelled && setLoad({ key: true, value: { state: 'ok', data } }),
      (err: unknown) =>
        !cancelled && setLoad({ key: true, value: { state: 'error', error: ipcMessage(err) } })
    )
    return () => {
      cancelled = true
    }
  }, [provider, connected])
  if (!connected) return undefined
  return load?.value ?? { state: 'loading' }
}

/** People you follow: Spotify artists and SoundCloud profiles, like Liked Songs' filters. */
export default function FollowingView(): React.JSX.Element {
  const spotifyOn = useSpotify((s) => s.status?.state === 'connected')
  const scOn = useSoundCloud((s) => s.status?.state === 'connected')
  const setView = useUi((s) => s.setView)
  const spotify = useFollowings('spotify', spotifyOn)
  const soundcloud = useFollowings('soundcloud', scOn)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')

  const loads: [ServiceProvider, Load | undefined][] = [
    ['spotify', spotify],
    ['soundcloud', soundcloud]
  ]
  const all = useMemo(() => {
    // Interleave alphabetically across services so "All" reads as one list.
    const list = [
      ...(spotify?.state === 'ok' ? spotify.data : []),
      ...(soundcloud?.state === 'ok' ? soundcloud.data : [])
    ]
    return list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  }, [spotify, soundcloud])
  const shown = useMemo(() => {
    const words = fold(query).split(' ').filter(Boolean)
    return all.filter(
      (a) =>
        (filter === 'all' || a.provider === filter) && words.every((w) => fold(a.name).includes(w))
    )
  }, [all, filter, query])

  const loading = loads.some(([, l]) => l?.state === 'loading')
  const errors = loads.filter(
    (e): e is [ServiceProvider, { state: 'error'; error: string }] => e[1]?.state === 'error'
  )
  const count = (p: ServiceProvider): number => all.filter((a) => a.provider === p).length

  return (
    <div className="relative h-full overflow-y-auto page-fade pb-page px-4 pt-8">
      <header className="flex flex-wrap items-end justify-between gap-4 px-2 pt-4">
        <div>
          <h1 className="text-[32px] leading-10 font-black">Following</h1>
          <p className="mt-1 text-sm text-text-subdued">
            Artists you follow on Spotify and people you follow on SoundCloud.
          </p>
        </div>
        {all.length > 0 && <ListFilter value={query} onChange={setQuery} label="Search people" />}
      </header>

      <div role="radiogroup" aria-label="Show follows from" className="mt-4 flex gap-2 px-2">
        {(['all', 'spotify', 'soundcloud'] as const).map((f) => (
          <button
            key={f}
            role="radio"
            aria-checked={filter === f}
            onClick={() => setFilter(f)}
            className={`relative isolate flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-bold transition-colors duration-[140ms] ${
              filter === f ? 'text-base' : 'bg-raised text-text-subdued hover:text-text'
            }`}
          >
            {filter === f && <ActivePill layoutId="following-filter" />}
            {f !== 'all' && <SourceBadge provider={f} />}
            {f === 'all' ? 'All' : SERVICE_NAME[f]}
            {f !== 'all' && count(f) > 0 && (
              <span className="text-xs opacity-70 tabular-nums">{count(f)}</span>
            )}
          </button>
        ))}
      </div>

      {errors.map(([p, e]) => (
        <p key={p} className="mt-3 flex flex-wrap items-center gap-2 px-2 text-sm text-danger">
          <SourceBadge provider={p} />
          {e.error}
          {/log in again/i.test(e.error) && (
            <button
              onClick={() => setView('settings')}
              className="font-bold text-text-subdued underline-offset-2 hover:text-text hover:underline"
            >
              Open Settings
            </button>
          )}
        </p>
      ))}

      {!spotifyOn && !scOn ? (
        <Message
          title="Connect a service"
          body="Log in to Spotify or SoundCloud to see who you follow."
        >
          <GhostButton onClick={() => setView('settings')}>Open Settings</GhostButton>
        </Message>
      ) : shown.length === 0 && loading ? (
        <p className="px-2 pt-6 text-text-subdued">Loading…</p>
      ) : shown.length === 0 && errors.length === 0 ? (
        <Message
          title={query ? 'Nobody matches' : 'Nobody here yet'}
          body={
            query
              ? 'Try fewer or different letters.'
              : filter === 'spotify'
                ? 'Follow artists in Spotify and they show up here.'
                : 'Open a SoundCloud profile and use Follow.'
          }
        />
      ) : (
        <ul className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-1">
          {shown.map((a) => (
            <li key={a.id}>
              <button
                onClick={() => setView(`artist:${a.id}`)}
                className="flex w-full flex-col items-center gap-2 rounded-lg p-3 text-center transition-colors duration-[140ms] hover:bg-raised/70"
              >
                <span className="size-[120px] overflow-hidden rounded-full bg-raised">
                  {a.imageUrl ? (
                    <img
                      src={a.imageUrl}
                      alt=""
                      loading="lazy"
                      className="size-full object-cover"
                    />
                  ) : (
                    <UserRound size={40} strokeWidth={1.5} className="m-10 text-text-subdued" />
                  )}
                </span>
                <span className="flex w-full items-center justify-center gap-1">
                  <span className="truncate font-bold">{a.name}</span>
                  {a.verified && (
                    <BadgeCheck size={14} className="flex-none text-accent" aria-label="Verified" />
                  )}
                </span>
                <span className="flex items-center gap-1.5 text-sm text-text-subdued">
                  <SourceBadge provider={a.provider} />
                  {a.provider === 'spotify' ? 'Artist' : 'Profile'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
