import { describe, expect, it } from 'vitest'
import type { Track } from '@shared/types'
import { geniusLyrics, lyricsFromPage, pickHit } from './genius'

const track = (title: string, artist: string): Track => ({
  id: 'local:1',
  provider: 'local',
  nativeId: '1',
  title,
  artists: [artist],
  durationMs: 1
})

const hit = (
  title: string,
  artist: string,
  url = 'https://genius.com/x-lyrics',
  state = 'complete'
): { type: string; result: Record<string, unknown> } => ({
  type: 'song',
  result: { title, url, lyrics_state: state, primary_artist: { name: artist } }
})

describe('pickHit', () => {
  it('takes the hit with the same artist and title', () => {
    const hits = [
      hit('Sumo', 'Someone Else', 'https://genius.com/wrong'),
      hit('Sumo (Remix)', 'Hi-C', 'https://genius.com/remix'),
      hit('Sumo', 'Hi-C', 'https://genius.com/Hi-c-sumo-lyrics')
    ]
    expect(pickHit(hits, track('Sumo', 'Hi-C'))).toBe('https://genius.com/Hi-c-sumo-lyrics')
  })

  it('skips unfinished lyrics, other hosts and junk', () => {
    expect(
      pickHit([hit('Sumo', 'Hi-C', 'https://genius.com/a', 'unreleased')], track('Sumo', 'Hi-C'))
    ).toBeNull()
    expect(
      pickHit([hit('Sumo', 'Hi-C', 'https://evil.example/a')], track('Sumo', 'Hi-C'))
    ).toBeNull()
    expect(pickHit(null, track('Sumo', 'Hi-C'))).toBeNull()
    expect(pickHit([{ type: 'article' }], track('Sumo', 'Hi-C'))).toBeNull()
  })
})

const PAGE = `<html><body><div class="x">
<div data-lyrics-container="true" class="Lyrics__Container">
<div data-exclude-from-selection="true"><span>12 Contributors</span><div>Sumo Lyrics</div></div>
[Intro]<br/>Yeah, <a href="/1"><span class="r">uh</span></a><br><br>[Verse 1]<br/>I&#x27;m on it &amp; that&#39;s it<br/><i>Hi-C</i> in the
 building</div>
<div class="ad">ignore me</div>
<div data-lyrics-container="true"><br>[Chorus]<br>Last &quot;line&quot;<br/></div>
</div></body></html>`

describe('lyricsFromPage', () => {
  it('keeps the words and line breaks, drops headers and the page furniture', () => {
    expect(lyricsFromPage(PAGE)).toBe(
      ['Yeah, uh', '', "I'm on it & that's it", 'Hi-C in the building', '', 'Last "line"'].join(
        '\n'
      )
    )
  })

  it('gives null for a page without lyrics', () => {
    expect(lyricsFromPage('<html><div>nothing</div></html>')).toBeNull()
  })
})

describe('geniusLyrics', () => {
  const ok = (body: unknown, type = 'application/json'): Response =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': type }
    })

  it('searches with the token, then reads the page', async () => {
    const calls: { url: string; auth?: string }[] = []
    const out = await geniusLyrics(
      async (url, init) => {
        calls.push({ url, auth: (init?.headers as Record<string, string>)?.Authorization })
        return url.startsWith('https://api.genius.com')
          ? ok({ response: { hits: [hit('Sumo', 'Hi-C', 'https://genius.com/Hi-c-sumo-lyrics')] } })
          : ok(PAGE, 'text/html')
      },
      'tok',
      track('Sumo', 'Hi-C'),
      'Unison/test'
    )
    expect(out).toMatchObject({ url: 'https://genius.com/Hi-c-sumo-lyrics' })
    expect(calls[0]).toEqual({
      url: 'https://api.genius.com/search?q=Hi-C+Sumo',
      auth: 'Bearer tok'
    })
    expect(calls[1]?.auth).toBeUndefined()
  })

  it("is 'none' for no match and null when Genius can't answer", async () => {
    expect(
      await geniusLyrics(
        async () => ok({ response: { hits: [] } }),
        't',
        track('Sumo', 'Hi-C'),
        'u'
      )
    ).toBe('none')
    expect(
      await geniusLyrics(
        async () => new Response('', { status: 401 }),
        't',
        track('Sumo', 'Hi-C'),
        'u'
      )
    ).toBeNull()
    expect(
      await geniusLyrics(
        async () => {
          throw new Error('offline')
        },
        't',
        track('Sumo', 'Hi-C'),
        'u'
      )
    ).toBeNull()
  })
})
