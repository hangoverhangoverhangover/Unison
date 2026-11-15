import { useEffect } from 'react'
import type { SmartPlaylistKind } from '@shared/history'
import { SMART_META } from '@renderer/lib/smart'
import { useHistory } from '@renderer/state/history'
import CollectionView, { Message } from '@renderer/components/CollectionView'
import SmartIcon from '@renderer/components/SmartIcon'

/** A playlist built from your play history (`smart:<kind>`). */
export default function SmartView({ kind }: { kind: SmartPlaylistKind }): React.JSX.Element {
  const load = useHistory((s) => s.smart[kind])
  const fetch = useHistory((s) => s.loadSmart)
  useEffect(() => {
    void fetch(kind)
  }, [kind, fetch])
  const meta = SMART_META[kind]
  const data = load?.state === 'ok' ? load.data : undefined
  return (
    <CollectionView
      key={kind}
      kicker="From your listening"
      title={meta.name}
      filterLabel={`Search in ${meta.name}`}
      cover={<SmartIcon kind={kind} size={64} />}
      tracks={data?.tracks ?? []}
      subtitle={data?.description}
      loading={!load || load.state === 'loading' || load.state === 'idle'}
      error={load?.state === 'error' ? load.error : undefined}
      empty={<Message title="Nothing here yet" body={meta.empty} />}
    />
  )
}
