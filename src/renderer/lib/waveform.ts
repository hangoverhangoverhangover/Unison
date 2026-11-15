/**
 * Peak per bar (the loudest sample in each bucket keeps transients visible), then the
 * track's own quiet-to-loud range stretched to the full height. Loud masters otherwise
 * come out as a flat block of near-identical bars.
 */
export function bars(samples: number[], count: number): number[] {
  if (count <= 0 || samples.length === 0) return []
  const out = new Array<number>(count)
  const per = samples.length / count
  for (let i = 0; i < count; i++) {
    let max = 0
    const end = Math.min(samples.length, Math.ceil((i + 1) * per))
    for (let j = Math.floor(i * per); j < end; j++) max = Math.max(max, samples[j] ?? 0)
    out[i] = max
  }
  const sorted = [...out].sort((x, y) => x - y)
  const lo = sorted[Math.floor(sorted.length * 0.05)] ?? 0
  const hi = sorted[sorted.length - 1] ?? 1
  const span = hi - lo
  if (span < 0.02) return out.map(() => 0.6)
  return out.map((v) => 0.12 + 0.88 * Math.min(1, Math.max(0, (v - lo) / span)))
}

/**
 * Timed comments as markers along a `widthPx` wide waveform: sorted by time, and any
 * that would land within `minGapPx` of a marker's first comment join that marker.
 */
export function clusterMarkers<T extends { timestampMs: number }>(
  items: T[],
  durationMs: number,
  widthPx: number,
  minGapPx: number
): { x: number; items: T[] }[] {
  if (durationMs <= 0 || widthPx <= 0) return []
  const sorted = [...items].sort((a, b) => a.timestampMs - b.timestampMs)
  const out: { x: number; items: T[] }[] = []
  for (const item of sorted) {
    const x = Math.round(Math.min(widthPx, Math.max(0, (item.timestampMs / durationMs) * widthPx)))
    const last = out.at(-1)
    if (last && x - last.x < minGapPx) last.items.push(item)
    else out.push({ x, items: [item] })
  }
  return out
}
