import { Repeat2, UserCheck, UserPlus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { FeedItem } from '@shared/soundcloud'
import type { Artist, Track } from '@shared/types'
import { ipcMessage, useSoundCloud } from '@renderer/state/services'
import ConfirmButton from './ConfirmButton'
import FeedList from './FeedList'

/** Follow / Following on a SoundCloud profile (asks first: following is public). */
export function FollowButton({ artist }: { artist: Artist }): React.JSX.Element | null {
  const connected = useSoundCloud((s) => s.status?.state === 'connected')
  const [following, setFollowing] = useState<boolean>()
  useEffect(() => {
    if (!connected) return
    let cancelled = false
    window.api.invoke('soundcloud:isFollowing', artist.nativeId).then(
      (v) => !cancelled && setFollowing(v),
      () => undefined
    )
    return () => {
      cancelled = true
    }
  }, [connected, artist.nativeId])
  if (!connected || following === undefined) return null
  return (
    <ConfirmButton
      active={following}
      icon={following ? <UserCheck size={16} /> : <UserPlus size={16} />}
      label={following ? 'Following' : 'Follow'}
      question={
        following
          ? `Unfollow ${artist.name} on SoundCloud?`
          : `Follow ${artist.name} on SoundCloud? People can see who you follow.`
      }
      confirmLabel={following ? 'Unfollow' : 'Follow'}
      onConfirm={async () => {
        await window.api.invoke('soundcloud:setFollowing', artist.nativeId, !following)
        setFollowing(!following)
      }}
    />
  )
}

/** Repost / Reposted on a SoundCloud track (asks first: reposts are public). */
export function RepostButton({ track }: { track: Track }): React.JSX.Element | null {
  const connected = useSoundCloud((s) => s.status?.state === 'connected')
  const [reposted, setReposted] = useState<boolean>()
  useEffect(() => {
    if (!connected) return
    let cancelled = false
    window.api.invoke('soundcloud:isReposted', track.nativeId).then(
      (v) => !cancelled && setReposted(v),
      () => undefined
    )
    return () => {
      cancelled = true
    }
  }, [connected, track.nativeId])
  if (!connected || reposted === undefined) return null
  return (
    <ConfirmButton
      active={reposted}
      icon={<Repeat2 size={16} />}
      label={reposted ? 'Reposted' : 'Repost'}
      question={
        reposted
          ? 'Remove your repost?'
          : 'Repost this to your SoundCloud profile? Your followers will see it.'
      }
      confirmLabel={reposted ? 'Remove repost' : 'Repost'}
      onConfirm={async () => {
        await window.api.invoke('soundcloud:setReposted', track.nativeId, !reposted)
        setReposted(!reposted)
      }}
    />
  )
}

/** A SoundCloud profile's reposts (first page, then "Show more"). */
export function ProfileReposts({ userId }: { userId: string }): React.JSX.Element | null {
  const [items, setItems] = useState<FeedItem[]>([])
  const [next, setNext] = useState<string>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)

  const load = useCallback(
    async (cursor?: string): Promise<void> => {
      setLoading(true)
      try {
        const page = await window.api.invoke('soundcloud:getReposts', userId, cursor)
        setItems((prev) => (cursor ? [...prev, ...page.items] : page.items))
        setNext(page.next)
      } catch (err) {
        setError(ipcMessage(err))
      } finally {
        setLoading(false)
      }
    },
    [userId]
  )
  // First page: state is only set when the answer arrives.
  useEffect(() => {
    let cancelled = false
    window.api.invoke('soundcloud:getReposts', userId).then(
      (page) => {
        if (cancelled) return
        setItems(page.items)
        setNext(page.next)
      },
      (err: unknown) => !cancelled && setError(ipcMessage(err))
    )
    return () => {
      cancelled = true
    }
  }, [userId])

  if (items.length === 0 && !error) return null
  return (
    <section className="mt-8">
      <h2 className="px-4 text-xl font-bold">Reposts</h2>
      {error ? (
        <p className="px-4 pt-2 text-sm text-danger">{error}</p>
      ) : (
        <div className="mt-2 px-2">
          <FeedList items={items} showBy={false} />
          {next && (
            <button
              disabled={loading}
              onClick={() => void load(next)}
              className="mt-1 px-4 py-2 text-sm font-bold text-text-subdued hover:text-text disabled:opacity-40"
            >
              {loading ? 'Loading…' : 'Show more'}
            </button>
          )}
        </div>
      )}
    </section>
  )
}
