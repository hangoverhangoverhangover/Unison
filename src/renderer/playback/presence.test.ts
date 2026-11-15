import { describe, expect, it } from 'vitest'
import type { PlaybackState } from '@shared/playback'
import type { Track } from '@shared/types'
import { INITIAL_MEMORY, nextPresence, type PresenceMemory } from './presence'

const track = (id: string, extra: Partial<Track> = {}): Track => ({
  id: `spotify:${id}`,
  provider: 'spotify',
  nativeId: id,
  title: `Song ${id}`,
  artists: ['A'],
  durationMs: 200_000,
  ...extra
})

const state = (status: PlaybackState['status'], t?: Track): PlaybackState => ({
  status,
  current: t ? { uid: 'u', track: t } : null,
  queue: [],
  positionMs: 0,
  durationMs: t?.durationMs ?? 0,
  volume: 1,
  muted: false,
  shuffle: false,
  repeat: 'off'
})

/** Run a sequence of [state, position, now], returning the updates sent. */
function run(steps: [PlaybackState, number, number][]): string[] {
  let mem: PresenceMemory = INITIAL_MEMORY
  const sent: string[] = []
  for (const [s, pos, now] of steps) {
    const next = nextPresence(s, pos, now, mem)
    if (next) {
      mem = next.memory
      const u = next.update
      sent.push(
        u.state === 'playing'
          ? `playing ${u.track.title} @${u.startedAtMs}`
          : u.state === 'paused'
            ? `paused ${u.track.title}`
            : 'stopped'
      )
    }
  }
  return sent
}

describe('nextPresence', () => {
  it('sends on track change, resume and stop, and clears on pause', () => {
    const a = track('1')
    const b = track('2')
    expect(
      run([
        [state('playing', a), 0, 1000],
        [state('playing', a), 5000, 6000], // normal progress: nothing
        [state('paused', a), 5000, 6000],
        [state('paused', a), 5000, 7000], // still paused: nothing
        [state('playing', a), 5000, 9000],
        [state('loading', b), 0, 10_000], // loading the next track: keep showing a
        [state('playing', b), 0, 10_500],
        [state('idle'), 0, 11_000],
        [state('idle'), 0, 12_000]
      ])
    ).toEqual([
      'playing Song 1 @1000',
      'stopped',
      'playing Song 1 @4000',
      'playing Song 2 @10500',
      'stopped'
    ])
  })

  it('treats a jump in position as a seek', () => {
    const a = track('1')
    expect(
      run([
        [state('playing', a), 0, 1000],
        [state('playing', a), 60_000, 2000], // seeked forward 59 s
        [state('playing', a), 61_500, 3000] // 500 ms drift: nothing
      ])
    ).toEqual(['playing Song 1 @1000', 'playing Song 1 @-58000'])
  })

  it('passes track details through and stops on errors', () => {
    const t = track('1', { album: 'LP', artworkUrl: 'https://i.scdn.co/x.jpg' })
    const first = nextPresence(state('playing', t), 0, 50, INITIAL_MEMORY)!
    expect(first.update).toEqual({
      state: 'playing',
      track: {
        title: 'Song 1',
        artists: ['A'],
        album: 'LP',
        provider: 'spotify',
        artworkUrl: 'https://i.scdn.co/x.jpg'
      },
      startedAtMs: 50,
      durationMs: 200_000
    })
    expect(nextPresence(state('error', t), 0, 60, first.memory)!.update).toEqual({
      state: 'stopped'
    })
  })
})
