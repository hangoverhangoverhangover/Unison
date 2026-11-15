// Relay clock estimate from ping/pong pairs (NTP-style, one sample per round trip).

export interface ClockSample {
  rttMs: number
  offsetMs: number
}

/** Samples kept; the lowest-RTT one of these wins. */
export const CLOCK_SAMPLES = 5

/**
 * One ping sent at local `t`, answered with `serverTime`, received at local `receivedAt`.
 * Assumes the relay stamped it halfway through the round trip.
 */
export function clockSample(t: number, serverTime: number, receivedAt: number): ClockSample {
  const rttMs = Math.max(0, receivedAt - t)
  return { rttMs, offsetMs: serverTime - (t + rttMs / 2) }
}

/** Adds a sample, keeping the last CLOCK_SAMPLES. */
export function addSample(samples: readonly ClockSample[], s: ClockSample): ClockSample[] {
  return [...samples, s].slice(-CLOCK_SAMPLES)
}

/** Offset of the lowest-RTT sample (rounded to whole ms), or 0 with none. */
export function bestOffset(samples: readonly ClockSample[]): number {
  let best: ClockSample | undefined
  for (const s of samples) if (!best || s.rttMs < best.rttMs) best = s
  return best ? Math.round(best.offsetMs) : 0
}
