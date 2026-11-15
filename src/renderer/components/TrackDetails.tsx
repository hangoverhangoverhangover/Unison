import { BadgeCheck, Check, FolderOpen, Tags, UserRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Artist, Track } from '@shared/types'
import { useFollowedIds } from '@renderer/state/followed'
import { useLibrary } from '@renderer/state/library'
import { useTagEditor } from '@renderer/state/tagEditor'
import { useUi } from '@renderer/state/ui'
import EntityLinks from './EntityLinks'
import LikeButton from './LikeButton'
import SourceBadge from './SourceBadge'

/** "About the artist": one request per track change (music:getArtistInfo, cached in main). */
function AboutArtist({ artistId }: { artistId: string }): React.JSX.Element | null {
  const [found, setFound] = useState<{ id: string; artist: Artist | null }>()
  const setView = useUi((s) => s.setView)
  const followed = useFollowedIds()
  useEffect(() => {
    let cancelled = false
    window.api.invoke('music:getArtistInfo', artistId).then(
      (artist) => !cancelled && setFound({ id: artistId, artist }),
      () => !cancelled && setFound({ id: artistId, artist: null })
    )
    return () => {
      cancelled = true
    }
  }, [artistId])
  const artist = found?.id === artistId ? found.artist : undefined
  if (!artist) return null
  const following = followed.has(artist.id)
  return (
    <section className="mt-6 overflow-hidden rounded-lg bg-raised/50">
      <h3 className="px-4 pt-4 font-bold">About the artist</h3>
      <button
        onClick={() => setView(`artist:${artist.id}`)}
        className="flex w-full items-center gap-4 p-4 text-left transition-colors duration-[140ms] hover:bg-raised/60"
      >
        <span className="size-20 flex-none overflow-hidden rounded-full bg-raised">
          {artist.imageUrl ? (
            <img src={artist.imageUrl} alt="" className="size-full object-cover" />
          ) : (
            <UserRound size={32} strokeWidth={1.5} className="m-6 text-text-subdued" />
          )}
        </span>
        <span className="min-w-0">
          <span className="flex items-center gap-1.5">
            <span className="truncate font-bold">{artist.name}</span>
            {artist.verified && (
              <BadgeCheck size={16} className="flex-none text-accent" aria-label="Verified" />
            )}
          </span>
          {artist.followers !== undefined && (
            <span className="block text-sm text-text-subdued">
              {artist.followers.toLocaleString()} followers
            </span>
          )}
          {following && (
            <span className="mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold text-text ring-1 ring-text-muted">
              <Check size={12} /> Following
            </span>
          )}
          <span className="mt-1 block text-sm text-text-subdued">Open artist page</span>
        </span>
      </button>
    </section>
  )
}

/** Details for Spotify and local tracks: big artwork, linked title and artists, the artist. */
export default function TrackDetails({ track }: { track: Track }): React.JSX.Element {
  const editTrack = useTagEditor((s) => s.editTrack)
  const editFolder = useTagEditor((s) => s.editFolder)
  const firstArtist = track.artistRefs?.[0]?.id

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 page-fade pb-page">
      <div className="aspect-square w-full overflow-hidden rounded-lg bg-raised shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
        {track.artworkUrl && (
          <img src={track.artworkUrl} alt="" className="size-full object-cover" />
        )}
      </div>
      <div className="mt-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xl font-bold">
            {track.albumRef ? (
              <EntityLinks names={[track.title]} refs={[track.albumRef]} kind="album" />
            ) : (
              track.title
            )}
          </p>
          <p className="flex items-center gap-1.5 truncate text-sm text-text-subdued">
            <SourceBadge provider={track.provider} />
            <EntityLinks names={track.artists} refs={track.artistRefs} className="truncate" />
          </p>
          {track.album && (
            <p className="mt-1 truncate text-sm text-text-subdued">
              {track.albumRef ? (
                <EntityLinks names={[track.album]} refs={[track.albumRef]} kind="album" />
              ) : (
                track.album
              )}
            </p>
          )}
        </div>
        {track.provider !== 'local' && <LikeButton track={track} size={22} />}
      </div>

      {track.provider === 'local' && (
        <section className="mt-6 rounded-lg bg-raised/50 p-4 text-sm">
          <p className="flex items-start gap-2 break-all text-text-subdued">
            <FolderOpen size={16} className="mt-0.5 flex-none" />
            {track.localPath}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => editTrack(track)}
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 font-bold text-text ring-1 ring-text-muted hover:ring-text"
            >
              <Tags size={14} /> Edit tags
            </button>
            <button
              onClick={() => editFolder(track, useLibrary.getState().tracks)}
              className="rounded-full px-3 py-1.5 font-bold text-text-subdued ring-1 ring-text-muted hover:text-text hover:ring-text"
            >
              Edit this folder
            </button>
          </div>
        </section>
      )}

      {firstArtist && <AboutArtist key={firstArtist} artistId={firstArtist} />}
    </div>
  )
}
