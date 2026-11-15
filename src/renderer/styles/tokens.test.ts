import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { blur, color, font, glass, radius, size } from './tokens'

// app.css hand-mirrors tokens.ts into Tailwind's @theme and the --glass-* variables.
// This keeps them in sync.
const css = readFileSync(join(__dirname, 'app.css'), 'utf8')

/** `--name: value;` pairs inside the first block that starts with `selector {`. */
function block(selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`no ${selector} block in app.css`)
  const body = css.slice(start, css.indexOf('\n}', start))
  return new Map(
    [...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim().toLowerCase()])
  )
}

const vars = new Map(
  [...css.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim().toLowerCase()])
)

const kebab = (s: string): string => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)

describe('Tailwind theme matches tokens.ts', () => {
  it('fixed colors', () => {
    for (const [name, value] of Object.entries(color)) {
      if (typeof value === 'string') {
        expect(vars.get(`color-${kebab(name)}`), name).toBe(value.toLowerCase())
      } else {
        for (const [src, v] of Object.entries(value)) {
          expect(vars.get(`color-${src}`), src).toBe(v.toLowerCase())
        }
      }
    }
  })

  it('glass colors per theme', () => {
    const dark = block(':root')
    const light = block(":root[data-theme='light']")
    for (const [name, value] of Object.entries(glass.dark)) {
      expect(dark.get(`glass-${kebab(name)}`), `dark ${name}`).toBe(value.toLowerCase())
    }
    for (const [name, value] of Object.entries(glass.light)) {
      expect(light.get(`glass-${kebab(name)}`), `light ${name}`).toBe(value.toLowerCase())
    }
  })

  it('scrollbars stay visible in both themes', () => {
    expect(block(':root').get('scrollbar-thumb')).toMatch(/^rgba\(255, 255, 255/)
    expect(block(":root[data-theme='light']").get('scrollbar-thumb')).toMatch(/^rgba\(20, 21, 26/)
    expect(css).toMatch(/::-webkit-scrollbar-thumb\s*\{[^}]*var\(--scrollbar-thumb\)/)
  })

  it('blur, play bar and fade sizes', () => {
    const dark = block(':root')
    for (const [name, value] of Object.entries(blur)) {
      expect(dark.get(`blur-${kebab(name)}`), name).toBe(`${value}px`)
    }
    expect(dark.get('play-bar-height')).toBe(`${size.playBar}px`)
    expect(dark.get('play-bar-inset')).toBe(`${size.playBarInset}px`)
    expect(dark.get('list-fade')).toBe(`${size.listFade}px`)
  })

  it('type scale', () => {
    for (const [name, [size, line]] of Object.entries(font.size)) {
      expect(vars.get(`text-${name}`), name).toBe(`${size}px`)
      expect(vars.get(`text-${name}--line-height`), name).toBe(`${line}px`)
    }
  })

  it('radii', () => {
    for (const name of ['sm', 'md', 'lg', 'panel', 'playBar'] as const) {
      expect(vars.get(`radius-${kebab(name)}`), name).toBe(`${radius[name]}px`)
    }
  })
})
