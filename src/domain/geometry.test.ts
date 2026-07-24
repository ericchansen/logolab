import { describe, expect, it } from 'vitest'
import { createDesign, resolveDesign, validateDesign, validatePortableDesign } from './design'
import {
  getDesignBounds,
  getPaintedBounds,
  moveGlyphs,
  normalizeDesignCoordinates,
  pairRelativeOffset,
  pairRelativeTransform,
} from './geometry'
import { recalculateOverlaps } from './overlaps'
import { buildSvgMarkup } from './svg'
import type {
  DesignDocument,
  FontRuntime,
  GlyphOutline,
  LegacyDesignDocument,
  StoredFont,
} from './types'

function outline(character: string, width = 700): GlyphOutline {
  return {
    character,
    glyphIndex: character.codePointAt(0) ?? 1,
    path: `M0 0H${width}V-700H0Z`,
    advance: width,
    bounds: { x1: 0, y1: -700, x2: width, y2: 0 },
    contours: [[
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: -700 },
      { x: 0, y: -700 },
      { x: 0, y: 0 },
    ]],
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
    schemaVersion: 2,
    fontId: 'test-font',
    fontName: 'Test Font',
    text: 'AB',
    glyphs: [
      { x: 125, y: 40, color: '#112233' },
      { x: 475, y: -35, color: '#445566' },
    ],
    overlaps: [{
      glyphIndices: [0, 1],
      color: '#ABCDEF',
      colorMode: 'custom',
      coverage: 12.5,
    }],
    overlapsStale: false,
    lightBackground: '#FFFFFF',
    darkBackground: '#111111',
    smallProofPx: 32,
    pngLongestSide: 4096,
    updatedAt: '2026-07-22T00:00:00.000Z',
  }
}

