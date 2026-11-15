import { create } from 'zustand'
import type { LikesSyncStatus } from '@shared/library'
import type { LikedTrack } from '@shared/types'
import { ipcMessage, useSoundCloud, useSpotify, type Load } from './services'

interface LikesState {
  /** Merged likes from every service, newest like first (local likes table). */
  likes: Load<LikedTrack[]>
  sync: LikesSyncStatus | null
  refresh: () => Promise<void>
  syncNow: () => Promise<void>
}

export const useLikes = create<LikesState>((set, get) => ({
  likes: { state: 'idle' },
  sync: null,
  refresh: async () => {
    if (get().likes.state === 'idle') set({ likes: { state: 'loading' } })
    try {
      const prev = get().likes
      const data = await window.api.invoke('likes:getAll')
      set({ likes: { state: 'ok', data } })
      // Hearts read the per-service liked maps; mirror the merged list into them,
      // including likes that disappeared (unliked in the official apps).
      const spotify: Record<string, boolean> = {}
      const soundcloud: Record<string, boolean> = {}
      if (prev.state === 'ok') {
        for (const l of prev.data) {
          if (l.track.provider === 'spotify') spotify[l.track.id] = false
          else if (l.track.provider === 'soundcloud') soundcloud[l.track.id] = false
        }
      }
      for (const l of data) {
        if (l.track.provider === 'spotify') spotify[l.track.id] = true
        else if (l.track.provider === 'soundcloud') soundcloud[l.track.id] = true
      }
      useSpotify.setState((s) => ({ liked: { ...s.liked, ...spotify } }))
      useSoundCloud.setState((s) => ({ liked: { ...s.liked, ...soundcloud } }))
    } catch (err) {
      set({ likes: { state: 'error', error: ipcMessage(err) } })
    }
  },
  syncNow: async () => {
    try {
      await window.api.invoke('likes:sync')
    } catch {
      // Reported through likes:syncStatus errors.
    }
  }
}))

/** Keep merged likes in step with main. Call once at startup. */
export function bindLikesEvents(): () => void {
  const s = useLikes.getState()
  void s.refresh()
  void window.api.invoke('likes:getSyncStatus').then((sync) => useLikes.setState({ sync }))
  const off1 = window.api.on('likes:changed', () => void useLikes.getState().refresh())
  const off2 = window.api.on('likes:syncStatus', (sync) => useLikes.setState({ sync }))
  return () => {
    off1()
    off2()
  }
}
