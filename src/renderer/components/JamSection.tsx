import { useEffect, useState } from 'react'
import type { AppPrefs } from '@shared/config'
import type { JamUnplayable } from '@shared/jam'
import { ipcMessage } from '@renderer/state/services'

const UNPLAYABLE: { key: JamUnplayable; label: string; body: string }[] = [
  {
    key: 'match',
    label: 'Find it on the other service',
    body: 'Play the same song from SoundCloud or Spotify instead, and show which version you hear.'
  },
  {
    key: 'skip',
    label: 'Skip it for me',
    body: 'Stay quiet for that track and rejoin on the next one.'
  },
  {
    key: 'block',
    label: 'Only allow tracks everyone can play',
    body: 'When you host, songs someone in the Jam can’t play can’t be added.'
  }
]

const inputClass =
  'w-full rounded-lg bg-raised px-3 py-2 text-sm text-text outline-none ring-1 ring-divider placeholder:text-text-muted focus:ring-2 focus:ring-accent'

/** Settings: Jam relay URL, your name in a Jam, and the unplayable-track behaviour. */
export default function JamSection(): React.JSX.Element {
  const [prefs, setPrefs] = useState<AppPrefs | null>(null)
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string>()
  const [saved, setSaved] = useState(false)
  const [builtIn, setBuiltIn] = useState('')

  useEffect(() => {
    void window.api.invoke('config:getPublic').then((c) => setBuiltIn(c.defaultJamRelayUrl))
    void window.api.invoke('prefs:get').then((p) => {
      setPrefs(p)
      setUrl(p.jamRelayUrl)
      setName(p.jamName)
    })
  }, [])

  const save = async (patch: Partial<AppPrefs>): Promise<void> => {
    setError(undefined)
    setSaved(false)
    try {
      const next = await window.api.invoke('prefs:set', patch)
      setPrefs(next)
      setUrl(next.jamRelayUrl)
      setName(next.jamName)
      setSaved(true)
    } catch (err) {
      setError(ipcMessage(err))
    }
  }

  return (
    <section className="settings-card">
      <h2 className="pb-1 text-lg font-bold">Jam</h2>
      <p className="mt-3 text-sm text-text-subdued">
        Listen together over the internet. Everyone plays on their own accounts; the relay only
        shares the queue and the timing. The built-in relay works out of the box — leave Relay URL
        empty to use it. Everyone in a Jam needs to be on the same relay.
      </p>
      <form
        className="mt-4 grid grid-cols-[8rem_1fr] items-center gap-x-3 gap-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          void save({ jamRelayUrl: url.trim(), jamName: name.trim() })
        }}
      >
        <label htmlFor="jam-url" className="text-sm text-text-subdued">
          Relay URL
        </label>
        <input
          id="jam-url"
          value={url}
          disabled={!prefs}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={builtIn ? `Built-in: ${builtIn}` : 'https://your-relay.workers.dev'}
          className={inputClass}
        />
        <label htmlFor="jam-name" className="text-sm text-text-subdued">
          Your name
        </label>
        <input
          id="jam-name"
          value={name}
          maxLength={40}
          disabled={!prefs}
          onChange={(e) => setName(e.target.value)}
          placeholder="Shown to others in a Jam"
          className={inputClass}
        />
        <span />
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={!prefs}
            className="rounded-md bg-accent px-4 py-2 text-sm font-bold text-on-accent hover:bg-accent-hover disabled:opacity-40"
          >
            Save
          </button>
          {saved && <span className="text-sm text-text-subdued">Saved.</span>}
        </div>
      </form>

      <fieldset className="mt-5">
        <legend className="text-sm font-bold">When someone can&apos;t play a track</legend>
        <div className="mt-2 flex flex-col gap-1">
          {UNPLAYABLE.map((o) => (
            <label
              key={o.key}
              className={`flex cursor-pointer gap-3 rounded-lg p-3 transition-colors duration-[140ms] ${prefs?.jamUnplayable === o.key ? 'bg-raised' : 'hover:bg-raised/50'}`}
            >
              <input
                type="radio"
                name="jam-unplayable"
                checked={prefs?.jamUnplayable === o.key}
                disabled={!prefs}
                onChange={() => void save({ jamUnplayable: o.key })}
                className="mt-1 accent-[var(--color-accent)]"
              />
              <span>
                <span className="block text-sm font-bold">{o.label}</span>
                <span className="block text-sm text-text-subdued">{o.body}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </section>
  )
}
