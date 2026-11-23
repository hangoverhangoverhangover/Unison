import { ExternalLink } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ipcMessage } from '@renderer/state/services'

const input =
  'min-w-0 flex-1 rounded-lg bg-raised px-3 py-2 font-mono text-sm text-text outline-none ring-1 ring-divider placeholder:font-sans placeholder:text-text-muted focus:ring-2 focus:ring-accent'
const ghost =
  'rounded-lg px-3 py-1.5 text-sm font-semibold text-text-subdued transition-colors duration-[140ms] hover:bg-raised hover:text-text disabled:opacity-40'

/**
 * Settings → Accounts → Genius (QoL 4): your own API token, so songs LRCLIB has no
 * lyrics for can get them from Genius. Encrypted in main; never shown again.
 */
export default function GeniusSection(): React.JSX.Element {
  const [has, setHas] = useState<boolean | null>(null)
  const [token, setToken] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [check, setCheck] = useState<string>()

  const test = async (): Promise<void> => {
    setCheck('Checking…')
    setCheck(await window.api.invoke('genius:test').catch((err) => ipcMessage(err)))
  }

  useEffect(() => {
    void window.api.invoke('genius:hasToken').then(setHas)
  }, [])

  const save = async (value: string | null): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      const saved = await window.api.invoke('genius:setToken', value)
      setHas(saved)
      setToken('')
      setCheck(undefined)
      if (saved) void test()
    } catch (err) {
      setError(ipcMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="settings-card">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Genius</h2>
          <p className="text-sm text-text-subdued">
            Backup lyrics: asked only when LRCLIB has none. They aren&apos;t synced, so you can sync
            them yourself.
          </p>
        </div>
        {has && (
          <div className="flex gap-1">
            <button className={ghost} disabled={busy} onClick={() => void test()}>
              Test token
            </button>
            <button className={ghost} disabled={busy} onClick={() => void save(null)}>
              Remove token
            </button>
          </div>
        )}
      </div>
      {has ? (
        <p
          role="status"
          className={`mt-3 text-sm ${check && check !== 'Token works.' && check !== 'Checking…' ? 'text-danger' : 'text-text-subdued'}`}
        >
          {check ?? 'Token saved. Genius is on.'}
        </p>
      ) : (
        <>
          <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-text-subdued">
            <li>
              Create an API client on Genius:{' '}
              <a
                href="https://genius.com/api-clients"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-semibold text-text hover:underline"
              >
                genius.com/api-clients <ExternalLink size={12} />
              </a>
              . Any name and website work.
            </li>
            <li>Generate a client access token and paste it here.</li>
          </ol>
          <div className="mt-3 flex gap-2">
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Client access token"
              aria-label="Genius client access token"
              className={input}
            />
            <button
              disabled={busy || !token.trim()}
              onClick={() => void save(token)}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-bold text-on-accent transition-colors duration-[140ms] hover:bg-accent-hover disabled:opacity-40"
            >
              Save
            </button>
          </div>
        </>
      )}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </section>
  )
}
