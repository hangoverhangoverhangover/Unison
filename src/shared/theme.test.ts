import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CUSTOM_THEME,
  contrastRatio,
  customThemeVars,
  isLightColor,
  parseThemeFile,
  themeFile,
  validateCustomTheme
} from './theme'

describe('validateCustomTheme', () => {
  it('fills missing fields from the default and keeps good ones', () => {
    const t = validateCustomTheme({ accent: '#FF0088', radius: 20 })
    expect(t).toEqual({ ...DEFAULT_CUSTOM_THEME, accent: '#ff0088', radius: 20 })
  })

  it('drops bad values field by field and clamps numbers', () => {
    const t = validateCustomTheme({
      accent: 'red',
      background: '#12345',
      backdrop: 'video',
      font: 'comic',
      blur: 500,
      opacity: -1,
      radius: 'big'
    })
    expect(t.accent).toBe(DEFAULT_CUSTOM_THEME.accent)
    expect(t.background).toBe(DEFAULT_CUSTOM_THEME.background)
    expect(t.backdrop).toBe(DEFAULT_CUSTOM_THEME.backdrop)
    expect(t.font).toBe(DEFAULT_CUSTOM_THEME.font)
    expect(t.blur).toBe(80)
    expect(t.opacity).toBe(0.1)
    expect(t.radius).toBe(DEFAULT_CUSTOM_THEME.radius)
  })

  it('is the default for anything that is not an object', () => {
    expect(validateCustomTheme(null)).toEqual(DEFAULT_CUSTOM_THEME)
    expect(validateCustomTheme('x')).toEqual(DEFAULT_CUSTOM_THEME)
  })
})

describe('colours', () => {
  it('tells light from dark', () => {
    expect(isLightColor('#ffffff')).toBe(true)
    expect(isLightColor('#eef0f5')).toBe(true)
    expect(isLightColor('#141522')).toBe(false)
  })

  it('computes WCAG contrast', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0)
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5)
  })
})

describe('customThemeVars', () => {
  it('maps the theme onto the CSS variables the glass uses', () => {
    const v = customThemeVars({
      ...DEFAULT_CUSTOM_THEME,
      accent: '#ff0088',
      background: '#102030',
      text: '#ffffff',
      opacity: 0.5,
      blur: 20,
      radius: 16,
      font: 'system'
    })
    expect(v['--glass-base']).toBe('#102030')
    expect(v['--glass-tint']).toBe('rgba(16, 32, 48, 0.5)')
    expect(v['--glass-text']).toBe('#ffffff')
    expect(v['--glass-text-subdued']).toBe('rgba(255, 255, 255, 0.72)')
    expect(v['--color-accent']).toBe('#ff0088')
    expect(v['--blur-panel']).toBe('20px')
    expect(v['--blur-play-bar']).toBe('40px')
    expect(v['--radius-panel']).toBe('16px')
    expect(v['--radius-play-bar']).toBe('22px')
    expect(v['--font-sans']).toContain('system-ui')
    expect(v['color-scheme']).toBe('dark')
  })

  it('uses dark text on a light accent and a light scheme on a light background', () => {
    const v = customThemeVars({ ...DEFAULT_CUSTOM_THEME, accent: '#ffe066', background: '#f4f4f4' })
    expect(v['--color-on-accent']).toBe('#14151a')
    expect(v['color-scheme']).toBe('light')
  })
})

describe('theme files', () => {
  it('round-trips a theme and its image', () => {
    const theme = { ...DEFAULT_CUSTOM_THEME, accent: '#00ff00', backdrop: 'image' as const }
    const text = themeFile(theme, 'data:image/jpeg;base64,AAAA')
    expect(parseThemeFile(text)).toEqual({ theme, image: 'data:image/jpeg;base64,AAAA' })
  })

  it('reads a file without an image', () => {
    const out = parseThemeFile(themeFile(DEFAULT_CUSTOM_THEME, null))
    expect(out.image).toBeNull()
  })

  it('refuses files that are not Unison themes', () => {
    expect(() => parseThemeFile('not json')).toThrow(/theme file/)
    expect(() => parseThemeFile('{"kind":"playlist"}')).toThrow(/theme file/)
  })

  it('ignores an image that is not an image data URL', () => {
    const text = JSON.stringify({
      app: 'Unison',
      kind: 'theme',
      version: 1,
      theme: DEFAULT_CUSTOM_THEME,
      image: 'https://example.com/x.png'
    })
    expect(parseThemeFile(text).image).toBeNull()
  })
})
