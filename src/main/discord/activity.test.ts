import { describe, expect, it } from 'vitest'
import type { PresenceTrack } from '@shared/discord'
import { fitText, MAX_TEXT, toActivity } from './activity'

const track: PresenceTrack = {
  title: 'Song',
  artists: ['A', 'B'],
  album: 'Album',
  provider: 'spotify',
  artworkUrl: 'https://i.scdn.co/image/abc'
}

describe('toActivity', () => {
  it('maps a playing track', () => {
    expect(
      toActivity({ state: 'playing', track, startedAtMs: 1_000, durationMs: 180_000 })
    ).toEqual({
      type: 2,
      statusDisplayType: 2,
      details: 'Song',
      state: 'A, B',
      largeImageKey: 'https://i.scdn.co/image/abc',
      largeImageText: 'Album',
      smallImageKey: 'spotify',
      smallImageText: 'Spotify',
      startTimestamp: 1_000,
      endTimestamp: 181_000
    })
  })

  it('omits the end timestamp when the duration is unknown', () => {
    const a = toActivity({ state: 'playing', track, startedAtMs: 5, durationMs: 0 })
    expect(a?.startTimestamp).toBe(5)
    expect(a).not.toHaveProperty('endTimestamp')
  })

  it('maps paused without timestamps', () => {
    const a = toActivity({ state: 'paused', track: { ...track, provider: 'soundcloud' } })
    expect(a).not.toHaveProperty('startTimestamp')
    expect(a).not.toHaveProperty('endTimestamp')
    expect(a?.smallImageText).toBe('Paused')
    expect(a?.smallImageKey).toBe('soundcloud')
  })

  it('labels each provider', () => {
    const label = (provider: PresenceTrack['provider']): string | undefined =>
      toActivity({ state: 'playing', track: { ...track, provider }, startedAtMs: 0, durationMs: 0 })
        ?.smallImageText
    expect(label('spotify')).toBe('Spotify')
    expect(label('soundcloud')).toBe('SoundCloud')
    expect(label('local')).toBe('Local file')
  })

  it('clears on stop', () => {
    expect(toActivity({ state: 'stopped' })).toBeNull()
  })

  it('falls back for missing artists, album and title', () => {
    const a = toActivity({
      state: 'paused',
      track: { title: '  ', artists: [' '], provider: 'soundcloud' }
    })
    expect(a?.details).toBe('Unknown track')
    expect(a?.state).toBe('Unknown artist')
    expect(a?.largeImageText).toBe('Unknown track')
    expect(a?.largeImageKey).toBe('app_icon')
  })

  it('uses the title as the large image text without an album', () => {
    const a = toActivity({ state: 'paused', track: { ...track, album: undefined } })
    expect(a?.largeImageText).toBe('Song')
  })

  it('only uses https artwork up to 256 chars', () => {
    const art = (artworkUrl: string): string | undefined =>
      toActivity({ state: 'paused', track: { ...track, artworkUrl } })?.largeImageKey
    expect(art('http://example.com/a.jpg')).toBe('app_icon')
    expect(art('media://art/1')).toBe('app_icon')
    const max = 'https://x.com/' + 'a'.repeat(256 - 14)
    expect(art(max)).toBe(max)
    expect(art(max + 'a')).toBe('app_icon')
  })

  it('uses looked-up https art for local files, else the app icon', () => {
    const local = (artworkUrl: string): ReturnType<typeof toActivity> =>
      toActivity({ state: 'paused', track: { ...track, provider: 'local', artworkUrl } })
    expect(local('https://archive.org/download/x/y.jpg')?.largeImageKey).toBe(
      'https://archive.org/download/x/y.jpg'
    )
    expect(local('media://art/abc')?.largeImageKey).toBe('app_icon')
    expect(local('media://art/abc')?.smallImageKey).toBe('local')
  })

  it('keeps strings within Discord limits', () => {
    const long = 'x'.repeat(300)
    const a = toActivity({
      state: 'paused',
      track: { ...track, title: long, artists: ['Y'], album: long }
    })
    expect(a?.details).toHaveLength(MAX_TEXT)
    expect(a?.details?.endsWith('…')).toBe(true)
    expect(a?.largeImageText).toHaveLength(MAX_TEXT)
    expect(a?.state).toHaveLength(2)
  })
})

describe('fitText', () => {
  it('pads one-character strings and leaves normal ones alone', () => {
    expect(fitText('a', 'f')).toBe('a​')
    expect(fitText('ab', 'f')).toBe('ab')
    expect(fitText('', 'fallback')).toBe('fallback')
  })

  it('does not split a surrogate pair when truncating', () => {
    const s = 'x'.repeat(126) + '😀' + 'tail'
    const out = fitText(s, 'f')
    expect(out).toBe('x'.repeat(126) + '…')
    expect(out.length).toBeLessThanOrEqual(MAX_TEXT)
  })

  it('links the title and artist to their https pages', () => {
    const a = toActivity({
      state: 'playing',
      track: {
        ...track,
        url: 'https://open.spotify.com/track/1',
        artistUrl: 'https://open.spotify.com/artist/2'
      },
      startedAtMs: 0,
      durationMs: 1000
    })
    expect(a?.detailsUrl).toBe('https://open.spotify.com/track/1')
    expect(a?.stateUrl).toBe('https://open.spotify.com/artist/2')
    const b = toActivity({
      state: 'playing',
      track: { ...track, url: 'media://x' },
      startedAtMs: 0,
      durationMs: 0
    })
    expect(b?.detailsUrl).toBeUndefined()
    expect(b?.stateUrl).toBeUndefined()
  })
})