describe('pair-relative clipping geometry', () => {
  it('subtracts a nonzero anchor origin and preserves Y offsets', () => {
    expect(pairRelativeOffset({ x: 125, y: 40 }, { x: 475, y: -35 })).toEqual({
      x: 350,
      y: -75,
    })
    expect(pairRelativeTransform({ x: 125, y: 40 }, { x: 475, y: -35 })).toBe(
      'translate(350 -75)',
    )
  })

  it('uses nested pair-relative transforms for N-way SVG clips', () => {
    const design = {
      ...document(),
      text: 'ABC',
      glyphs: [...document().glyphs, { x: 650, y: 25, color: '#778899' }],
      overlaps: [{
        glyphIndices: [0, 1, 2],
        color: '#ABCDEF',
        colorMode: 'custom' as const,
        coverage: 4.2,
      }],
    }
    const svg = buildSvgMarkup(design, runtime('ABC'), { renderId: 'test-render' })
    const clipPaths = svg.match(/<clipPath[\s\S]*?<\/clipPath>/g)?.join('') ?? ''
    expect(clipPaths).toContain('transform="translate(350 -75)"')
    expect(clipPaths).toContain('transform="translate(525 -15)"')
    expect(clipPaths).not.toContain('transform="translate(475 -35)"')
    expect(svg.match(/clip-path=/g)).toHaveLength(2)
    expect(svg).toContain('data-overlap="0-1-2"')
  })

  it('moves the selected glyphs and marks overlaps stale', () => {
    const source: DesignDocument = {
      ...document(),
      text: 'ABC',
      glyphs: [...document().glyphs, { x: 900, y: 0, color: '#778899' }],
    }
    const single = moveGlyphs(source, [1], { x: 10, y: -5 })
    expect(single.glyphs.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 125, y: 40 },
      { x: 485, y: -40 },
      { x: 900, y: 0 },
    ])
    expect(single.overlapsStale).toBe(true)
    const group = moveGlyphs(source, [0, 2], { x: 10, y: -5 })
    expect(group.glyphs.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 135, y: 35 },
      { x: 475, y: -35 },
      { x: 910, y: -5 },
    ])
    const following = moveGlyphs(source, [1, 2], { x: 10, y: -5 })
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

  it('frames only painted outlines, ignoring distant empty glyphs', () => {
    const visible = {
      ...outline('A', 520),
      bounds: { x1: 120, y1: -680, x2: 640, y2: 40 },
    }
    const empty = {
      ...outline(' ', 500),
      path: '',
      bounds: { x1: 0, y1: 0, x2: 0, y2: 0 },
      contours: [],
    }
    const asymmetricFont: FontRuntime = {
      ...runtime(' A'),
      outlines: [empty, visible],
    }
    const asymmetricDesign: DesignDocument = {
      ...document(),
      text: ' A',
      glyphs: [
        { x: -2400, y: 900, color: '#112233' },
        { x: 375, y: -85, color: '#445566' },
      ],
    }

    expect(getDesignBounds(asymmetricDesign, asymmetricFont)).toEqual({
      x: -2400,
      y: -765,
      width: 3415,
      height: 1665,
    })
    expect(getPaintedBounds(asymmetricDesign, asymmetricFont)).toEqual({
      x: 495,
      y: -765,
      width: 520,
      height: 720,
    })
    expect(
      buildSvgMarkup(asymmetricDesign, asymmetricFont, { renderId: 'export' }),
    ).toContain('viewBox="-2400 -765 3415 1665"')
    expect(
      buildSvgMarkup(asymmetricDesign, asymmetricFont, {
        renderId: 'viewer',
        viewBox: getPaintedBounds(asymmetricDesign, asymmetricFont),
      }),
    ).toContain('viewBox="495 -765 520 720"')
  })

  it('returns a stable minimal frame when a design has no painted outlines', () => {
    const emptyFont: FontRuntime = {
      ...runtime(' '),
      outlines: [{
        ...outline(' ', 500),
        path: '',
        bounds: { x1: 0, y1: 0, x2: 0, y2: 0 },
        contours: [],
      }],
    }
    const emptyDesign: DesignDocument = {
      ...document(),
      text: ' ',
      glyphs: [{ x: 1800, y: -700, color: '#112233' }],
      overlaps: [],
    }

    expect(getPaintedBounds(emptyDesign, emptyFont)).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    })
  })

  it('normalizes an anchor glyph to zero with one idempotent translation', () => {
    const empty = {
      ...outline(' ', 500),
      path: '',
      bounds: { x1: 0, y1: 0, x2: 0, y2: 0 },
      contours: [],
    }
    const font: FontRuntime = {
      ...runtime(' AB'),
      outlines: [
        empty,
        {
          ...outline('A', 520),
          bounds: { x1: 120, y1: -680, x2: 640, y2: 40 },
        },
        outline('B'),
      ],
    }
    const source: DesignDocument = {
      ...document(),
      text: ' AB',
      glyphs: [
        { x: -2400, y: 900, color: '#112233' },
        { x: 375, y: -85, color: '#445566' },
        { x: 700, y: -40, color: '#778899' },
      ],
      overlaps: [{
        glyphIndices: [1, 2],
        color: '#ABCDEF',
        colorMode: 'custom',
        coverage: 12.5,
      }],
    }
    const beforeDelta = pairRelativeOffset(source.glyphs[1]!, source.glyphs[2]!)
    const beforeAccurate = recalculateOverlaps(source, font)
    const beforeOverlaps = beforeAccurate.overlaps
    const beforeSvg = buildSvgMarkup(beforeAccurate, font, { renderId: 'before-normalize' })

    const normalized = normalizeDesignCoordinates(source, 1)
    const translations = normalized.glyphs.map((glyph, index) => ({
      x: glyph.x - source.glyphs[index]!.x,
      y: glyph.y - source.glyphs[index]!.y,
    }))

    expect(translations).toEqual([
      { x: -375, y: 85 },
      { x: -375, y: 85 },
      { x: -375, y: 85 },
    ])
    expect(normalized.glyphs[1]).toMatchObject({ x: 0, y: 0 })
    expect(getPaintedBounds(normalized, font)).toEqual({
      x: 120,
      y: -680,
      width: 905,
      height: 725,
    })
    expect(pairRelativeOffset(normalized.glyphs[1]!, normalized.glyphs[2]!))
      .toEqual(beforeDelta)
    expect(recalculateOverlaps(normalized, font).overlaps).toEqual(beforeOverlaps)
    expect(normalizeDesignCoordinates(normalized, 1)).toBe(normalized)

    const afterSvg = buildSvgMarkup(
      recalculateOverlaps(normalized, font),
      font,
      { renderId: 'after-normalize' },
    )
    expect(beforeSvg).toContain('viewBox="-2400 -765 3800 1665"')
    expect(afterSvg).toContain('viewBox="-2775 -680 3800 1665"')
    expect(beforeSvg).toContain('transform="translate(325 45)"')
    expect(afterSvg).toContain('transform="translate(325 45)"')
    expect(afterSvg).toContain('transform="translate(-2775 985)"')
    expect(afterSvg).toContain('transform="translate(0 0)"')
  })
})

