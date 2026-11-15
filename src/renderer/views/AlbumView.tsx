import { useEffect } from 'react'
import { ListMusic } from 'lucide-react'
import { useCatalog } from '@renderer/state/catalog'
import { formatCollection } from '@renderer/lib/format'
import { ALBUM_TYPE_LABEL, releaseDateLong, releaseYear } from '@renderer/lib/catalog'
import CollectionView, { Message } from '@renderer/components/CollectionView'
import DownloadAllButton from '@renderer/components/DownloadAllButton'
import EntityLinks from '@renderer/components/EntityLinks'

/** Album, single or EP page (`album:<provider>:<id>`). */
export default function AlbumView({ id }: { id: string }): React.JSX.Element {
  const page = useCatalog((s) => s.albums[id])
  const load = useCatalog((s) => s.loadAlbum)
  useEffect(() => {
    void load(id)
  }, [id, load])

  const data = page?.state === 'ok' ? page.data : undefined
  const album = data?.album
  const tracks = data?.tracks ?? []
  const totalMs = tracks.reduce((sum, t) => sum + t.durationMs, 0)
  const year = releaseYear(album?.releaseDate)

  return (
    <CollectionView
      key={id}
      kicker={album ? ALBUM_TYPE_LABEL[album.type] : 'Album'}
      filterLabel="Search in this release"
      title={album?.name ?? (page?.state === 'error' ? 'Album' : '')}
      cover={
        album?.artworkUrl ? (
          <img src={album.artworkUrl} alt="" className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center bg-raised">
            <ListMusic size={64} strokeWidth={1.5} className="text-text-subdued" />
          </div>
        )
      }
      heroArtwork={album?.artworkUrl}
      tracks={tracks}
      loading={!page || page.state === 'loading'}
      error={page?.state === 'error' ? page.error : undefined}
      byline={
        album && (
          <p className="mt-2 flex flex-wrap items-center gap-x-2 text-sm text-text-subdued">
            <EntityLinks
              names={album.artists.map((a) => a.name)}
              refs={album.artists}
              className="font-bold text-text"
            />
            {year && <span>{year}</span>}
            <span>{formatCollection(tracks.length || album.trackCount, totalMs)}</span>
          </p>
        )
      }
      toolbar={
        album?.provider === 'soundcloud' && tracks.length > 0 ? (
          <DownloadAllButton getTracks={async () => tracks} count={tracks.length} />
        ) : undefined
      }
      empty={<Message title="No tracks" body="This release has no playable tracks." />}
      footer={
        data && (
          <div className="px-4 pt-6 text-xs text-text-subdued">
            {releaseDateLong(album?.releaseDate) && (
              <p className="text-sm">{releaseDateLong(album?.releaseDate)}</p>
            )}
            {data.copyrights.map((c) => (
              <p key={c}>{c}</p>
            ))}
          </div>
        )
      }
    />
  )
}
