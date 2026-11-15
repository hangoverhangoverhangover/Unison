import { Music } from 'lucide-react'
import { useState } from 'react'

/** Square artwork with a quiet placeholder when there's no art or it fails to load. */
export default function Artwork({
  src,
  size,
  className = ''
}: {
  src?: string
  size: number
  className?: string
}): React.JSX.Element {
  const [failed, setFailed] = useState<string | undefined>()
  const show = src && failed !== src
  return (
    <div
      className={`relative flex-none overflow-hidden rounded-sm bg-raised ${className}`}
      style={{ width: size, height: size }}
    >
      {show ? (
        <img
          src={src}
          alt=""
          draggable={false}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(src)}
          className="size-full object-cover"
        />
      ) : (
        <div className="flex size-full items-center justify-center text-text-muted">
          <Music size={Math.round(size * 0.4)} strokeWidth={1.75} />
        </div>
      )}
    </div>
  )
}
