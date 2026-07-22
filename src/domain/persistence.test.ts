import { describe, expect, it } from 'vitest'
import { designStorageKey, loadDesign, saveDesign } from './persistence'
import type { DesignDocument } from './types'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()

  get length(): number {
    return this.values.size
  }

  clear(): void {
    this.values.clear()
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

function design(fontId: string, text: string, x: number): DesignDocument {
  return {
    schemaVersion: 1,
    fontId,
    fontName: fontId,
    text,
    glyphs: Array.from(text).map((_, index) => ({
      x: index === 0 ? x : index * 500,
      y: 0,
      color: '#112233',
    })),
    pairs: Array.from({ length: text.length - 1 }, () => ({ color: '#445566' })),
    lightBackground: '#FFFFFF',
    darkBackground: '#111111',
    smallProofPx: 32,
    updatedAt: '2026-07-22T00:00:00.000Z',
  }
}

describe('design persistence isolation', () => {
  it('uses independent keys for every font and text variant', () => {
    const storage = new MemoryStorage()
    saveDesign(design('sora', 'Logo', 111), storage)
    saveDesign(design('figtree', 'Logo', 222), storage)
    saveDesign(design('sora', 'Lab', 333), storage)

    expect(loadDesign('sora', 'Logo', storage)?.glyphs[0]?.x).toBe(111)
    expect(loadDesign('figtree', 'Logo', storage)?.glyphs[0]?.x).toBe(222)
    expect(loadDesign('sora', 'Lab', storage)?.glyphs[0]?.x).toBe(333)
    expect(storage.length).toBe(3)
  })

  it('captures the supplied design identity instead of a later active selection', () => {
    const storage = new MemoryStorage()
    const prior = design('sora', 'Logo', 123)
    const next = design('figtree', 'Mark', 456)
    saveDesign(prior, storage)
    saveDesign(next, storage)

    expect(storage.getItem(designStorageKey('sora', 'Logo'))).toContain('"x":123')
    expect(storage.getItem(designStorageKey('figtree', 'Mark'))).toContain('"x":456')
  })

  it('removes invalid stored data instead of returning a success-shaped fallback', () => {
    const storage = new MemoryStorage()
    const key = designStorageKey('sora', 'Logo')
    storage.setItem(key, '{"glyphs":"broken"}')
    expect(loadDesign('sora', 'Logo', storage)).toBeNull()
    expect(storage.getItem(key)).toBeNull()
  })
})
