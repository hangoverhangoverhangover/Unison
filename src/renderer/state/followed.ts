import { useEffect } from 'react'
import { create } from 'zustand'
import { useSoundCloud, useSpotify } from './services'

/**
 * App ids of everyone you follow on Spotify and SoundCloud, loaded once per session
 * (used to show "Following" in the Details panel). Failures leave the set as it is.
 */
interface FollowedState {
  ids: ReadonlySet<string>
  loaded: Partial<Record<'spotify' | 'soundcloud', boolean>>
  load: (provider: 'spotify' | 'soundcloud') => Promise<void>
}

export const useFollowed = create<FollowedState>((set, get) => ({
  ids: new Set(),
  loaded: {},
  load: async (provider) => {
    if (get().loaded[provider]) return
    set((s) => ({ loaded: { ...s.loaded, [provider]: true } }))
    try {
      const list = await window.api.invoke(
        provider === 'spotify' ? 'spotify:getFollowings' : 'soundcloud:getFollowings'
      )
      set((s) => ({ ids: new Set([...s.ids, ...list.map((a) => a.id)]) }))
    } catch {
      // e.g. Spotify login without the follow permission: no "Following" badges
    }
  }
}))

/** The followed-ids set, loading each connected service's list the first time. */
export function useFollowedIds(): ReadonlySet<string> {
  const spotifyOn = useSpotify((s) => s.status?.state === 'connected')
  const scOn = useSoundCloud((s) => s.status?.state === 'connected')
  const load = useFollowed((s) => s.load)
  useEffect(() => {
    if (spotifyOn) void load('spotify')
    if (scOn) void load('soundcloud')
  }, [spotifyOn, scOn, load])
  return useFollowed((s) => s.ids)
}
