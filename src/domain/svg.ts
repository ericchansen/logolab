import { formatNumber, getDesignBounds, pairRelativeTransform } from './geometry'
import type { DesignDocument, FontRuntime, Rect } from './types'

export interface SvgOptions {
  renderId: string
  viewBox?: Rect
  selectedGlyph?: number | null
  interactive?: boolean
  className?: string
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

export function rectToViewBox(rect: Rect): string {
  return [rect.x, rect.y, rect.width, rect.height].map(formatNumber).join(' ')
}

export function buildSvgMarkup(
  design: DesignDocument,
  font: FontRuntime,
  options: SvgOptions,
): string {
  if (font.outlines.length !== design.glyphs.length) {
    throw new Error('The loaded font outlines do not match the design text.')
  }
  const bounds = options.viewBox ?? getDesignBounds(design, font)
  const prefix = options.renderId.replace(/[^a-zA-Z0-9_-]/g, '-')
  const clipIds = design.pairs.map((_, index) => `${prefix}-pair-${index}`)
  const clips = clipIds
    .map((id, index) => {
      const left = design.glyphs[index]
      const right = design.glyphs[index + 1]
      const rightOutline = font.outlines[index + 1]
      if (!left || !right || !rightOutline) {
        return ''
      }
      return `<clipPath id="${id}" clipPathUnits="userSpaceOnUse"><path d="${escapeAttribute(rightOutline.path)}" transform="${pairRelativeTransform(left, right)}"/></clipPath>`
    })
    .join('')
  const bases = font.outlines
    .map((outline, index) => {
      const glyph = design.glyphs[index]
      if (!glyph) {
        return ''
      }
      return `<path d="${escapeAttribute(outline.path)}" fill="${glyph.color}" transform="translate(${formatNumber(glyph.x)} ${formatNumber(glyph.y)})" data-glyph="${index}"/>`
    })
    .join('')
  const overlaps = design.pairs
    .map((pair, index) => {
      const left = design.glyphs[index]
      const outline = font.outlines[index]
      if (!left || !outline) {
        return ''
      }
      return `<g transform="translate(${formatNumber(left.x)} ${formatNumber(left.y)})"><path d="${escapeAttribute(outline.path)}" fill="${pair.color}" clip-path="url(#${clipIds[index]})" data-pair="${index}"/></g>`
    })
    .join('')
  const hits = options.interactive
    ? font.outlines
        .map((outline, index) => {
          const glyph = design.glyphs[index]
          if (!glyph) {
            return ''
          }
          const selected = options.selectedGlyph === index
          return `<path d="${escapeAttribute(outline.path)}" fill="transparent" stroke="${selected ? '#111827' : 'transparent'}" stroke-width="${selected ? '10' : '0'}" vector-effect="non-scaling-stroke" transform="translate(${formatNumber(glyph.x)} ${formatNumber(glyph.y)})" data-glyph-hit="${index}" tabindex="-1"/>`
        })
        .join('')
    : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${rectToViewBox(bounds)}" class="${escapeAttribute(options.className ?? '')}" role="img" aria-label="${escapeAttribute(`${design.text} logo proof in ${font.name}`)}" preserveAspectRatio="xMidYMid meet"><defs>${clips}</defs>${bases}${overlaps}${hits}</svg>`
}
