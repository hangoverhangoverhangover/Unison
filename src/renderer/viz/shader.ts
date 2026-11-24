// The visualizer's "shader" style: the song cover (or a colour field when there is none)
// warped on the GPU by one of three fragment shaders, driven by the measured sound.
// Raw WebGL, one full-screen triangle, one draw call per frame.
import type { ShaderPreset, VizSettings } from '@renderer/state/playerPage'
import type { VizColors, VizFrame } from './types'

export interface ShaderRenderer {
  /** Draw one frame. w/h are the canvas size in device pixels (the host sets canvas.width/height). */
  draw(frame: VizFrame, settings: VizSettings, colors: VizColors, w: number, h: number): void
  /** Use this image (the song cover) as the texture to warp; null = no image, use a colour field from colors. */
  setCover(url: string | null): void
  dispose(): void
}

// ---- Pure helpers (tested) ----

export type Rgb = [number, number, number]

/** '#rrggbb' (or '#rgb') to 0..1 floats; anything else gives the fallback. */
export function parseHex(hex: string, fallback: Rgb = [1, 1, 1]): Rgb {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return fallback
  let s = m[1] ?? ''
  if (s.length === 3) s = s.replace(/./g, '$&$&')
  const n = parseInt(s, 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

/**
 * How much of the image to show on each axis so it covers the canvas without stretching:
 * texture uv = (uv - 0.5) * scale + 0.5. One axis is 1, the other is cropped (< 1).
 */
export function coverScale(imgW: number, imgH: number, w: number, h: number): [number, number] {
  if (imgW <= 0 || imgH <= 0 || w <= 0 || h <= 0) return [1, 1]
  const canvasAspect = w / h
  const imgAspect = imgW / imgH
  // Wider canvas than image: the image fills the width and its top/bottom are cropped.
  return canvasAspect > imgAspect ? [1, imgAspect / canvasAspect] : [canvasAspect / imgAspect, 1]
}

export const PRESET_INDEX: Record<ShaderPreset, number> = { liquid: 0, kaleidoscope: 1, warp: 2 }

/** Which compiled program a preset uses; unknown values fall back to liquid. */
export function presetIndex(preset: string): number {
  return (PRESET_INDEX as Record<string, number | undefined>)[preset] ?? 0
}

/** The sound-driven uniform values. Reused between frames (no allocation). */
export interface AudioUniforms {
  bass: number
  mid: number
  treble: number
  energy: number
  pulse: number
  intensity: number
  /** How fast shader time runs: full speed while playing, slow drift when paused. */
  speed: number
}

export function newAudioUniforms(): AudioUniforms {
  return { bass: 0, mid: 0, treble: 0, energy: 0, pulse: 0, intensity: 0.5, speed: 1 }
}

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0)

/** Map a frame and the settings onto the shader's uniforms. Paused: sound reads as silence. */
export function audioUniforms(
  frame: VizFrame,
  settings: VizSettings,
  out: AudioUniforms
): AudioUniforms {
  const on = frame.playing
  out.bass = on ? clamp01(frame.bass) : 0
  out.mid = on ? clamp01(frame.mid) : 0
  out.treble = on ? clamp01(frame.treble) : 0
  out.energy = on ? clamp01(frame.energy) : 0
  out.pulse = on ? clamp01(frame.pulse) : 0
  out.intensity = clamp01(settings.shaderIntensity)
  // Calm settings also move slower, so 0 really is calm.
  out.speed = (on ? 1 : 0.3) * (0.4 + 0.8 * out.intensity)
  return out
}

// ---- GLSL ----

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`

// Shared by every preset: sampling (cover or colour field), tint, punch and alpha.
const FRAG_HEAD = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_hasTex;
uniform vec2 u_res;
uniform vec2 u_cover;
uniform float u_time;
uniform vec4 u_audio; // bass, mid, treble, energy
uniform float u_pulse;
uniform float u_intensity;
uniform vec3 u_main;
uniform vec3 u_second;
uniform float u_alpha;

const float PI = 3.14159265;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

// Mirror-repeat in the shader, since NPOT textures can only clamp in WebGL1.
vec2 mirror(vec2 uv) {
  vec2 m = mod(uv, 2.0);
  return 1.0 - abs(m - 1.0);
}

// The cover, cover-fit, or a slowly moving blend of the two theme colours.
vec3 source(vec2 uv) {
  if (u_hasTex > 0.5) {
    vec2 t = (mirror(uv) - 0.5) * u_cover + 0.5;
    return texture2D(u_tex, t).rgb;
  }
  float n = noise(uv * 3.0 + vec2(u_time * 0.15, -u_time * 0.1));
  float w = 0.5 + 0.5 * sin(uv.x * 4.0 + uv.y * 3.0 + u_time * 0.4 + n * 3.0);
  vec3 c = mix(u_main, u_second, w);
  return c * (0.75 + 0.35 * n);
}

// Aspect-correct centred coordinates and back.
vec2 toCentre(vec2 uv) {
  return (uv - 0.5) * vec2(u_res.x / u_res.y, 1.0);
}
vec2 fromCentre(vec2 q) {
  return q / vec2(u_res.x / u_res.y, 1.0) + 0.5;
}

vec3 effect(vec2 uv);

void main() {
  vec3 col = effect(v_uv);
  // A light pull toward the main colour so it sits with the rest of the theme.
  col = mix(col, col * (0.6 + 0.8 * u_main), 0.18);
  // Beat punch: a short brightness lift.
  col *= 1.0 + u_pulse * (0.12 + 0.18 * u_intensity);
  col = clamp(col, 0.0, 1.0);
  gl_FragColor = vec4(col * u_alpha, u_alpha);
}
`

const FRAG_LIQUID = `
vec3 effect(vec2 uv) {
  float bass = u_audio.x;
  float t = u_time;
  // Beat punch: zoom in a touch.
  vec2 q = toCentre(uv) * (1.0 - u_pulse * (0.03 + 0.04 * u_intensity));
  float amp = (0.008 + 0.05 * u_intensity) * (1.0 + 2.2 * bass);
  float n = noise(q * 2.5 + vec2(t * 0.25, t * 0.18));
  q.x += sin(q.y * 6.0 + t * 0.9 + n * 4.0) * amp;
  q.y += cos(q.x * 5.0 - t * 0.7 + n * 3.0) * amp;
  q += (vec2(noise(q * 4.0 + t * 0.3), noise(q * 4.0 - t * 0.3)) - 0.5) * amp * (1.0 + u_audio.y);
  return source(fromCentre(q));
}
`

const FRAG_KALEIDO = `
vec3 effect(vec2 uv) {
  float bass = u_audio.x;
  vec2 q = toCentre(uv);
  float r = length(q) * (1.0 - u_pulse * (0.05 + 0.07 * u_intensity));
  float a = atan(q.y, q.x);
  a += u_time * (0.05 + 0.15 * u_intensity) + bass * 0.35 * u_intensity;
  const float SEG = 2.0 * PI / 8.0;
  a = mod(a, SEG);
  a = abs(a - SEG * 0.5);
  // Bass breathes the radius so the pattern swells on kicks.
  r *= 1.0 + bass * 0.15 * (0.3 + u_intensity);
  vec2 p = vec2(cos(a), sin(a)) * r;
  p += vec2(sin(u_time * 0.13), cos(u_time * 0.11)) * 0.12;
  vec3 col = source(p + 0.5);
  // Fade the far corners so the seams there don't dominate.
  return col * (1.0 - 0.35 * smoothstep(0.45, 0.95, length(q)));
}
`

const FRAG_WARP = `
vec3 effect(vec2 uv) {
  float bass = u_audio.x;
  vec2 q = toCentre(uv);
  float r = length(q);
  float a = atan(q.y, q.x);
  // Swirl strongest in the middle, rocking back and forth.
  float swirl = (0.3 + 1.4 * u_intensity) * (1.0 - smoothstep(0.0, 0.9, r));
  a += swirl * (sin(u_time * 0.35) + bass * 0.8);
  // Radial zoom: pull toward the centre, more with bass and on the beat.
  float zoom = 1.0 - (0.1 + 0.25 * bass + 0.15 * u_pulse) * (0.3 + 0.7 * u_intensity)
    * exp(-r * 1.5);
  zoom *= 1.0 + 0.06 * sin(u_time * 0.5);
  vec2 dir = vec2(cos(a), sin(a));
  // A few taps along the ray give a cheap tunnel blur.
  vec3 col = vec3(0.0);
  float blur = (0.01 + 0.03 * u_intensity) * (0.4 + bass);
  for (int i = 0; i < 4; i++) {
    float k = 1.0 - float(i) * blur;
    col += source(fromCentre(dir * r * zoom * k));
  }
  col *= 0.25;
  return col * (1.0 - 0.4 * smoothstep(0.35, 1.0, r));
}
`

// ---- GL plumbing ----

interface ProgramInfo {
  prog: WebGLProgram
  aPos: number
  tex: WebGLUniformLocation | null
  hasTex: WebGLUniformLocation | null
  res: WebGLUniformLocation | null
  cover: WebGLUniformLocation | null
  time: WebGLUniformLocation | null
  audio: WebGLUniformLocation | null
  pulse: WebGLUniformLocation | null
  intensity: WebGLUniformLocation | null
  main: WebGLUniformLocation | null
  second: WebGLUniformLocation | null
  alpha: WebGLUniformLocation | null
}

type GL = WebGLRenderingContext | WebGL2RenderingContext

function compile(gl: GL, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)
  if (!sh) throw new Error('createShader failed')
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) ?? 'unknown error'
    gl.deleteShader(sh)
    throw new Error(`shader compile failed: ${log}`)
  }
  return sh
}

