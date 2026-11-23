import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: {} }))
const { busyFor, formatLine, redact } = await import('./diagLog')

describe('redact', () => {
  it('hides tokens, secrets and keys in URLs, JSON, headers and text', () => {
    expect(redact('wss://relay/rooms/K7Q2MX/ws?secret=abc123&x=1')).toBe(
      'wss://relay/rooms/K7Q2MX/ws?secret=[hidden]&x=1'
    )
    expect(redact('{"access_token":"ya29.abc","refreshToken": "r-1"}')).toBe(
      '{"access_token":"[hidden]","refreshToken": "[hidden]"}'
    )
    expect(redact('Authorization: Bearer abc.def-ghi')).toBe('Authorization: Bearer [hidden]')
    expect(redact('hostSecret=s3cr3t clientSecret: zzz')).toBe(
      'hostSecret=[hidden] clientSecret: [hidden]'
    )
    expect(redact('callback?code=AQB123&state=x')).toBe('callback?code=[hidden]&state=x')
    expect(redact('cookie=sid=1')).toBe('cookie=[hidden]')
    expect(redact('eyJhbGciOiJIUzI1NiJ9xx.eyJzdWIiOiIxMjM0NTY3ODkw.SflKxwRJSMeKKF2QT4')).toBe(
      '[hidden]'
    )
  })

  it('keeps ordinary text, numbers and close codes', () => {
    expect(redact('socket closed, code: 4404')).toBe('socket closed, code: 4404')
    expect(redact('exit code=1')).toBe('exit code=1')
    expect(redact('media:key next')).toBe('media:key next')
    expect(redact('jam: connection lost, retrying in 2s')).toBe(
      'jam: connection lost, retrying in 2s'
    )
  })
})

describe('formatLine', () => {
  it('stamps the time and level and indents extra lines', () => {
    const at = new Date('2026-11-23T10:00:00.000Z')
    expect(formatLine('warn', 'a\nb', at)).toBe('2026-11-23T10:00:00.000Z WARN  a\n    b\n')
    expect(formatLine('info', 'token=x', at)).toContain('token=[hidden]')
  })
})

describe('busyFor', () => {
  it('reports only real stalls', () => {
    expect(busyFor(1000, 1100)).toBeNull()
    expect(busyFor(1000, 4000)).toBe(3000)
  })
})
