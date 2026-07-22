import { glyphColor, pairColor } from './colors'
import type {
  DesignDocument,
  FontRuntime,
  GlyphStyle,
  PairStyle,
  PortableDesign,
} from './types'

export function createDesign(font: FontRuntime, text: string): DesignDocument {
  let cursor = 0
  const glyphs: GlyphStyle[] = font.outlines.map((outline, index) => {
    const glyph = {
      x: cursor,
      y: 0,
      color: glyphColor(index),
    }
    cursor += outline.advance * 0.82
    return glyph
  })
  const pairs: PairStyle[] = Array.from(
    { length: Math.max(0, glyphs.length - 1) },
    (_, index) => ({ color: pairColor(index) }),
  )

  return {
    schemaVersion: 1,
    fontId: font.id,
    fontName: font.name,
    text,
    glyphs,
    pairs,
    lightBackground: '#F7F9FC',
    darkBackground: '#172033',
    smallProofPx: 32,
    updatedAt: new Date().toISOString(),
  }
}

function isColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function validateDesign(value: unknown): DesignDocument {
  if (!value || typeof value !== 'object') {
    throw new Error('The design JSON must contain an object.')
  }
  const candidate = value as Partial<DesignDocument>
  const characters = typeof candidate.text === 'string' ? Array.from(candidate.text) : []
  if (
    candidate.schemaVersion !== 1 ||
    typeof candidate.fontId !== 'string' ||
    typeof candidate.fontName !== 'string' ||
    characters.length < 1 ||
    characters.length > 12 ||
    !Array.isArray(candidate.glyphs) ||
    candidate.glyphs.length !== characters.length ||
    !Array.isArray(candidate.pairs) ||
    candidate.pairs.length !== Math.max(0, characters.length - 1) ||
    !isColor(candidate.lightBackground) ||
    !isColor(candidate.darkBackground) ||
    !isFiniteNumber(candidate.smallProofPx)
  ) {
    throw new Error('The design JSON has an unsupported or incomplete shape.')
  }

  const glyphs = candidate.glyphs.map((glyph) => {
    if (
      !glyph ||
      !isFiniteNumber(glyph.x) ||
      !isFiniteNumber(glyph.y) ||
      !isColor(glyph.color)
    ) {
      throw new Error('The design contains an invalid glyph placement.')
    }
    return { x: glyph.x, y: glyph.y, color: glyph.color }
  })
  const pairs = candidate.pairs.map((pair) => {
    if (!pair || !isColor(pair.color)) {
      throw new Error('The design contains an invalid overlap color.')
    }
    return { color: pair.color }
  })

  return {
    schemaVersion: 1,
    fontId: candidate.fontId,
    fontName: candidate.fontName,
    text: characters.join(''),
    glyphs,
    pairs,
    lightBackground: candidate.lightBackground,
    darkBackground: candidate.darkBackground,
    smallProofPx: Math.min(256, Math.max(8, candidate.smallProofPx)),
    updatedAt:
      typeof candidate.updatedAt === 'string'
        ? candidate.updatedAt
        : new Date().toISOString(),
  }
}

export function validatePortableDesign(value: unknown): PortableDesign {
  if (!value || typeof value !== 'object') {
    throw new Error('The imported file is not a Logo Lab design.')
  }
  const candidate = value as Partial<PortableDesign>
  if (
    candidate.kind !== 'logo-lab-design' ||
    candidate.schemaVersion !== 1
  ) {
    throw new Error('The imported file is not a supported Logo Lab design.')
  }
  const design = validateDesign(candidate.design)
  if (!candidate.font) {
    return { kind: 'logo-lab-design', schemaVersion: 1, design }
  }
  const font = candidate.font
  if (
    typeof font.id !== 'string' ||
    typeof font.name !== 'string' ||
    typeof font.fileName !== 'string' ||
    typeof font.dataUrl !== 'string' ||
    !font.dataUrl.startsWith('data:')
  ) {
    throw new Error('The imported design contains invalid local font data.')
  }
  return {
    kind: 'logo-lab-design',
    schemaVersion: 1,
    design,
    font: { ...font },
  }
}