function link(gl: GL, vert: WebGLShader, fragSrc: string): ProgramInfo {
  const frag = compile(gl, gl.FRAGMENT_SHADER, fragSrc)
  const prog = gl.createProgram()
  if (!prog) throw new Error('createProgram failed')
  gl.attachShader(prog, vert)
  gl.attachShader(prog, frag)
  gl.linkProgram(prog)
  // The program keeps what it needs; the fragment shader object can go now.
  gl.detachShader(prog, frag)
  gl.deleteShader(frag)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog) ?? 'unknown error'
    gl.deleteProgram(prog)
    throw new Error(`program link failed: ${log}`)
  }
  const u = (name: string): WebGLUniformLocation | null => gl.getUniformLocation(prog, name)
  return {
    prog,
    aPos: gl.getAttribLocation(prog, 'a_pos'),
    tex: u('u_tex'),
    hasTex: u('u_hasTex'),
    res: u('u_res'),
    cover: u('u_cover'),
    time: u('u_time'),
    audio: u('u_audio'),
    pulse: u('u_pulse'),
    intensity: u('u_intensity'),
    main: u('u_main'),
    second: u('u_second'),
    alpha: u('u_alpha')
  }
}

interface GlState {
  programs: ProgramInfo[]
  buffer: WebGLBuffer
  texture: WebGLTexture
}

