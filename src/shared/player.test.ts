import { describe, expect, it } from 'vitest'
import type { Track } from './types'
import { mediaFor, pickFor, type PlayerMedia } from './player'

const m = (id: string, scope: PlayerMedia['scope']): PlayerMedia => ({
  id,
  kind: 'image',
  ext: 'jpg',
  name: id,
  size: 1,
  scope,
  addedAt: 0
})
const track = (artists: string[], album?: string): Track => ({
  id: 'spotify:1',
  provider: 'spotify',
  nativeId: '1',
  title: 'Sumo',
  artists,
  album,
  durationMs: 1
})

const items = [
  m('all', { type: 'all' }),
  m('hic', { type: 'artist', name: 'Hi-C' }),
  m('munnie', { type: 'album', name: 'Munnie Fetish Renegade Demon', artist: 'Hi C' }),
  m('other', { type: 'artist', name: 'DOMD' })
]

describe('mediaFor', () => {
  it('prefers the album, then the artist, then every song', () => {
    expect(
      mediaFor(items, track(['Hi-C'], 'Munnie Fetish Renegade Demon')).map((x) => x.id)
    ).toEqual(['munnie'])
    expect(mediaFor(items, track(['hi c'], 'No More Heroes')).map((x) => x.id)).toEqual(['hic'])
    expect(mediaFor(items, track(['Someone Else'])).map((x) => x.id)).toEqual(['all'])
    expect(mediaFor(items, null).map((x) => x.id)).toEqual(['all'])
    expect(mediaFor([], track(['Hi-C']))).toEqual([])
  })

  it('one set for the song itself wins over everything (QoL 4)', () => {
    const withSong = [...items, m('song', { type: 'song', trackId: 'spotify:1', title: 'Sumo' })]
    expect(
      mediaFor(withSong, track(['Hi-C'], 'Munnie Fetish Renegade Demon')).map((x) => x.id)
    ).toEqual(['song'])
  })

  it('an album picture for another artist does not count', () => {
    expect(
      mediaFor(items, track(['DOMD'], 'Munnie Fetish Renegade Demon')).map((x) => x.id)
    ).toEqual(['other'])
  })
})

describe('pickFor', () => {
  it('picks the same one for a song every time, and nothing from nothing', () => {
    const list = [m('a', { type: 'all' }), m('b', { type: 'all' })]
    expect(pickFor(list, 'spotify:1')).toBe(pickFor(list, 'spotify:1'))
    expect(pickFor([], 'x')).toBeNull()
  })
})
