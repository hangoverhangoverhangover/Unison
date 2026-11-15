import type { TrackComment } from '@shared/provider'

/** "12 comments", counting replies too. */
export function commentCountLabel(list: TrackComment[]): string {
  const n = list.reduce((sum, c) => sum + 1 + (c.replies?.length ?? 0), 0)
  return `${n} ${n === 1 ? 'comment' : 'comments'}`
}
