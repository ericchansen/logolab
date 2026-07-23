import { glyphColor, mixSrgbColors } from './colors'
import { migrateLegacyDesign, recalculateOverlaps } from './overlaps'
import type {
  DesignDocument,
  FontRuntime,
  GlyphStyle,
  LegacyDesignDocument,
  PersistedDesign,
  PortableDesign,
} from './types'

const MAX_DESIGN_TEXT_LENGTH = 12

export function createDesign(font: FontRuntime, text: string): DesignDocument {
  let cursor = 0
  const glyphs: GlyphStyle[] = font.outlines.map((outline, index) => {
    const glyph = { x: cursor, y: 0, color: glyphColor(index) }
    cursor += outline.advance * 0.82
    return glyph
  })
  return recalculateOverlaps({
    schemaVersion: 2,
    fontId: font.id,
    fontName: font.name,
    text,
    glyphs,
    overlaps: [],
    overlapsStale: true,
    lightBackground: '#F7F9FC',
    darkBackground: '#172033',
    smallProofPx: 32,
    pngLongestSide: 4096,
    updatedAt: new Date().toISOString(),
  }, font)
}

function isColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

type DesignCandidate = Partial<Omit<DesignDocument, 'schemaVersion'>> &
  Partial<Omit<LegacyDesignDocument, 'schemaVersion'>> & {
    schemaVersion?: unknown
  }

function validateSharedDesign(
  candidate: DesignCandidate,
): {
  glyphs: GlyphStyle[]
  text: string
  common: Omit<LegacyDesignDocument, 'schemaVersion' | 'glyphs' | 'pairs' | 'text'>
} {
  const characters = typeof candidate.text === 'string' ? Array.from(candidate.text) : []
  if (
    typeof candidate.fontId !== 'string' ||
    typeof candidate.fontName !== 'string' ||
    characters.length < 1 ||
    characters.length > MAX_DESIGN_TEXT_LENGTH ||
    !Array.isArray(candidate.glyphs) ||
    candidate.glyphs.length !== characters.length ||
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
  return {
    glyphs,
    text: characters.join(''),
    common: {
      fontId: candidate.fontId,
      fontName: candidate.fontName,
      lightBackground: candidate.lightBackground,
      darkBackground: candidate.darkBackground,
      smallProofPx: Math.min(64, Math.max(8, Math.round(candidate.smallProofPx))),
      updatedAt: typeof candidate.updatedAt === 'string'
        ? candidate.updatedAt
        : new Date().toISOString(),
    },
  }
}

export function validateDesign(value: unknown): PersistedDesign {
  if (!value || typeof value !== 'object') {
    throw new Error('The design JSON must contain an object.')
  }
  const candidate = value as DesignCandidate
  const { glyphs, text, common } = validateSharedDesign(candidate)
  if (candidate.schemaVersion === 1 && Array.isArray(candidate.pairs)) {
    const pairs = candidate.pairs.map((pair) => {
      if (!pair || !isColor(pair.color)) {
        throw new Error('The design contains an invalid legacy overlap color.')
      }
      return { color: pair.color }
    })
    if (pairs.length !== Math.max(0, glyphs.length - 1)) {
      throw new Error('The design JSON has an unsupported or incomplete shape.')
    }
    return { schemaVersion: 1, ...common, text, glyphs, pairs }
  }
  if (candidate.schemaVersion !== 2 || !Array.isArray(candidate.overlaps)) {
    throw new Error('The design JSON has an unsupported or incomplete shape.')
  }
  const overlaps = candidate.overlaps.map((record) => {
    if (
      !record ||
      !Array.isArray(record.glyphIndices) ||
      record.glyphIndices.length < 2 ||
      record.glyphIndices.some(
        (index) => !Number.isInteger(index) || index < 0 || index >= glyphs.length,
      ) ||
      new Set(record.glyphIndices).size !== record.glyphIndices.length ||
      !isColor(record.color) ||
      (record.colorMode !== 'mixed' && record.colorMode !== 'custom') ||
      !isFiniteNumber(record.coverage)
    ) {
      throw new Error('The design contains an invalid overlap record.')
    }
    return {
      glyphIndices: [...record.glyphIndices].sort((left, right) => left - right),
      color: record.color,
      colorMode: record.colorMode,
      coverage: record.coverage,
    }
  })
  return {
    schemaVersion: 2,
    ...common,
    text,
    glyphs,
    overlaps,
    overlapsStale: Boolean(candidate.overlapsStale),
    pngLongestSide: isFiniteNumber(candidate.pngLongestSide)
      ? Math.min(8192, Math.max(64, Math.round(candidate.pngLongestSide)))
      : 4096,
  }
}

export function resolveDesign(design: PersistedDesign, font: FontRuntime): DesignDocument {
  return design.schemaVersion === 1 ? migrateLegacyDesign(design, font) : design
}

export function refreshMixedOverlapColors(design: DesignDocument): DesignDocument {
  return {
    ...design,
    overlaps: design.overlaps.map((record) =>
      record.colorMode === 'custom'
        ? record
        : {
            ...record,
            color: mixSrgbColors(
              record.glyphIndices.map(
                (index) => design.glyphs[index]?.color ?? '#000000',
              ),
            ),
          },
    ),
  }
}

export function validatePortableDesign(value: unknown): PortableDesign {
  if (!value || typeof value !== 'object') {
    throw new Error('The imported file is not a Logo Lab design.')
  }
  const candidate = value as Partial<PortableDesign>
  if (
    candidate.kind !== 'logo-lab-design' ||
    (candidate.schemaVersion !== 1 && candidate.schemaVersion !== 2)
  ) {
    throw new Error('The imported file is not a supported Logo Lab design.')
  }
  const design = validateDesign(candidate.design)
  if (!candidate.font) {
    return { kind: 'logo-lab-design', schemaVersion: candidate.schemaVersion, design }
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
    schemaVersion: candidate.schemaVersion,
    design,
    font: { ...font },
  }
}
