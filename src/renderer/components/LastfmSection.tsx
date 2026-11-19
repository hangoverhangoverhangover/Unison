import { ExternalLink } from 'lucide-react'
import { useEffect, useState } from 'react'
import { LASTFM_API_ACCOUNT_URL, type LastfmStatus } from '@shared/lastfm'
import { ipcMessage } from '@renderer/state/services'
import Switch from './Switch'

const input =
  'min-w-0 flex-1 rounded-lg bg-raised px-3 py-2 font-mono text-sm text-text outline-none ring-1 ring-divider placeholder:font-sans placeholder:text-text-muted focus:ring-2 focus:ring-accent'

/**
 * Settings → Accounts: Last.fm scrobbling with the user's own API account (an API key
 * and shared secret from last.fm/api). The secret stays in main, encrypted.
 */
export default function LastfmSection(): React.JSX.Element {
  const [status, setStatus] = useState<LastfmStatus | null>(null)
  const [editing, setEditing] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [secret, setSecret] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.api.invoke('lastfm:getStatus').then(setStatus)
    return window.api.on('lastfm:status', setStatus)
  }, [])

  const run = async (fn: () => Promise<LastfmStatus>): Promise<boolean> => {
    setBusy(true)
    setError(undefined)
    try {
      setStatus(await fn())
      return true
    } catch (err) {
      setError(ipcMessage(err))
      return false
    } finally {
      setBusy(false)
    }
  }

  const showForm = editing || (status !== null && !status.hasKeys)
  const state = status?.state
  const button =
    'rounded-md px-3 py-1.5 text-sm font-bold transition-colors duration-[140ms] disabled:opacity-40'

  return (
    <section className="settings-card">
      <div className="flex items-center justify-between pb-1">
        <h2 className="text-lg font-bold">Last.fm</h2>
        {status?.hasKeys &&
          !showForm &&
          (state === 'connected' ? (
            <button
              disabled={busy}
              onClick={() => void run(() => window.api.invoke('lastfm:disconnect'))}
              className={`${button} text-text-subdued hover:bg-raised hover:text-text`}
            >
              Log out
            </button>
          ) : state === 'authorizing' ? (
            <button
              disabled={busy}
              onClick={() => void run(() => window.api.invoke('lastfm:disconnect'))}
              className={`${button} text-text-subdued hover:bg-raised hover:text-text`}
            >
              Cancel
            </button>
          ) : (
            <button
              disabled={busy}
              onClick={() => void run(() => window.api.invoke('lastfm:connect'))}
              className={`${button} bg-accent text-on-accent hover:bg-accent-hover`}
            >
              {state === 'expired' ? 'Log in again' : 'Connect'}
            </button>
          ))}
      </div>

      <p className="mt-2 text-sm text-text-subdued" aria-live="polite">
        {!status
          ? 'Checking…'
          : state === 'connected'
            ? `Scrobbling as ${status.username ?? 'you'}: SoundCloud and local files${
                status.scrobbleSpotify ? ', and Spotify' : ''
              }.`
            : state === 'authorizing'
              ? 'Approve Unison on the Last.fm page that opened in your browser. This updates by itself.'
              : state === 'expired'
                ? 'Last.fm logged you out. Log in again to keep scrobbling.'
                : status.hasKeys
                  ? 'Connect to scrobble what you play on SoundCloud and from your files.'
                  : 'Scrobbling uses your own Last.fm API account, so nothing secret ships with Unison.'}
      </p>
      {status && status.pending > 0 && (
        <p className="mt-1 text-xs text-text-muted">
          {status.pending} {status.pending === 1 ? 'scrobble' : 'scrobbles'} waiting to be sent.
        </p>
      )}
      {(error ?? status?.error) && (
        <p className="mt-2 text-sm text-danger">{error ?? status?.error}</p>
      )}

      {showForm ? (
        <>
          <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-text-subdued">
            <li>
              Create a Last.fm API account:{' '}
              <a
                href={LASTFM_API_ACCOUNT_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-semibold text-text hover:underline"
              >
                last.fm/api/account/create <ExternalLink size={12} />
              </a>
              . Any application name works; leave the callback URL empty.
            </li>
            <li>Copy the API key and the shared secret it shows you into the fields below.</li>
          </ol>
          <form
            className="mt-3 flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void run(() => window.api.invoke('lastfm:setKeys', apiKey, secret)).then((ok) => {
                if (!ok) return
                setEditing(false)
                setApiKey('')
                setSecret('')
              })
            }}
          >
            <input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="API key"
              aria-label="Last.fm API key"
              spellCheck={false}
              className={input}
            />
            <input
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              type="password"
              placeholder="Shared secret"
              aria-label="Last.fm shared secret"
              spellCheck={false}
              className={input}
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={busy || !apiKey.trim() || !secret.trim()}
                className={`${button} bg-accent text-on-accent hover:bg-accent-hover`}
              >
                Save
              </button>
              {status?.hasKeys && (
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className={`${button} text-text-subdued hover:text-text`}
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        </>
      ) : (
        status?.hasKeys && (
          <>
            <div className="mt-3 flex items-center justify-between gap-6 py-2">
              <div>
                <p className="font-bold">Also scrobble Spotify</p>
                <p className="text-sm text-text-subdued">
                  Leave off if your Spotify account is linked to Last.fm: Spotify already scrobbles
                  itself, and both would count every song twice.
                </p>
              </div>
              <Switch
                label="Also scrobble Spotify"
                checked={status.scrobbleSpotify}
                onChange={(v) => void run(() => window.api.invoke('lastfm:setScrobbleSpotify', v))}
              />
            </div>
            <button
              onClick={() => setEditing(true)}
              className="mt-1 text-sm font-semibold text-text-subdued hover:text-text"
            >
              Use a different API account (key ends in …{status.keyHint})
            </button>
          </>
        )
      )}
    </section>
  )
}