describe('design serialization', () => {
  it('round-trips schema v2 without changing explicit colors', () => {
    expect(validateDesign(JSON.parse(JSON.stringify(document())))).toEqual(document())
  })

  it('migrates schema v1 only after real font outlines are available', () => {
    const legacy: LegacyDesignDocument = {
      schemaVersion: 1,
      fontId: 'test-font',
      fontName: 'Test Font',
      text: 'AB',
      glyphs: document().glyphs,
      pairs: [{ color: '#ABCDEF' }],
      lightBackground: '#FFFFFF',
      darkBackground: '#111111',
      smallProofPx: 32,
      updatedAt: document().updatedAt,
    }
    const validated = validateDesign(legacy)
    expect(validated.schemaVersion).toBe(1)
    const migrated = resolveDesign(validated, runtime())
    expect(migrated.schemaVersion).toBe(2)
    expect(migrated.overlaps[0]).toMatchObject({
      glyphIndices: [0, 1],
      color: '#ABCDEF',
      colorMode: 'custom',
    })
  })

  it('rejects malformed glyph arrays', () => {
    expect(() =>
      validateDesign({ ...document(), glyphs: document().glyphs.slice(0, 1) }),
    ).toThrow(/unsupported or incomplete shape/)
  })

  it('rejects imported designs longer than 12 characters', () => {
    expect(() =>
      validateDesign({
        ...document(),
        text: 'ABCDEFGHIJKLM',
        glyphs: Array.from({ length: 13 }, () => document().glyphs[0]),
      }),
    ).toThrow(/unsupported or incomplete shape/)
  })

  it('migrates prior small-proof sizes into the actual-size range', () => {
    expect(validateDesign({ ...document(), smallProofPx: 256 }).smallProofPx).toBe(64)
  })

  it('accepts only the LogoLab portable design discriminator', () => {
    const font: StoredFont = {
      id: 'local-123',
      name: 'Local Font',
      fileName: 'local.ttf',
      dataUrl: 'data:font/ttf;base64,AA==',
    }
    expect(validatePortableDesign({
      kind: 'logolab-design',
      schemaVersion: 2,
      design: document(),
      font,
    }).font).toEqual(font)
    expect(() =>
      validatePortableDesign({
        kind: 'logo-lab-design',
        schemaVersion: 2,
        design: document(),
      }),
    ).toThrow(/not a supported LogoLab design/)
  })

  it('creates deterministic explicit overlap records', () => {
    const created = createDesign(runtime('ABCD'), 'ABCD')
    expect(created.glyphs).toHaveLength(4)
    expect(created.overlaps.length).toBeGreaterThan(0)
    expect(created.overlaps.every(({ color }) => /^#[0-9A-F]{6}$/i.test(color))).toBe(true)
  })
})
