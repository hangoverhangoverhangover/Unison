import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { ipcMessage, useSoundCloud } from '@renderer/state/services'

/**
 * Fallback login: paste the `oauth_token` cookie from soundcloud.com in the user's own
 * browser. For when SoundCloud's bot check blocks the built-in login window.
 */
export default function SoundCloudTokenForm(): React.JSX.Element | null {
  const connected = useSoundCloud((s) => s.status?.state === 'connected')
  const applyStatus = useSoundCloud((s) => s.applyStatus)
  const [open, setOpen] = useState(false)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  if (connected) return null

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      applyStatus(await window.api.invoke('soundcloud:loginWithToken', token))
      setToken('')
      setOpen(false)
    } catch (err) {
      setError(ipcMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 max-w-2xl">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-1 text-sm font-bold text-text-subdued transition-colors duration-[140ms] hover:text-text"
      >
        Login window blocked? Connect with a token instead
        <ChevronDown
          size={14}
          className={`transition-transform duration-[220ms] ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <form onSubmit={(e) => void submit(e)} className="mt-3 rounded-lg bg-raised/50 p-4">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-text-subdued">
            <li>In your normal browser, open soundcloud.com and log in.</li>
            <li>
              Press F12, open the <b className="text-text">Application</b> tab, then{' '}
              <b className="text-text">Cookies → https://soundcloud.com</b>.
            </li>
            <li>
              Find <b className="text-text">oauth_token</b>, copy its Value, and paste it below.
            </li>
          </ol>
          <p className="mt-2 text-xs text-text-muted">
            The token gives full access to your SoundCloud account. It stays on this PC, inside the
            app&apos;s SoundCloud session, and lasts about a year.
          </p>
          <div className="mt-3 flex gap-2">
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste oauth_token value"
              aria-label="SoundCloud oauth_token"
              autoComplete="off"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-lg bg-raised px-3 py-2 text-sm text-text outline-none ring-1 ring-divider focus:ring-2 focus:ring-accent"
            />
            <button
              type="submit"
              disabled={busy || token.trim() === ''}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-bold text-on-accent transition-colors duration-[140ms] hover:bg-accent-hover disabled:opacity-40"
            >
              {busy ? 'Checking…' : 'Connect'}
            </button>
          </div>
          {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        </form>
      )}
    </div>
  )
}
