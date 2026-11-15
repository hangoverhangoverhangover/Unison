import { Copy } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { SpotifyClientIdSetting } from '@shared/spotify'
import { ipcMessage } from '@renderer/state/services'

const REDIRECT_URI = 'http://127.0.0.1/callback'

/**
 * Settings → Spotify: use your own Spotify developer app. Spotify only lets
 * accounts allow-listed on an app (or its owner) log in while it's in Development
 * Mode, so each person brings their own Client ID. Applies after a restart.
 */
export default function SpotifyClientIdForm(): React.JSX.Element {
  const [setting, setSetting] = useState<SpotifyClientIdSetting | null>(null)
  const [value, setValue] = useState('')
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string>()
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    void window.api.invoke('spotify:getClientId').then((s) => {
      setSetting(s)
      setValue(s.clientId)
      setOpen(s.source === 'none')
    })
  }, [])

  const save = async (id: string): Promise<void> => {
    setError(undefined)
    try {
      const s = await window.api.invoke('spotify:setClientId', id)
      setSetting(s)
      setValue(s.clientId)
    } catch (err) {
      setError(ipcMessage(err))
    }
  }

  const sourceLine =
    setting?.source === 'settings'
      ? 'Using your own Client ID.'
      : setting?.source === 'build'
        ? 'Using the Client ID this app was built with.'
        : 'No Client ID yet. Add yours to use Spotify.'

  return (
    <div className="mt-4 rounded-lg bg-raised/40 p-4 text-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-text-subdued">{setting ? sourceLine : 'Checking…'}</p>
        {!open && (
          <button
            onClick={() => setOpen(true)}
            className="font-bold text-text-subdued hover:text-text"
          >
            Use your own Client ID
          </button>
        )}
      </div>

      {setting?.needsRestart && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-md bg-accent/15 p-3">
          <span>
            Restart the app to use the new Client ID. You&apos;ll log in to Spotify again.
          </span>
          <button
            onClick={() => void window.api.invoke('app:relaunch')}
            className="flex-none rounded-md bg-accent px-3 py-1.5 font-bold text-on-accent hover:bg-accent-hover"
          >
            Restart now
          </button>
        </div>
      )}

      {open && (
        <>
          <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-text-subdued">
            <li>
              Go to <span className="text-text">developer.spotify.com/dashboard</span>, log in and
              choose <span className="text-text">Create app</span>. Spotify requires Premium for the
              app&apos;s owner.
            </li>
            <li>
              Under APIs used, tick <span className="text-text">Web API</span> and{' '}
              <span className="text-text">Web Playback SDK</span>.
            </li>
            <li>
              Add this Redirect URI exactly:{' '}
              <button
                onClick={() =>
                  void navigator.clipboard.writeText(REDIRECT_URI).then(() => setCopied(true))
                }
                className="inline-flex items-center gap-1 rounded bg-raised px-1.5 py-0.5 font-mono text-xs text-text hover:ring-1 hover:ring-text-muted"
                title="Copy"
              >
                {REDIRECT_URI} <Copy size={11} />
              </button>
              {copied && <span className="ml-2 text-xs">Copied</span>}
            </li>
            <li>Save, then copy the app&apos;s Client ID and paste it here.</li>
          </ol>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void save(value)
            }}
          >
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Client ID (32 letters and numbers)"
              aria-label="Spotify Client ID"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-lg bg-raised px-3 py-2 font-mono text-sm text-text outline-none ring-1 ring-divider placeholder:font-sans placeholder:text-text-muted focus:ring-2 focus:ring-accent"
            />
            <button
              type="submit"
              disabled={!setting}
              className="rounded-md bg-accent px-4 py-2 font-bold text-on-accent hover:bg-accent-hover disabled:opacity-40"
            >
              Save
            </button>
            {setting?.source === 'settings' && (
              <button
                type="button"
                onClick={() => void save('')}
                className="rounded-md px-3 py-2 font-bold text-text-subdued hover:text-text"
                title="Go back to the Client ID the app was built with"
              >
                Clear
              </button>
            )}
          </form>
          <p className="mt-2 text-xs text-text-subdued">
            A Client ID isn&apos;t a password; this app never needs a Client Secret. Changing it
            signs you out of Spotify.
          </p>
        </>
      )}
      {error && <p className="mt-2 text-danger">{error}</p>}
    </div>
  )
}
