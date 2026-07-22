export interface Point {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface GlyphBounds {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface GlyphOutline {
  character: string
  glyphIndex: number
  path: string
  advance: number
  bounds: GlyphBounds
}

export interface FontSpec {
  id: string
  name: string
  source: 'builtin' | 'local'
  url?: string
  fileName?: string
}

export interface FontRuntime extends FontSpec {
  outlines: GlyphOutline[]
  unitsPerEm: number
}

export interface GlyphStyle extends Point {
  color: string
}

export interface PairStyle {
  color: string
}

export interface DesignDocument {
  schemaVersion: 1
  fontId: string
  fontName: string
  text: string
  glyphs: GlyphStyle[]
  pairs: PairStyle[]
  lightBackground: string
  darkBackground: string
  smallProofPx: number
  updatedAt: string
}

export interface PortableDesign {
  kind: 'logo-lab-design'
  schemaVersion: 1
  design: DesignDocument
  font?: {
    id: string
    name: string
    fileName: string
    dataUrl: string
  }
}

export interface StoredFont {
  id: string
  name: string
  fileName: string
  dataUrl: string
}

export type MoveMode = 'single' | 'following'
