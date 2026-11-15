import { beforeEach, describe, expect, it } from 'vitest'
import { useUi } from './ui'

const ui = (): ReturnType<typeof useUi.getState> => useUi.getState()

beforeEach(() => {
  useUi.setState({ view: 'local', history: [], forward: [] })
})

describe('back / forward history', () => {
  it('goes forward to the view Back left', () => {
    ui().setView('search')
    ui().back()
    expect(ui().view).toBe('local')
    ui().goForward()
    expect(ui().view).toBe('search')
    expect(ui().history).toEqual(['local'])
  })

  it('a new view clears the forward stack', () => {
    ui().setView('search')
    ui().back()
    ui().setView('stats')
    expect(ui().forward).toEqual([])
  })

  it('forward with nothing ahead does nothing', () => {
    ui().goForward()
    expect(ui().view).toBe('local')
  })
})

describe('right panel tabs', () => {
  beforeEach(() => useUi.setState({ panelOpen: false, panelTab: 'queue' }))

  it('opens on a tab and closes when toggled on the same tab', () => {
    ui().togglePanel('details')
    expect(ui().panelOpen).toBe(true)
    expect(ui().panelTab).toBe('details')
    ui().togglePanel('details')
    expect(ui().panelOpen).toBe(false)
  })

  it('reopens on the last tab with no argument', () => {
    ui().togglePanel('details')
    ui().togglePanel('details')
    ui().togglePanel()
    expect(ui().panelOpen).toBe(true)
    expect(ui().panelTab).toBe('details')
  })

  it('switches tabs while open instead of closing', () => {
    ui().togglePanel('queue')
    ui().togglePanel('jam')
    expect(ui().panelOpen).toBe(true)
    expect(ui().panelTab).toBe('jam')
    ui().openPanel('details')
    expect(ui().panelTab).toBe('details')
  })

  it('closes', () => {
    ui().openPanel()
    ui().closePanel()
    expect(ui().panelOpen).toBe(false)
  })
})

describe('search page hand-off', () => {
  it('opens the Search page with the query and closes quick search', () => {
    ui().openQuickSearch()
    ui().showSearch('forss')
    expect(ui().view).toBe('search')
    expect(ui().searchQuery).toBe('forss')
    expect(ui().quickSearchOpen).toBe(false)
  })
})

describe('quick search', () => {
  it('opens and closes', () => {
    ui().openQuickSearch()
    expect(ui().quickSearchOpen).toBe(true)
    ui().closeQuickSearch()
    expect(ui().quickSearchOpen).toBe(false)
  })
})
