import { beforeEach, describe, expect, it } from 'vitest'
import { addRecentSearch, clearRecentSearches, loadRecentSearches } from './recentSearches'

class MemoryStorage {
  private map = new Map<string, string>()
  getItem(k: string): string | null {
    return this.map.get(k) ?? null
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v)
  }
  removeItem(k: string): void {
    this.map.delete(k)
  }
}

beforeEach(() => {
  ;(globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage()
})

describe('recent searches', () => {
  it('keeps the newest first and dedupes case-insensitively', () => {
    addRecentSearch('Forss')
    addRecentSearch('hi-c')
    expect(addRecentSearch('forss')).toEqual(['forss', 'hi-c'])
    expect(loadRecentSearches()).toEqual(['forss', 'hi-c'])
  })

  it('keeps at most 10', () => {
    for (let i = 0; i < 12; i++) addRecentSearch(`q${i}`)
    const list = loadRecentSearches()
    expect(list).toHaveLength(10)
    expect(list[0]).toBe('q11')
  })

  it('ignores blank queries and clears', () => {
    expect(addRecentSearch('   ')).toEqual([])
    addRecentSearch('x')
    clearRecentSearches()
    expect(loadRecentSearches()).toEqual([])
  })

  it('survives broken storage', () => {
    ;(globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => '{not json',
      setItem: () => {
        throw new Error('quota')
      },
      removeItem: () => undefined
    }
    expect(loadRecentSearches()).toEqual([])
    expect(addRecentSearch('x')).toEqual(['x'])
  })
})
