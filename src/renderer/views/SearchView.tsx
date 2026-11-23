import { Clock3, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSpotify } from '@renderer/state/services'
import { SERVICE_NAME } from '@renderer/lib/services'
import { pickTopResult } from '@renderer/lib/searchMerge'
import {
  addRecentSearch,
  clearRecentSearches,
  loadRecentSearches
} from '@renderer/lib/recentSearches'
import { TrackRows } from '@renderer/components/TrackList'
import { Message } from '@renderer/components/CollectionView'
import {
  ArtistCard,
  CardGrid,
  SetCard,
  SourceDot,
  TopResultCard
} from '@renderer/components/SearchCards'
import { useUi } from '@renderer/state/ui'
import { SEARCH_SOURCES, useSearch, type SearchSource } from '@renderer/state/search'
import ActivePill from '@renderer/components/ActivePill'

type Kind = 'all' | 'songs' | 'artists' | 'sets'
const KINDS: { kind: Kind; label: string }[] = [
  { kind: 'all', label: 'All' },
  { kind: 'songs', label: 'Songs' },
  { kind: 'artists', label: 'Artists' },
  { kind: 'sets', label: 'Albums & playlists' }
]
const SOURCE_LABEL: Record<SearchSource, string> = {
  spotify: 'Spotify',
  soundcloud: 'SoundCloud',
  discography: 'Discography',
  local: 'Local'
}
/** Cards per row on the All view (one tidy row each). */
const ALL_CARDS = 6

function Chip({
  on,
  onClick,
  children,
  role = 'radio',
  pill
}: {
  on: boolean
  onClick: () => void
  children: React.ReactNode
  role?: 'radio' | 'checkbox'
  /** Single-choice groups: the highlight slides between options under this id. */
  pill?: string
}): React.JSX.Element {
  return (
    <button
      role={role}
      aria-checked={on}
      onClick={onClick}
      className={`relative isolate flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold transition-colors duration-[140ms] ${
        on
          ? pill
            ? 'text-base'
            : 'bg-text text-base'
          : 'bg-raised text-text-subdued hover:bg-raised-hover hover:text-text'
      }`}
    >
      {on && pill && <ActivePill layoutId={pill} />}
      {children}
    </button>
  )
}

function Section({
  title,
  action,
  children
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section aria-label={title} className="min-w-0">
      <div className="flex items-baseline justify-between px-2 pb-2">
        <h2 className="text-xl font-bold tracking-[-0.01em]">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function SeeAll({ onClick }: { onClick: () => void }): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className="text-sm font-semibold text-text-subdued transition-colors duration-[140ms] hover:text-text"
    >
      Show all
    </button>
  )
}

/**
 * Full search page: one box, a slim filter line (type on the left, sources on the
 * right), then results from every source mixed together. Quick search (title bar
 * pill, Ctrl+K) opens here with its query via `useUi.searchQuery`.
 */
