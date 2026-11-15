import { useMemo } from 'react'
import type { Playlist } from '@shared/types'
import { usePlaylists } from './playlists'
import { useSoundCloud, useSpotify } from './services'

/** Every playlist the app knows right now: in-app, then each connected service's. */
export function useAllPlaylists(): Playlist[] {
  const app = usePlaylists((s) => s.app)
  const spotifyConnected = useSpotify((s) => s.status?.state === 'connected')
  const spotify = useSpotify((s) => s.playlists)
  const scConnected = useSoundCloud((s) => s.status?.state === 'connected')
  const soundcloud = useSoundCloud((s) => s.playlists)
  return useMemo(
    () => [
      ...app,
      ...(spotifyConnected && spotify.state === 'ok' ? spotify.data : []),
      ...(scConnected && soundcloud.state === 'ok' ? soundcloud.data : [])
    ],
    [app, spotifyConnected, spotify, scConnected, soundcloud]
  )
}