function build(gl: GL): GlState {
  const vert = compile(gl, gl.VERTEX_SHADER, VERT)
  const programs: ProgramInfo[] = []
  try {
    for (const body of [FRAG_LIQUID, FRAG_KALEIDO, FRAG_WARP]) {
      programs.push(link(gl, vert, FRAG_HEAD + body))
    }
  } catch (e) {
    for (const p of programs) gl.deleteProgram(p.prog)
    gl.deleteShader(vert)
    throw e
  }
  gl.deleteShader(vert)

  // One oversized triangle covers the whole screen with three vertices.
  const buffer = gl.createBuffer()
  if (!buffer) throw new Error('createBuffer failed')
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)

  const texture = gl.createTexture()
  if (!texture) throw new Error('createTexture failed')
  gl.bindTexture(gl.TEXTURE_2D, texture)
  // NPOT-safe: clamp, linear, no mipmaps.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  // A 1x1 placeholder so the sampler is never incomplete.
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([0, 0, 0, 255])
  )
  return { programs, buffer, texture }
}

/** Null when WebGL isn't available or shader compile fails (log a console.warn with the reason). */
export function createShaderRenderer(canvas: HTMLCanvasElement): ShaderRenderer | null {
  const opts: WebGLContextAttributes = {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false
  }
  const ctx: GL | null =
    (canvas.getContext('webgl2', opts) as WebGL2RenderingContext | null) ??
    (canvas.getContext('webgl', opts) as WebGLRenderingContext | null)
  if (!ctx) {
    console.warn('[viz] shader style: WebGL is not available')
    return null
  }
  const gl: GL = ctx

  let state: GlState | null
  try {
    state = build(gl)
  } catch (e) {
    console.warn('[viz] shader style:', e instanceof Error ? e.message : e)
    return null
  }

  let lost = false
  let disposed = false
  let coverUrl: string | null = null
  let coverImg: HTMLImageElement | null = null
  let hasTex = false
  let imgW = 0
  let imgH = 0
  let loadToken = 0
  let time = 0
  let lastMain = ''
  let lastSecond = ''
  let main: Rgb = [1, 1, 1]
  let second: Rgb = [1, 1, 1]
  const audio = newAudioUniforms()

  function upload(img: HTMLImageElement): void {
    if (!state || lost) return
    try {
      gl.bindTexture(gl.TEXTURE_2D, state.texture)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
      imgW = img.naturalWidth
      imgH = img.naturalHeight
      hasTex = true
    } catch (e) {
      // Tainted (no CORS) or otherwise unusable: fall back to the colour field.
      console.warn('[viz] shader style: cover upload failed', e)
      hasTex = false
    }
  }

  function onLost(e: Event): void {
    // Ask for a restore; until then, draw does nothing.
    e.preventDefault()
    lost = true
    state = null
    hasTex = false
  }

  function onRestored(): void {
    if (disposed) return
    try {
      state = build(gl)
      lost = false
      if (coverImg?.complete && coverImg.naturalWidth > 0) upload(coverImg)
    } catch (e) {
      console.warn('[viz] shader style: restore failed', e instanceof Error ? e.message : e)
    }
  }

  canvas.addEventListener('webglcontextlost', onLost)
  canvas.addEventListener('webglcontextrestored', onRestored)

  return {
    draw(frame, settings, colors, w, h) {
      if (disposed || lost || !state || gl.isContextLost()) return
      audioUniforms(frame, settings, audio)
      time += (Number.isFinite(frame.dt) ? frame.dt : 0) * audio.speed
      if (colors.main !== lastMain) {
        lastMain = colors.main
        main = parseHex(colors.main)
      }
      if (colors.second !== lastSecond) {
        lastSecond = colors.second
        second = parseHex(colors.second, main)
      }

      const p = state.programs[presetIndex(settings.shaderPreset)]
      if (!p) return
      gl.viewport(0, 0, w, h)
      gl.disable(gl.BLEND)
      gl.useProgram(p.prog)
      gl.bindBuffer(gl.ARRAY_BUFFER, state.buffer)
      gl.enableVertexAttribArray(p.aPos)
      gl.vertexAttribPointer(p.aPos, 2, gl.FLOAT, false, 0, 0)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, state.texture)

      let sx = 1
      let sy = 1
      if (hasTex) {
        // Inline cover fit (same as coverScale) to avoid a tuple allocation per frame.
        const ca = w / Math.max(1, h)
        const ia = imgW / Math.max(1, imgH)
        if (ca > ia) sy = ia / ca
        else sx = ca / ia
      }
      gl.uniform1i(p.tex, 0)
      gl.uniform1f(p.hasTex, hasTex ? 1 : 0)
      gl.uniform2f(p.res, Math.max(1, w), Math.max(1, h))
      gl.uniform2f(p.cover, sx, sy)
      // Wrap time so float precision in the shader stays good over long sessions.
      gl.uniform1f(p.time, time % 3600)
      gl.uniform4f(p.audio, audio.bass, audio.mid, audio.treble, audio.energy)
      gl.uniform1f(p.pulse, audio.pulse)
      gl.uniform1f(p.intensity, audio.intensity)
      gl.uniform3f(p.main, main[0], main[1], main[2])
      gl.uniform3f(p.second, second[0], second[1], second[2])
      gl.uniform1f(p.alpha, clamp01(settings.opacity))
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    },

    setCover(url) {
      if (disposed || url === coverUrl) return
      coverUrl = url
      const token = ++loadToken
      if (coverImg) {
        coverImg.onload = null
        coverImg.onerror = null
      }
      if (!url) {
        coverImg = null
        hasTex = false
        return
      }
      // Keep showing the old cover until the new one arrives.
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.decoding = 'async'
      img.onload = (): void => {
        if (disposed || token !== loadToken) return
        upload(img)
      }
      img.onerror = (): void => {
        if (disposed || token !== loadToken) return
        hasTex = false
      }
      coverImg = img
      img.src = url
    },

    dispose() {
      if (disposed) return
      disposed = true
      loadToken++
      if (coverImg) {
        coverImg.onload = null
        coverImg.onerror = null
        coverImg = null
      }
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
      if (state && !gl.isContextLost()) {
        for (const p of state.programs) gl.deleteProgram(p.prog)
        gl.deleteBuffer(state.buffer)
        gl.deleteTexture(state.texture)
      }
      state = null
    }
  }
}
