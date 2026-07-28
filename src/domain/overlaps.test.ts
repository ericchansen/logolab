import { describe, expect, it } from 'vitest'
import { mixSrgbColors } from './colors'
import {
  contoursToMultiPolygon,
  discoverOverlapRecords,
  overlapKey,
  recalculateOverlaps,
} from './overlaps'
import type { DesignDocument, FontRuntime, GlyphOutline, Point } from './types'

function rectangle(width: number, height: number): Point[] {
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: -height },
    { x: 0, y: -height },
    { x: 0, y: 0 },
  ]
}

function outline(character: string, contours: Point[][] = [rectangle(100, 100)]): GlyphOutline {
  return {
    character,
    glyphIndex: character.codePointAt(0) ?? 1,
    path: 'M0 0H100V-100H0Z',
    advance: 100,
    bounds: { x1: 0, y1: -100, x2: 100, y2: 0 },
    contours,
  }
}

function fixture(positions: number[]): { design: DesignDocument; font: FontRuntime } {
  const text = positions.map((_, index) => String.fromCharCode(65 + index)).join('')
  return {
    design: {
      schemaVersion: 2,
      fontId: 'fixture',
      fontName: 'Fixture',
      text,
      glyphs: positions.map((x, index) => ({
        x,
        y: 0,
        color: ['#FF0000', '#00FF00', '#0000FF', '#FFFF00'][index] ?? '#000000',
      })),
      letterSpacing: 0,
      overlaps: [],
      overlapsStale: true,
      lightBackground: '#FFFFFF',
      darkBackground: '#000000',
      smallProofPx: 32,
      pngLongestSide: 4096,
      updatedAt: '2026-07-22T00:00:00.000Z',
    },
    font: {
      id: 'fixture',
      name: 'Fixture',
      source: 'builtin',
      unitsPerEm: 1000,
      outlines: positions.map((_, index) => outline(String.fromCharCode(65 + index))),
    },
  }
}

describe('dynamic overlap discovery', () => {
  it('mixes any number of colors deterministically in sRGB', () => {
    expect(mixSrgbColors(['#FF0000', '#00FF00', '#0000FF'])).toBe('#555555')
    expect(mixSrgbColors(['#0000FF', '#FF0000', '#00FF00'])).toBe('#555555')
  })

  it('uses stable sorted glyph-index keys', () => {
    expect(overlapKey([4, 1, 3])).toBe('1-3-4')
  })

  it('discovers mutually exclusive pair and N-way occupancy sets', () => {
    const { design, font } = fixture([0, 50, 75])
    const records = discoverOverlapRecords(design, font)
    expect(records.map(({ glyphIndices }) => glyphIndices)).toEqual([
      [0, 1],
      [0, 1, 2],
      [1, 2],
    ])
    expect(records.map(({ coverage }) => coverage)).toEqual([25, 25, 50])
  })

  it('discovers non-adjacent overlap identities', () => {
    const { design, font } = fixture([0, 500, 50])
    expect(discoverOverlapRecords(design, font).map(overlapKeyFromRecord)).toEqual(['0-2'])
  })

  it('aggregates disconnected islands sharing one overlap identity', () => {
    const islands = [
      rectangle(20, 20),
      rectangle(20, 20).map(({ x, y }) => ({ x: x + 80, y })),
    ]
    const { design, font } = fixture([0, 0])
    font.outlines[0] = outline('A', islands)
    font.outlines[1] = outline('B', [rectangle(100, 20)])
    const records = discoverOverlapRecords(design, font)
    expect(records).toHaveLength(1)
    expect(records[0]?.glyphIndices).toEqual([0, 1])
    expect(records[0]?.coverage).toBe(100)
  })

  it('honors oppositely wound holes', () => {
    const outer = rectangle(100, 100)
    const hole = rectangle(40, 40)
      .map(({ x, y }) => ({ x: x + 30, y: y - 30 }))
      .reverse()
    const { design, font } = fixture([0, 30])
    const secondGlyph = design.glyphs[1]
    if (!secondGlyph) {
      throw new Error('Missing fixture glyph.')
    }
    design.glyphs[1] = { ...secondGlyph, y: -30 }
    font.outlines[0] = outline('A', [outer, hole])
    font.outlines[1] = outline('B', [rectangle(40, 40)])
    expect(contoursToMultiPolygon([outer, hole])).not.toHaveLength(0)
    expect(discoverOverlapRecords(design, font)).toEqual([])
  })

  it('preserves a filled island nested inside an oppositely wound hole', () => {
    const outer = rectangle(100, 100)
    const hole = rectangle(60, 60)
      .map(({ x, y }) => ({ x: x + 20, y: y - 20 }))
      .reverse()
    const island = rectangle(20, 20)
      .map(({ x, y }) => ({ x: x + 40, y: y - 40 }))
    const { design, font } = fixture([0, 40])
    const secondGlyph = design.glyphs[1]
    if (!secondGlyph) {
      throw new Error('Missing fixture glyph.')
    }
    design.glyphs[1] = { ...secondGlyph, y: -40 }
    font.outlines[0] = outline('A', [outer, hole, island])
    font.outlines[1] = outline('B', [rectangle(20, 20)])

    expect(contoursToMultiPolygon([outer, hole, island])).toHaveLength(2)
    expect(discoverOverlapRecords(design, font)).toEqual([
      { glyphIndices: [0, 1], area: 400, coverage: 100 },
    ])
  })

  it('accepts self-crossing contours without destabilizing discovery', () => {
    const bowTie = [
      { x: 0, y: 0 },
      { x: 100, y: -100 },
      { x: 0, y: -100 },
      { x: 100, y: 0 },
      { x: 0, y: 0 },
    ]
    expect(() => contoursToMultiPolygon([bowTie])).not.toThrow()
  })

  it('rejects overlap noise at or below a quarter square unit', () => {
    const { design, font } = fixture([0, 99.999])
    expect(discoverOverlapRecords(design, font)).toEqual([])
  })

  it('preserves custom colors, refreshes mixed colors, and removes stale identities', () => {
    const { design, font } = fixture([0, 50, 75])
    const calculated = recalculateOverlaps(design, font)
    calculated.overlaps = calculated.overlaps.map((record) =>
      overlapKey(record.glyphIndices) === '0-1'
        ? { ...record, color: '#123456', colorMode: 'custom' }
        : record,
    )
    const secondGlyph = calculated.glyphs[1]
    if (!secondGlyph) {
      throw new Error('Missing fixture glyph.')
    }
    calculated.glyphs[1] = { ...secondGlyph, color: '#FFFFFF' }
    const refreshed = recalculateOverlaps(calculated, font)
    expect(refreshed.overlaps.find((record) => overlapKey(record.glyphIndices) === '0-1'))
      .toMatchObject({ color: '#123456', colorMode: 'custom' })
    const thirdGlyph = calculated.glyphs[2]
    if (!thirdGlyph) {
      throw new Error('Missing fixture glyph.')
    }
    calculated.glyphs[2] = { ...thirdGlyph, x: 500 }
    const removed = recalculateOverlaps(calculated, font)
    expect(removed.overlaps.some((record) => record.glyphIndices.includes(2))).toBe(false)
  })
})

function overlapKeyFromRecord(record: { glyphIndices: number[] }): string {
  return overlapKey(record.glyphIndices)
}
