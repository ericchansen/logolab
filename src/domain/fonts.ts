import { parse, type Font, type Glyph } from 'opentype.js'
import type {
  FontRuntime,
  FontSpec,
  GlyphOutline,
  StoredFont,
} from './types'

const OUTLINE_SIZE = 1000

interface VariationManager {
  set(coordinates: Record<string, number>): void
  process: {
    getTransform(glyph: Glyph, coordinates?: Record<string, number>): Glyph
  }
}

interface VariableFont extends Font {
  variation?: VariationManager
}

export const BUILT_IN_FONTS: FontSpec[] = [
  {
    id: 'sora-extrabold',
    name: 'Sora ExtraBold',
    source: 'builtin',
    url: '/fonts/Sora-Variable.ttf',
  },
  {
    id: 'figtree-extrabold',
    name: 'Figtree ExtraBold',
    source: 'builtin',
    url: '/fonts/Figtree-Variable.ttf',
  },
  {
    id: 'work-sans-extrabold',
    name: 'Work Sans ExtraBold',
    source: 'builtin',
    url: '/fonts/WorkSans-Variable.ttf',
  },
  {
    id: 'rubik-extrabold',
    name: 'Rubik ExtraBold',
    source: 'builtin',
    url: '/fonts/Rubik-Variable.ttf',
  },
]

function toOutline(font: VariableFont, character: string): GlyphOutline {
  const sourceGlyph = font.charToGlyph(character)
  if (sourceGlyph.index === 0 && character.codePointAt(0) !== 0) {
    throw new Error(`“${character}” is not supported by ${font.getEnglishName('fontFamily')}.`)
  }

  const glyph = font.variation?.process.getTransform(sourceGlyph) ?? sourceGlyph
  const scale = OUTLINE_SIZE / font.unitsPerEm
  const box = glyph.getBoundingBox()
  const path = glyph.getPath(0, 0, OUTLINE_SIZE).toPathData(3)

  return {
    character,
    glyphIndex: glyph.index,
    path,
    advance: (glyph.advanceWidth ?? font.unitsPerEm) * scale,
    bounds: {
      x1: box.x1 * scale,
      y1: -box.y2 * scale,
      x2: box.x2 * scale,
      y2: -box.y1 * scale,
    },
  }
}

export function parseFont(
  buffer: ArrayBuffer,
  spec: FontSpec,
  text: string,
): FontRuntime {
  const font = parse(buffer, { lowMemory: false }) as VariableFont
  font.variation?.set({ wght: 800 })

  return {
    ...spec,
    unitsPerEm: font.unitsPerEm,
    outlines: Array.from(text).map((character) => toOutline(font, character)),
  }
}

export async function loadBuiltInFont(
  spec: FontSpec,
  text: string,
): Promise<FontRuntime> {
  if (!spec.url) {
    throw new Error(`Built-in font ${spec.name} has no URL.`)
  }
  const response = await fetch(spec.url)
  if (!response.ok) {
    throw new Error(`Could not load ${spec.name}.`)
  }
  return parseFont(await response.arrayBuffer(), spec, text)
}

export function loadStoredFont(font: StoredFont, text: string): FontRuntime {
  return parseFont(dataUrlToBuffer(font.dataUrl), {
    id: font.id,
    name: font.name,
    fileName: font.fileName,
    source: 'local',
  }, text)
}

export async function createStoredFont(file: File): Promise<StoredFont> {
  const buffer = await file.arrayBuffer()
  return createStoredFontFromBuffer(
    buffer,
    file.name,
    file.type || 'font/ttf',
  )
}

async function createStoredFontFromBuffer(
  buffer: ArrayBuffer,
  fileName: string,
  mimeType: string,
): Promise<StoredFont> {
  const hash = await crypto.subtle.digest('SHA-256', buffer)
  const id = `local-${Array.from(new Uint8Array(hash).slice(0, 8))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')}`
  const parsed = parse(buffer, { lowMemory: true })
  const name =
    parsed.getEnglishName('fontFamily') || fileName.replace(/\.[^.]+$/, '')
  return {
    id,
    name,
    fileName,
    dataUrl: bufferToDataUrl(buffer, mimeType),
  }
}

export async function normalizeStoredFont(font: StoredFont): Promise<StoredFont> {
  const mimeType = font.dataUrl.match(/^data:([^;,]+)/)?.[1] ?? 'font/ttf'
  const normalized = await createStoredFontFromBuffer(
    dataUrlToBuffer(font.dataUrl),
    font.fileName,
    mimeType,
  )
  if (normalized.id !== font.id) {
    throw new Error('The imported local font identity does not match its data.')
  }
  return normalized
}

export function bufferToDataUrl(buffer: ArrayBuffer, mimeType: string): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return `data:${mimeType};base64,${btoa(binary)}`
}

export function dataUrlToBuffer(dataUrl: string): ArrayBuffer {
  const encoded = dataUrl.split(',')[1]
  if (!encoded) {
    throw new Error('The stored font data is invalid.')
  }
  const binary = atob(encoded)
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return bytes.buffer
}
