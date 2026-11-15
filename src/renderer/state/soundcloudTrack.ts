import { create } from 'zustand'
import type { TrackComment } from '@shared/provider'
import type { ScTrackPage } from '@shared/soundcloud'
import { ipcMessage, type Load } from './services'

/** Waveform + comments for SoundCloud tracks, cached by native id for the session. */
interface ScTrackState {
  waveforms: Record<string, Load<number[]>>
  comments: Record<string, Load<TrackComment[]>>
  /** Track page details (description, stats, uploader), by native id. */
  pages: Record<string, Load<ScTrackPage>>
  loadPage: (nativeId: string) => void
  load: (nativeId: string) => void
  reloadComments: (nativeId: string) => Promise<void>
  /** Posts, then adds the new comment to the cached list. Throws a readable error. */
  post: (nativeId: string, body: string, timestampMs: number) => Promise<TrackComment>
}

export const useScTrack = create<ScTrackState>((set, get) => {
  const fetchComments = async (nativeId: string): Promise<void> => {
    set((s) => ({ comments: { ...s.comments, [nativeId]: { state: 'loading' } } }))
    try {
      const data = await window.api.invoke('soundcloud:getComments', nativeId)
      set((s) => ({ comments: { ...s.comments, [nativeId]: { state: 'ok', data } } }))
    } catch (err) {
      set((s) => ({
        comments: { ...s.comments, [nativeId]: { state: 'error', error: ipcMessage(err) } }
      }))
    }
  }
  return {
    waveforms: {},
    comments: {},
    pages: {},
    loadPage: (nativeId) => {
      const cur = get().pages[nativeId]
      if (cur && cur.state !== 'error') return
      set((s) => ({ pages: { ...s.pages, [nativeId]: { state: 'loading' } } }))
      window.api.invoke('soundcloud:getTrackPage', nativeId).then(
        (data) => set((s) => ({ pages: { ...s.pages, [nativeId]: { state: 'ok', data } } })),
        (err: unknown) =>
          set((s) => ({
            pages: { ...s.pages, [nativeId]: { state: 'error', error: ipcMessage(err) } }
          }))
      )
    },
    load: (nativeId) => {
      if (!get().waveforms[nativeId]) {
        set((s) => ({ waveforms: { ...s.waveforms, [nativeId]: { state: 'loading' } } }))
        window.api.invoke('soundcloud:getWaveform', nativeId).then(
          (data) =>
            set((s) => ({ waveforms: { ...s.waveforms, [nativeId]: { state: 'ok', data } } })),
          (err: unknown) =>
            set((s) => ({
              waveforms: { ...s.waveforms, [nativeId]: { state: 'error', error: ipcMessage(err) } }
            }))
        )
      }
      if (!get().comments[nativeId]) void fetchComments(nativeId)
    },
    reloadComments: fetchComments,
    post: async (nativeId, body, timestampMs) => {
      let comment: TrackComment
      try {
        comment = await window.api.invoke('soundcloud:postComment', nativeId, body, timestampMs)
      } catch (err) {
        throw new Error(ipcMessage(err), { cause: err })
      }
      set((s) => {
        const cur = s.comments[nativeId]
        const list = cur?.state === 'ok' ? cur.data : []
        const data = [...list, comment].sort((a, b) => a.timestampMs - b.timestampMs)
        return { comments: { ...s.comments, [nativeId]: { state: 'ok', data } } }
      })
      return comment
    }
  }
})
