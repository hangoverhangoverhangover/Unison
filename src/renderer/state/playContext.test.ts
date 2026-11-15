import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '@shared/types'

const playTracks = vi.fn(() => Promise.resolve())
vi.mock('@renderer/playback/controller', () => ({ playback: { playTracks } }))

const { playFrom, usePlayContext } = await import('./playContext')
const { useUi } = await import('./ui')

const tracks = [{ id: 'local:a' }, { id: 'local:b' }] as Track[]

beforeEach(() => {
  playTracks.mockClear()
  usePlayContext.setState({ context: null })
  useUi.setState({ view: 'playlist:app:1' })
})

describe('playFrom', () => {
  it('plays and remembers the page it was started from', async () => {
    await playFrom(tracks, 1)
    expect(playTracks).toHaveBeenCalledWith(tracks, 1)
    expect(usePlayContext.getState().context).toBe('playlist:app:1')
  })

  it('takes an explicit context, or none (overlays like quick search)', async () => {
    await playFrom(tracks, 0, 'likes')
    expect(usePlayContext.getState().context).toBe('likes')
    await playFrom(tracks, 0, null)
    expect(usePlayContext.getState().context).toBeNull()
  })
})
