// Leading + trailing throttle: the first call runs at once, later calls inside the window
// collapse into one run at the end of it.

export interface Throttle {
  fire(): void
  /** Drops a pending trailing run. */
  cancel(): void
}

export function createThrottle(fn: () => void, intervalMs: number, now: () => number): Throttle {
  let last = -Infinity
  let timer: ReturnType<typeof setTimeout> | undefined

  const run = (): void => {
    timer = undefined
    last = now()
    fn()
  }

  return {
    fire() {
      if (timer !== undefined) return
      const wait = last + intervalMs - now()
      if (wait <= 0) run()
      else timer = setTimeout(run, wait)
    },
    cancel() {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
    }
  }
}
