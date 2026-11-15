// Test helpers (not shipped code paths): scripted fetch and in-memory stores.
import type { FetchFn } from './auth'
import type { SecretBox, SettingsStore } from './tokens'

export type ScriptedFetch = FetchFn & { calls: Call[] }

/** Resolves with the rejection reason; fails if the promise resolves. */
export async function rejection<E = Error>(p: Promise<unknown>): Promise<E> {
  try {
    await p
  } catch (err) {
    return err as E
  }
  throw new Error('expected the promise to reject')
}

export interface Call {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
}

export type Responder = (call: Call) => Response | Promise<Response>

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? '' : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  })
}

/** Fetch that answers from a list of responders in order (the last one repeats). */
export function scriptedFetch(...responders: Responder[]): ScriptedFetch {
  const calls: Call[] = []
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? init.body : undefined
    }
    calls.push(call)
    const r = responders[Math.min(calls.length - 1, responders.length - 1)]
    if (!r) throw new Error('no responder')
    return r(call)
  }) as FetchFn & { calls: Call[] }
  fn.calls = calls
  return fn
}

export function memorySettings(): SettingsStore & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    get: (k) => data.get(k),
    set: (k, v) => void data.set(k, v),
    delete: (k) => void data.delete(k)
  }
}

/** Reversible fake "encryption" so tests can check plaintext never lands in settings. */
export function fakeBox(available = true): SecretBox {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (s) => Buffer.from(s, 'utf8').reverse(),
    decryptString: (b) => Buffer.from(b).reverse().toString('utf8')
  }
}
