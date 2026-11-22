// Test-only fakes for the Web Audio graph (audioGraph.test.ts, audioBackend.test.ts).
// Not imported by app code.

import type { AudioContextLike } from './audioGraph'

export class FakeParam {
  value: number
  curves: { curve: Float32Array; durationS: number }[] = []
  targets: { value: number; timeConstant: number }[] = []
  constructor(value = 1) {
    this.value = value
  }
  setTargetAtTime(v: number, _t: number, timeConstant: number): this {
    this.value = v
    this.targets.push({ value: v, timeConstant })
    return this
  }
  setValueAtTime(v: number): this {
    this.value = v
    return this
  }
  cancelScheduledValues(): this {
    return this
  }
  setValueCurveAtTime(curve: Float32Array, _t: number, durationS: number): this {
    this.curves.push({ curve, durationS })
    this.value = curve[curve.length - 1] ?? this.value
    return this
  }
}

export class FakeNode {
  out: FakeNode[] = []
  constructor(public kind: string) {}
  connect<T>(n: T): T {
    this.out.push(n as unknown as FakeNode)
    return n
  }
  disconnect(): void {
    this.out = []
  }
}

export class FakeGain extends FakeNode {
  gain = new FakeParam(1)
  constructor() {
    super('gain')
  }
}

export class FakeBiquad extends FakeNode {
  type = 'lowpass'
  frequency = new FakeParam(350)
  Q = new FakeParam(1)
  gain = new FakeParam(0)
  constructor() {
    super('biquad')
  }
}

export class FakeCompressor extends FakeNode {
  threshold = new FakeParam(-24)
  ratio = new FakeParam(12)
  knee = new FakeParam(30)
  attack = new FakeParam(0.003)
  release = new FakeParam(0.25)
  constructor() {
    super('compressor')
  }
}

export class FakeAnalyser extends FakeNode {
  fftSize = 2048
  /** Constant sample value returned by getFloatTimeDomainData (RMS = |amplitude|). */
  amplitude = 0
  constructor() {
    super('analyser')
  }
  smoothingTimeConstant = 0.8
  getFloatTimeDomainData(buf: Float32Array): void {
    buf.fill(this.amplitude)
  }
  getByteFrequencyData(buf: Uint8Array): void {
    buf.fill(0)
  }
}

export class FakeSource extends FakeNode {
  constructor(public element: unknown) {
    super('source')
  }
}

export class FakeAudioContext {
  state: AudioContextState = 'running'
  currentTime = 0
  resumes = 0
  destination = new FakeNode('destination')
  gains: FakeGain[] = []
  filters: FakeBiquad[] = []
  compressors: FakeCompressor[] = []
  analysers: FakeAnalyser[] = []
  sources: FakeSource[] = []
  createGain(): FakeGain {
    const g = new FakeGain()
    this.gains.push(g)
    return g
  }
  createBiquadFilter(): FakeBiquad {
    const f = new FakeBiquad()
    this.filters.push(f)
    return f
  }
  createDynamicsCompressor(): FakeCompressor {
    const c = new FakeCompressor()
    this.compressors.push(c)
    return c
  }
  createAnalyser(): FakeAnalyser {
    const a = new FakeAnalyser()
    this.analysers.push(a)
    return a
  }
  createMediaElementSource(el: unknown): FakeSource {
    const s = new FakeSource(el)
    this.sources.push(s)
    return s
  }
  resume(): Promise<void> {
    this.resumes++
    this.state = 'running'
    return Promise.resolve()
  }
  asContext(): AudioContextLike {
    return this as unknown as AudioContextLike
  }
  /** The deck gain an element is routed through, if it is wired. */
  deckGainOf(el: unknown): FakeGain | undefined {
    return this.sources.find((s) => s.element === el)?.out[0] as FakeGain | undefined
  }
}
