import { useCallback, useEffect, useState } from 'react'
import type { FeedItem } from '@shared/soundcloud'
import { ipcMessage, useSoundCloud } from '@renderer/state/services'
import { useUi } from '@renderer/state/ui'
import { GhostButton, Message } from '@renderer/components/CollectionView'
import FeedList from '@renderer/components/FeedList'

/** SoundCloud feed: new uploads and reposts from people you follow. */
export default function FeedView(): React.JSX.Element {
  const connected = useSoundCloud((s) => s.status?.state === 'connected')
  const setView = useUi((s) => s.setView)
  const [items, setItems] = useState<FeedItem[]>([])
  const [next, setNext] = useState<string>()
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()

  const load = useCallback(async (cursor?: string): Promise<void> => {
    setLoading(true)
    setError(undefined)
    try {
      const page = await window.api.invoke('soundcloud:getFeed', cursor)
      setItems((prev) => (cursor ? [...prev, ...page.items] : page.items))
      setNext(page.next)
      setLoaded(true)
    } catch (err) {
      setError(ipcMessage(err))
    } finally {
      setLoading(false)
    }
  }, [])

  // First page: state is only set when the answer arrives.
  useEffect(() => {
    if (!connected) return
    let cancelled = false
    window.api.invoke('soundcloud:getFeed').then(
      (page) => {
        if (cancelled) return
        setItems(page.items)
        setNext(page.next)
        setLoaded(true)
      },
      (err: unknown) => !cancelled && setError(ipcMessage(err))
    )
    return () => {
      cancelled = true
    }
  }, [connected])

  return (
    <div className="relative h-full overflow-y-auto page-fade pb-page px-2 pt-8">
      <header className="flex items-end justify-between px-4 pt-4 pb-2">
        <div>
          <h1 className="text-[32px] leading-10 font-black">Feed</h1>
          <p className="mt-1 text-sm text-text-subdued">
            New uploads and reposts from people you follow on SoundCloud.
          </p>
        </div>
        {connected && (
          <button
            onClick={() => void load()}
            disabled={loading}
            className="text-sm font-bold text-text-subdued hover:text-text disabled:opacity-40"
          >
            {loading && !next ? 'Refreshing…' : 'Refresh'}
          </button>
        )}
      </header>
      {!connected ? (
        <Message
          title="Log in to SoundCloud to see your feed"
          body="Your feed comes from the people you follow."
        >
          <GhostButton onClick={() => setView('settings')}>Open Settings</GhostButton>
        </Message>
      ) : error && items.length === 0 ? (
        <Message title="Couldn't load your feed" body={error} />
      ) : loaded && items.length === 0 ? (
        <Message
          title="Nothing in your feed yet"
          body="Follow people on SoundCloud (from their profile here) and their uploads and reposts show up."
        />
      ) : (
        <>
          <FeedList items={items} />
          {error && <p className="px-4 pt-2 text-sm text-danger">{error}</p>}
          {next && (
            <div className="flex justify-center py-4">
              <button
                disabled={loading}
                onClick={() => void load(next)}
                className="rounded-full px-4 py-2 text-sm font-bold text-text-subdued ring-1 ring-text-muted transition-colors duration-[140ms] hover:text-text hover:ring-text disabled:opacity-40"
              >
                {loading ? 'Loading…' : 'Show more'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
