import { UserRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { StatsRange } from '@shared/history'
import { useHistory } from '@renderer/state/history'
import { useUi } from '@renderer/state/ui'
import { Message } from '@renderer/components/CollectionView'
import SourceBadge from '@renderer/components/SourceBadge'
import { TrackRows } from '@renderer/components/TrackList'
import ActivePill from '@renderer/components/ActivePill'

const RANGES: { key: StatsRange; label: string }[] = [
  { key: 'week', label: 'Last 7 days' },
  { key: 'month', label: 'Last 30 days' },
  { key: 'year', label: 'Last year' },
  { key: 'all', label: 'All time' }
]

const SOURCE_LABEL = { spotify: 'Spotify', soundcloud: 'SoundCloud', local: 'Local files' } as const

/** "12 hr 5 min" / "47 min". */
function duration(ms: number): string {
  const mins = Math.round(ms / 60000)
  if (mins < 60) return `${mins} min`
  return `${Math.floor(mins / 60)} hr ${mins % 60} min`
}

/** Top artists and tracks from your plays, across all three sources. */
export default function StatsView(): React.JSX.Element {
  const [range, setRange] = useState<StatsRange>('month')
  const load = useHistory((s) => s.stats[range])
  const fetch = useHistory((s) => s.loadStats)
  const setView = useUi((s) => s.setView)
  useEffect(() => {
    void fetch(range)
  }, [range, fetch])
  const stats = load?.state === 'ok' ? load.data : undefined
  const maxArtist = Math.max(1, stats?.topArtists[0]?.plays ?? 1)

  return (
    <div className="relative h-full overflow-y-auto page-fade pb-page px-4 pt-8">
      <header className="px-2 pt-4">
        <h1 className="text-[32px] leading-10 font-black">Your listening</h1>
        <div className="mt-4 flex flex-wrap gap-2" role="radiogroup" aria-label="Period">
          {RANGES.map((r) => (
            <button
              key={r.key}
              role="radio"
              aria-checked={range === r.key}
              onClick={() => setRange(r.key)}
              className={`relative isolate rounded-full px-3 py-1.5 text-sm font-bold transition-colors duration-[140ms] ${
                range === r.key ? 'text-base' : 'bg-raised text-text hover:bg-raised/70'
              }`}
            >
              {range === r.key && <ActivePill layoutId="stats-range" />}
              {r.label}
            </button>
          ))}
        </div>
      </header>

      {load?.state === 'error' ? (
        <Message title="Couldn't load your stats" body={load.error} />
      ) : !stats ? (
        <p className="px-2 pt-6 text-text-subdued">Loading…</p>
      ) : stats.totalPlays === 0 ? (
        <Message
          title="No plays in this period"
          body="A play counts after 30 seconds of listening (or half a short track)."
        />
      ) : (
        <>
          <dl className="mt-6 grid grid-cols-2 gap-2 px-2 md:grid-cols-5">
            <div className="rounded-lg bg-raised/50 p-4">
              <dd className="text-2xl font-black tabular-nums">
                {stats.totalPlays.toLocaleString()}
              </dd>
              <dt className="text-sm text-text-subdued">plays</dt>
            </div>
            <div className="rounded-lg bg-raised/50 p-4">
              <dd className="text-2xl font-black tabular-nums">{duration(stats.totalMs)}</dd>
              <dt className="text-sm text-text-subdued">listened</dt>
            </div>
            {(['spotify', 'soundcloud', 'local'] as const).map((src) => (
              <div key={src} className="rounded-lg bg-raised/50 p-4">
                <dd className="text-2xl font-black tabular-nums">
                  {stats.bySource[src].toLocaleString()}
                </dd>
                <dt className="flex items-center gap-1.5 text-sm text-text-subdued">
                  <SourceBadge provider={src} />
                  {SOURCE_LABEL[src]}
                </dt>
              </div>
            ))}
          </dl>

          <section className="mt-8">
            <h2 className="px-2 text-xl font-bold">Top artists</h2>
            <ol className="mt-3 flex flex-col gap-1">
              {stats.topArtists.map((a, i) => (
                <li key={a.name}>
                  <button
                    disabled={!a.artistId}
                    onClick={() => a.artistId && setView(`artist:${a.artistId}`)}
                    className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors duration-[140ms] enabled:hover:bg-raised/70"
                  >
                    <span className="w-6 text-right text-text-subdued tabular-nums">{i + 1}</span>
                    <span className="size-12 flex-none overflow-hidden rounded-full bg-raised">
                      {a.artworkUrl ? (
                        <img
                          src={a.artworkUrl}
                          alt=""
                          loading="lazy"
                          className="size-full object-cover"
                        />
                      ) : (
                        <span className="flex size-full items-center justify-center">
                          <UserRound size={22} className="text-text-subdued" />
                        </span>
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-bold">{a.name}</span>
                      <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-progress-track">
                        <span
                          className="block h-full rounded-full bg-accent"
                          style={{ width: `${(a.plays / maxArtist) * 100}%` }}
                        />
                      </span>
                    </span>
                    <span className="w-28 text-right text-sm text-text-subdued tabular-nums">
                      {a.plays} {a.plays === 1 ? 'play' : 'plays'}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </section>

          <section className="mt-8">
            <h2 className="px-2 text-xl font-bold">Top tracks</h2>
            <div className="mt-2">
              <TrackRows tracks={stats.topTracks.map((t) => t.track)} />
            </div>
          </section>
        </>
      )}
    </div>
  )
}
