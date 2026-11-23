import { describe, expect, it } from 'vitest'
import { artworkUrl, streamExpiry, toTrack } from './mapping'

describe('toTrack', () => {
  it('maps a search result to an app track', () => {
    expect(
      toTrack({
        id: 'abc-1',
        title: ' ##RR##EFG ',
        artists: ['Kankan & LUCKI', ''],
        album: 's*x m*ney dr*gs (Sessions)',
        duration: 141,
        available: true,
        artwork_url: '/public/artwork/local/x.jpg',
        media_artwork_url: '/public/artwork/local/y.jpg',
        stream_url: 'https://media.discography.stream/audio/abc-1.mp3?exp=1&sig=s'
      })
    ).toEqual({
      id: 'discography:abc-1',
      provider: 'discography',
      nativeId: 'abc-1',
      title: '##RR##EFG',
      artists: ['Kankan & LUCKI'],
      album: 's*x m*ney dr*gs (Sessions)',
      durationMs: 141_000,
      artworkUrl: 'https://discography.stream/api/public/artwork/local/y.jpg'
    })
  })

  it('marks unavailable songs and drops broken entries', () => {
    expect(toTrack({ id: 'x', title: 'T', available: false })?.availability).toBe('blocked')
    expect(toTrack({ id: '', title: 'T' })).toBeNull()
    expect(toTrack({ id: 'x' } as never)).toBeNull()
  })
})

describe('artworkUrl', () => {
  it('keeps the site only', () => {
    expect(artworkUrl('https://discography.stream/api/a.jpg')).toBe(
      'https://discography.stream/api/a.jpg'
    )
    expect(artworkUrl('https://evil.example/a.jpg')).toBeUndefined()
    expect(artworkUrl('http://discography.stream/a.jpg')).toBeUndefined()
    expect(artworkUrl(null)).toBeUndefined()
  })
})

describe('streamExpiry', () => {
  it('reads exp as epoch ms', () => {
    expect(streamExpiry('https://m/a.mp3?exp=1795486620&sig=x')).toBe(1795486620_000)
    expect(streamExpiry('https://m/a.mp3')).toBeUndefined()
    expect(streamExpiry('not a url')).toBeUndefined()
  })
})
