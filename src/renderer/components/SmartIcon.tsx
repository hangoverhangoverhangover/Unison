import { Clock3, Repeat, Sparkles } from 'lucide-react'
import type { SmartPlaylistKind } from '@shared/history'
import { SMART_META } from '@renderer/lib/smart'

/** Gradient cover with an icon for a history-built playlist. */
export default function SmartIcon({
  kind,
  size = 20
}: {
  kind: SmartPlaylistKind
  size?: number
}): React.JSX.Element {
  const Icon = kind === 'recent' ? Clock3 : kind === 'on-repeat' ? Repeat : Sparkles
  return (
    <div
      className={`flex size-full items-center justify-center bg-gradient-to-br ${SMART_META[kind].gradient} text-white`}
    >
      <Icon size={size} strokeWidth={1.5} />
    </div>
  )
}
