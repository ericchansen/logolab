import { describe, expect, it } from 'vitest'
import { createDesign, validateDesign, validatePortableDesign } from './design'
import {
  getDesignBounds,
  moveGlyphs,
  pairRelativeOffset,
  pairRelativeTransform,
} from './geometry'
import { buildSvgMarkup } from './svg'
import type {
  DesignDocument,
  FontRuntime,
  GlyphOutline,
  StoredFont,
} from './types'

function outline(character: string, width = 700): GlyphOutline {
  return {
    character,
    glyphIndex: character.codePointAt(0) ?? 1,
    path: `M0 0H${width}V-700H0Z`,
    advance: width,
    bounds: { x1: 0, y1: -700, x2: width, y2: 0 },
  }
}

function runtime(text = 'AB'): FontRuntime {
  return {
    id: 'test-font',
    name: 'Test Font',
    source: 'builtin',
    unitsPerEm: 1000,
    outlines: Array.from(text).map((character) => outline(character)),
  }
}

function document(): DesignDocument {
  return {
    schemaVersion: 1,
    fontId: 'test-font',
    fontName: 'Test Font',
    text: 'AB',
    glyphs: [
      { x: 125, y: 40, color: '#112233' },
      { x: 475, y: -35, color: '#445566' },
    ],
    pairs: [{ color: '#ABCDEF' }],
    lightBackground: '#FFFFFF',
    darkBackground: '#111111',
    smallProofPx: 32,
    updatedAt: '2026-07-22T00:00:00.000Z',
  }
}

describe('pair-relative clipping geometry', () => {
  it('subtracts a nonzero left origin and preserves Y offsets', () => {
    expect(pairRelativeOffset({ x: 125, y: 40 }, { x: 475, y: -35 })).toEqual({
      x: 350,
      y: -75,
    })
    expect(pairRelativeTransform({ x: 125, y: 40 }, { x: 475, y: -35 })).toBe(
      'translate(350 -75)',
    )
  })

  it('uses the pair-relative transform in generated SVG clip paths', () => {
    const svg = buildSvgMarkup(document(), runtime(), { renderId: 'test-render' })
    const clipPath = svg.match(/<clipPath[\s\S]*?<\/clipPath>/)?.[0]
    expect(svg).toContain('clipPathUnits="userSpaceOnUse"')
    expect(clipPath).toContain('transform="translate(350 -75)"')
    expect(clipPath).not.toContain('transform="translate(475 -35)"')
    expect(svg).toContain('clip-path="url(#test-render-pair-0)"')
  })

  it('moves one glyph or that glyph and every following glyph', () => {
    const source = {
      ...document(),
      text: 'ABC',
      glyphs: [
        ...document().glyphs,
        { x: 900, y: 0, color: '#778899' },
      ],
      pairs: [...document().pairs, { color: '#123456' }],
    }
    const single = moveGlyphs(source, 1, { x: 10, y: -5 }, 'single')
    expect(single.glyphs.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 125, y: 40 },
      { x: 485, y: -40 },
      { x: 900, y: 0 },
    ])
    const following = moveGlyphs(source, 1, { x: 10, y: -5 }, 'following')
    expect(following.glyphs.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 125, y: 40 },
      { x: 485, y: -40 },
      { x: 910, y: -5 },
    ])
  })

  it('computes tight bounds from outline geometry and placements', () => {
    expect(getDesignBounds(document(), runtime())).toEqual({
      x: 125,
      y: -735,
      width: 1050,
      height: 775,
    })
  })
})

describe('design serialization', () => {
  it('round-trips a valid design without changing explicit colors', () => {
    const serialized = JSON.stringify(document())
    expect(validateDesign(JSON.parse(serialized))).toEqual(document())
  })

  it('rejects malformed glyph and pair arrays', () => {
    expect(() =>
      validateDesign({ ...document(), glyphs: document().glyphs.slice(0, 1) }),
    ).toThrow(/unsupported or incomplete shape/)
  })

  it('validates portable local font data', () => {
    const font: StoredFont = {
      id: 'local-123',
      name: 'Local Font',
      fileName: 'local.ttf',
      dataUrl: 'data:font/ttf;base64,AA==',
    }
    expect(
      validatePortableDesign({
        kind: 'logo-lab-design',
        schemaVersion: 1,
        design: document(),
        font,
      }).font,
    ).toEqual(font)
  })

  it('creates deterministic explicit palette entries for every glyph and pair', () => {
    const created = createDesign(runtime('ABCD'), 'ABCD')
    expect(created.glyphs).toHaveLength(4)
    expect(created.pairs).toHaveLength(3)
    expect(created.glyphs.every(({ color }) => /^#[0-9A-F]{6}$/i.test(color))).toBe(
      true,
    )
    expect(created.pairs.every(({ color }) => /^#[0-9A-F]{6}$/i.test(color))).toBe(
      true,
    )
  })
})
