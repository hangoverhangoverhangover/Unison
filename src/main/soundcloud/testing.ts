// Test helpers (not shipped code paths): fake cookie jar, login window and a routed fetch.
import { vi } from 'vitest'
import { memorySettings, scriptedFetch, type Call, type ScriptedFetch } from '../spotify/testing'
import { CLIENT_ID_KEY } from './clientId'
import type { CookieJar, LoginWindow } from './session'

export { json, memorySettings, rejection } from '../spotify/testing'
export type { Call } from '../spotify/testing'

export const CID = 'a'.repeat(32)
export const CID2 = 'b'.repeat(32)

export type FakeJar = CookieJar & {
  token: string | undefined
  datadome: string | undefined
  /** Sets the oauth_token cookie and fires change listeners (sync; the promise is for CookieJar). */
  setToken(t: string | undefined): Promise<void>
  cleared: number
}

export function fakeJar(token?: string): FakeJar {
  const listeners = new Set<() => void>()
  const jar: FakeJar = {
    token,
    datadome: undefined,
    cleared: 0,
    getToken: async () => jar.token,
    getDataDome: async () => jar.datadome,
    onTokenChange(l) {
      listeners.add(l)
      return () => void listeners.delete(l)
    },
    async clear() {
      jar.cleared++
      jar.token = undefined
      jar.datadome = undefined
    },
    setToken(t) {
      jar.token = t
      for (const l of listeners) l()
      return Promise.resolve()
    }
  }
  return jar
}

export type FakeWindow = LoginWindow & { userClose(): void; closeCalls: number; focusCalls: number }

export function fakeWindow(): FakeWindow {
  let resolve!: () => void
  const closed = new Promise<void>((r) => (resolve = r))
  const win: FakeWindow = {
    closed,
    closeCalls: 0,
    focusCalls: 0,
    close() {
      win.closeCalls++
      resolve()
    },
    focus() {
      win.focusCalls++
    },
    userClose: () => resolve()
  }
  return win
}

/** Settings with a cached client_id so tests don't scrape unless they want to. */
export function settingsWithClientId(id = CID): ReturnType<typeof memorySettings> {
  const s = memorySettings()
  s.set(CLIENT_ID_KEY, JSON.stringify(id))
  return s
}

/** Routed fetch: one handler for every call. */
export function routedFetch(
  handler: (call: Call, url: URL) => Response | Promise<Response>
): ScriptedFetch {
  return scriptedFetch((call) => handler(call, new URL(call.url)))
}

export const silentLog = { warn: vi.fn() }
