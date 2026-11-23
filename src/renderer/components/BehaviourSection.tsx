import { useEffect, useState } from 'react'
import type { AppPrefs } from '@shared/config'
import { SHORTCUTS } from '@renderer/lib/shortcuts'
import { ipcMessage } from '@renderer/state/services'
import Switch from './Switch'
import DiscordRow from './DiscordSection'
import MiniPlayerSection from './MiniPlayerSection'
import { useAddCheck } from '@renderer/state/addCheck'

function Row({
  title,
  body,
  children
}: {
  title: string
  body: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-6 py-3">
      <div>
        <p className="font-bold">{title}</p>
        <p className="text-sm text-text-subdued">{body}</p>
      </div>
      {children}
    </div>
  )
}

/** Ask before adding songs a playlist already has (QoL 4; saved on this computer). */
function AskDuplicatesRow(): React.JSX.Element {
  const ask = useAddCheck((s) => s.ask)
  const setAsk = useAddCheck((s) => s.setAsk)
  return (
    <Row
      title="Ask before adding duplicates"
      body="When a song you add to a playlist is already in it (or the same song from another service), ask first."
    >
      <Switch label="Ask before adding duplicates" checked={ask} onChange={setAsk} />
    </Row>
  )
}

/** Settings → General: close to tray, auto-download likes, Discord. */
export function BehaviourSection(): React.JSX.Element {
  const [prefs, setPrefs] = useState<AppPrefs | null>(null)
  const [error, setError] = useState<string>()
  useEffect(() => {
    void window.api.invoke('prefs:get').then(setPrefs)
    return window.api.on('prefs:changed', setPrefs)
  }, [])
  const set = async (patch: Partial<AppPrefs>): Promise<void> => {
    setError(undefined)
    try {
      setPrefs(await window.api.invoke('prefs:set', patch))
    } catch (err) {
      setError(ipcMessage(err))
    }
  }
  return (
    <section className="settings-card">
      <h2 className="pb-1 text-lg font-bold">General</h2>
      <Row
        title="Close to tray"
        body="Closing the window keeps the music playing. Use the tray icon to bring it back or quit."
      >
        <Switch
          label="Close to tray"
          checked={!!prefs?.closeToTray}
          disabled={!prefs}
          onChange={(v) => void set({ closeToTray: v })}
        />
      </Row>
      <Row
        title="Download new SoundCloud likes"
        body="Tracks you like on SoundCloud from now on are downloaded in the background to your download folder."
      >
        <Switch
          label="Download new SoundCloud likes"
          checked={!!prefs?.autoDownloadLikes}
          disabled={!prefs}
          onChange={(v) => void set({ autoDownloadLikes: v })}
        />
      </Row>
      <MiniPlayerSection prefs={prefs} set={set} />
      <AskDuplicatesRow />
      <Row
        title="Tidy SoundCloud titles"
        body="Archive uploads like “Artist - Title” show and scrobble with the real artist and title. Right-click a song to fix a wrong guess."
      >
        <Switch
          label="Tidy SoundCloud titles"
          checked={!!prefs?.tidyScTitles}
          disabled={!prefs}
          onChange={(v) => void set({ tidyScTitles: v })}
        />
      </Row>
      <DiscordRow />
      <Row
        title="Local cover art on Discord"
        body="Shows your files’ own covers on Discord. A small copy passes through Unison’s relay and is deleted when the song changes."
      >
        <Switch
          label="Local cover art on Discord"
          checked={!!prefs?.discordLocalArt}
          disabled={!prefs}
          onChange={(v) => void set({ discordLocalArt: v })}
        />
      </Row>
      {error && <p className="text-sm text-danger">{error}</p>}
    </section>
  )
}

/** Settings: the keyboard shortcut cheat sheet. */
export function ShortcutsSection(): React.JSX.Element {
  return (
    <section className="settings-card">
      <h2 className="pb-1 text-lg font-bold">Keyboard shortcuts</h2>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        {SHORTCUTS.map((s) => (
          <div key={s.action} className="contents">
            <dt className="flex gap-1">
              {s.keys.map((k) => (
                <kbd
                  key={k}
                  className="min-w-7 rounded-md border border-divider bg-raised px-1.5 py-0.5 text-center font-sans text-xs font-bold text-text"
                >
                  {k}
                </kbd>
              ))}
            </dt>
            <dd className="text-text-subdued">{s.action}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
