import { describe, expect, it } from 'vitest'
import { ZOOM, clampRightPanelWidth, clampSidebarWidth, clampZoom, stepZoom } from './layout'

describe('clampSidebarWidth', () => {
  it('snaps to the icon rail below 180 px', () => {
    expect(clampSidebarWidth(150)).toBe(72)
    expect(clampSidebarWidth(179)).toBe(72)
  })

  it('clamps to 220-420 px otherwise', () => {
    expect(clampSidebarWidth(200)).toBe(220)
    expect(clampSidebarWidth(300)).toBe(300)
    expect(clampSidebarWidth(500)).toBe(420)
  })

  it('falls back to 280 for junk', () => {
    expect(clampSidebarWidth(NaN)).toBe(280)
    expect(clampSidebarWidth(Infinity)).toBe(280)
  })
})

describe('clampRightPanelWidth', () => {
  it('clamps to 280-480 px', () => {
    expect(clampRightPanelWidth(100)).toBe(280)
    expect(clampRightPanelWidth(999)).toBe(480)
    expect(clampRightPanelWidth(350)).toBe(350)
  })

  it('falls back to 320 for junk', () => {
    expect(clampRightPanelWidth(NaN)).toBe(320)
  })
})

describe('stepZoom', () => {
  it('steps by 0.1 within 0.7-1.5', () => {
    expect(stepZoom(1, 1)).toBe(1.1)
    expect(stepZoom(1.5, 1)).toBe(1.5)
    expect(stepZoom(0.7, -1)).toBe(0.7)
  })

  it('resets to 1', () => {
    expect(stepZoom(1.3, 0)).toBe(1)
  })

  it('does not drift with floating point', () => {
    expect(stepZoom(1.1, -1)).toBe(1)
    expect(stepZoom(stepZoom(stepZoom(1, 1), 1), 1)).toBe(1.3)
  })
})

describe('clampZoom', () => {
  it('clamps and rounds, 1 for junk', () => {
    expect(clampZoom(7)).toBe(1.5)
    expect(clampZoom(0.1)).toBe(0.7)
    expect(clampZoom(1.02)).toBe(1)
    expect(clampZoom(1.04)).toBe(1.05)
    expect(clampZoom(NaN)).toBe(1)
  })
})

describe('zoom slider step', () => {
  it('moves in 5% steps and snaps to them', () => {
    expect(ZOOM.sliderStep).toBe(0.05)
    expect(clampZoom(0.95)).toBe(0.95)
    expect(stepZoom(1.05, 1)).toBe(1.15)
  })
})
