import type {
  DesignDocument,
  FontRuntime,
  GlyphBounds,
  MoveMode,
  Point,
  Rect,
} from './types'

const MIN_BOUNDS_SIZE = 1

export function pairRelativeOffset(left: Point, right: Point): Point {
  return {
    x: right.x - left.x,
    y: right.y - left.y,
  }
}

export function pairRelativeTransform(left: Point, right: Point): string {
  const offset = pairRelativeOffset(left, right)
  return `translate(${formatNumber(offset.x)} ${formatNumber(offset.y)})`
}

export function formatNumber(value: number): string {
  return Number(value.toFixed(3)).toString()
}

function positionedBounds(bounds: GlyphBounds, position: Point): GlyphBounds {
  return {
    x1: bounds.x1 + position.x,
    y1: bounds.y1 + position.y,
    x2: bounds.x2 + position.x,
    y2: bounds.y2 + position.y,
  }
}

export function getDesignBounds(
  design: DesignDocument,
  font: FontRuntime,
): Rect {
  const bounds = font.outlines.map((outline, index) => {
    const placement = design.glyphs[index]
    if (!placement) {
      throw new Error(`Missing placement for glyph ${index}.`)
    }
    return positionedBounds(outline.bounds, placement)
  })

  const x1 = Math.min(...bounds.map((box) => box.x1))
  const y1 = Math.min(...bounds.map((box) => box.y1))
  const x2 = Math.max(...bounds.map((box) => box.x2))
  const y2 = Math.max(...bounds.map((box) => box.y2))

  return {
    x: x1,
    y: y1,
    width: Math.max(MIN_BOUNDS_SIZE, x2 - x1),
    height: Math.max(MIN_BOUNDS_SIZE, y2 - y1),
  }
}

export function expandRect(rect: Rect, padding: number): Rect {
  return {
    x: rect.x - padding,
    y: rect.y - padding,
    width: rect.width + padding * 2,
    height: rect.height + padding * 2,
  }
}

export function moveGlyphs(
  design: DesignDocument,
  index: number,
  delta: Point,
  mode: MoveMode,
): DesignDocument {
  return {
    ...design,
    glyphs: design.glyphs.map((glyph, glyphIndex) => {
      const shouldMove = mode === 'following' ? glyphIndex >= index : glyphIndex === index
      return shouldMove
        ? { ...glyph, x: glyph.x + delta.x, y: glyph.y + delta.y }
        : glyph
    }),
    updatedAt: new Date().toISOString(),
  }
}

export function horizontalOverlap(
  design: DesignDocument,
  font: FontRuntime,
  pairIndex: number,
): number {
  const left = design.glyphs[pairIndex]
  const right = design.glyphs[pairIndex + 1]
  const leftOutline = font.outlines[pairIndex]
  const rightOutline = font.outlines[pairIndex + 1]
  if (!left || !right || !leftOutline || !rightOutline) {
    return 0
  }
  return left.x + leftOutline.bounds.x2 - (right.x + rightOutline.bounds.x1)
}