export default function SearchView(): React.JSX.Element {
  const spotifyConnected = useSpotify((s) => s.status?.state === 'connected')
  const handoff = useUi((s) => s.searchQuery)
  const [query, setQuery] = useState(handoff)
  const [kind, setKind] = useState<Kind>('all')
  const [sources, setSources] = useState<ReadonlySet<SearchSource>>(new Set(SEARCH_SOURCES))
  const [recent, setRecent] = useState<string[]>(() => loadRecentSearches())
  const inputRef = useRef<HTMLInputElement>(null)

  // A new hand-off from quick search replaces the box's text.
  const [seenHandoff, setSeenHandoff] = useState(handoff)
  if (handoff !== seenHandoff) {
    setSeenHandoff(handoff)
    setQuery(handoff)
  }

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const r = useSearch(query, sources)
  const q = query.trim()
  const top = useMemo(() => pickTopResult(q, r.artists, r.tracks), [q, r.artists, r.tracks])
  const remember = (): void => setRecent(addRecentSearch(q))

  const toggleSource = (s: SearchSource): void => {
    const next = new Set(sources)
    if (next.has(s)) next.delete(s)
    else next.add(s)
    if (next.size > 0) setSources(next)
  }

  const nothing =
    q !== '' &&
    r.query !== '' &&
    !r.loading &&
    r.tracks.length === 0 &&
    r.artists.length === 0 &&
    r.sets.length === 0
  const errors = Object.entries(r.errors) as [SearchSource, string][]

  return (
    <div className="h-full overflow-y-auto page-fade pb-page">
      <div className="px-6 pt-6 pb-2">
        <label className="flex h-12 items-center gap-3 rounded-full bg-raised px-4 ring-accent transition-shadow duration-[140ms] focus-within:ring-2">
          <Search size={20} className="flex-none text-text-subdued" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') remember()
            }}
            placeholder="Songs, artists, albums and playlists"
            aria-label="Search"
            className="min-w-0 flex-1 bg-transparent text-md text-text outline-none placeholder:text-text-muted"
          />
          {query && (
            <button
              aria-label="Clear search"
              onClick={() => {
                setQuery('')
                inputRef.current?.focus()
              }}
              className="text-text-subdued hover:text-text"
            >
              <X size={18} />
            </button>
          )}
        </label>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label="Result type" className="flex flex-wrap gap-1.5">
            {KINDS.map(({ kind: k, label }) => (
              <Chip key={k} pill="search-kind" on={kind === k} onClick={() => setKind(k)}>
                {label}
              </Chip>
            ))}
          </div>
          <div role="group" aria-label="Sources" className="ml-auto flex flex-wrap gap-1.5">
            {SEARCH_SOURCES.map((s) => (
              <Chip key={s} role="checkbox" on={sources.has(s)} onClick={() => toggleSource(s)}>
                <SourceDot provider={s} />
                {SOURCE_LABEL[s]}
              </Chip>
            ))}
          </div>
        </div>
      </div>

      <div className="px-4 pt-4" onClickCapture={() => q && remember()}>
        {!q ? (
          <Recent
            list={recent}
            onPick={(x) => setQuery(x)}
            onClear={() => {
              clearRecentSearches()
              setRecent([])
            }}
          />
        ) : nothing ? (
          <Message title={`No results for “${q}”`} body="Check the spelling or try fewer words." />
        ) : kind === 'all' ? (
          <div className="flex flex-col gap-8">
            {(top || r.tracks.length > 0) && (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                {top && (
                  <Section title="Top result">
                    <div className="h-[calc(100%-36px)] min-h-56">
                      <TopResultCard top={top} />
                    </div>
                  </Section>
                )}
                {r.tracks.length > 0 && (
                  <Section title="Songs" action={<SeeAll onClick={() => setKind('songs')} />}>
                    <TrackRows tracks={r.tracks.slice(0, 4)} showAlbum={false} />
                  </Section>
                )}
              </div>
            )}
            {r.artists.length > 0 && (
              <Section title="Artists" action={<SeeAll onClick={() => setKind('artists')} />}>
                <CardGrid>
                  {r.artists.slice(0, ALL_CARDS).map((a) => (
                    <ArtistCard key={a.id} artist={a} />
                  ))}
                </CardGrid>
              </Section>
            )}
            {r.sets.length > 0 && (
              <Section
                title="Albums & playlists"
                action={<SeeAll onClick={() => setKind('sets')} />}
              >
                <CardGrid>
                  {r.sets.slice(0, ALL_CARDS).map((s) => (
                    <SetCard key={s.id} set={s} />
                  ))}
                </CardGrid>
              </Section>
            )}
          </div>
        ) : kind === 'songs' ? (
          <>
            <TrackRows tracks={r.tracks} showAlbum={r.tracks.some((t) => !!t.album)} />
            {r.hasMore && (
              <div className="flex justify-center py-4">
                <button
                  disabled={r.loading}
                  onClick={r.loadMore}
                  className="rounded-full bg-raised px-4 py-2 text-sm font-semibold text-text-subdued transition-colors duration-[140ms] hover:bg-raised-hover hover:text-text disabled:opacity-40"
                >
                  {r.loading ? 'Loading…' : 'Show more'}
                </button>
              </div>
            )}
          </>
        ) : kind === 'artists' ? (
          <CardGrid>
            {r.artists.map((a) => (
              <ArtistCard key={a.id} artist={a} />
            ))}
          </CardGrid>
        ) : (
          <CardGrid>
            {r.sets.map((s) => (
              <SetCard key={s.id} set={s} />
            ))}
          </CardGrid>
        )}

        {q && r.loading && r.query === '' && (
          <p className="px-2 py-6 text-sm text-text-muted">Searching…</p>
        )}
        {errors.length > 0 && (
          <p className="px-2 pt-6 text-sm text-danger">
            {errors.map(([s, msg]) => `${SOURCE_LABEL[s]}: ${msg}`).join(' · ')}
          </p>
        )}
        {q && !spotifyConnected && sources.has('spotify') && (
          <p className="px-2 pt-8 text-sm text-text-muted">
            Connect {SERVICE_NAME.spotify} in Settings to include it here.
          </p>
        )}
      </div>
    </div>
  )
}

function Recent({
  list,
  onPick,
  onClear
}: {
  list: string[]
  onPick: (q: string) => void
  onClear: () => void
}): React.JSX.Element {
  if (list.length === 0) {
    return (
      <Message
        title="Search Spotify, SoundCloud and your files"
        body="Find songs, artists, albums and playlists."
      />
    )
  }
  return (
    <Section
      title="Recent searches"
      action={
        <button
          onClick={onClear}
          className="text-sm font-semibold text-text-subdued transition-colors duration-[140ms] hover:text-text"
        >
          Clear
        </button>
      }
    >
      <ul>
        {list.map((x) => (
          <li key={x}>
            <button
              onClick={() => onPick(x)}
              className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-text-subdued transition-colors duration-[140ms] hover:bg-raised hover:text-text"
            >
              <Clock3 size={16} className="flex-none text-text-muted" />
              <span className="truncate">{x}</span>
            </button>
          </li>
        ))}
      </ul>
    </Section>
  )
}
