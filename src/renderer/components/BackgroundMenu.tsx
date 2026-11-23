import * as ContextMenu from '@radix-ui/react-context-menu'
import { ChevronRight, ImagePlus } from 'lucide-react'
import { scopesFor } from '@shared/player'
import type { Track } from '@shared/types'
import { usePlayerPage } from '@renderer/state/playerPage'

const ITEM =
  'flex items-center gap-2 rounded-md px-3 py-2 outline-none data-[highlighted]:bg-raised-hover data-[disabled]:opacity-40'
const MENU = 'glass-strong z-50 min-w-52 max-w-72 rounded-xl p-1 text-md'

/**
 * "Player background" submenu: pick pictures, GIFs or videos for this song, its
 * artist, its album, or every song. Goes inside a Radix context menu.
 */
export default function BackgroundMenu({ track }: { track: Track | null }): React.JSX.Element {
  const add = usePlayerPage((s) => s.add)
  return (
    <ContextMenu.Sub>
      <ContextMenu.SubTrigger className={`${ITEM} data-[state=open]:bg-white/10`}>
        <ImagePlus size={14} />
        Add Player background
        <ChevronRight size={14} className="ml-auto text-text-subdued" />
      </ContextMenu.SubTrigger>
      <ContextMenu.Portal>
        <ContextMenu.SubContent className={MENU}>
          <ContextMenu.Label className="px-3 pt-1.5 pb-1 text-xs text-text-muted">
            Picture, GIF or video for
          </ContextMenu.Label>
          {scopesFor(track).map((s) => (
            <ContextMenu.Item key={s.label} className={ITEM} onSelect={() => void add(s.scope)}>
              <span className="truncate">{s.label}</span>
            </ContextMenu.Item>
          ))}
        </ContextMenu.SubContent>
      </ContextMenu.Portal>
    </ContextMenu.Sub>
  )
}
