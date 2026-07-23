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
  const orderedOverlaps = [...design.overlaps].sort(
    (left, right) =>
      left.glyphIndices.length - right.glyphIndices.length ||
      left.glyphIndices.join(',').localeCompare(right.glyphIndices.join(',')),
  )
  const clips = orderedOverlaps
    .flatMap((record, recordIndex) => {
      const anchorIndex = record.glyphIndices[0]
      const anchor = anchorIndex === undefined ? undefined : design.glyphs[anchorIndex]
      if (!anchor) {
        return []
      }
      return record.glyphIndices.slice(1).map((memberIndex, memberOffset) => {
        const member = design.glyphs[memberIndex]
        const outline = font.outlines[memberIndex]
        if (!member || !outline) {
          return ''
        }
        const id = `${prefix}-overlap-${recordIndex}-${memberOffset}`
        return `<clipPath id="${id}" clipPathUnits="userSpaceOnUse"><path d="${escapeAttribute(outline.path)}" transform="${pairRelativeTransform(anchor, member)}"/></clipPath>`
      })
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
  const overlaps = orderedOverlaps
    .map((record, recordIndex) => {
      const anchorIndex = record.glyphIndices[0]
      const anchor = anchorIndex === undefined ? undefined : design.glyphs[anchorIndex]
      const outline = anchorIndex === undefined ? undefined : font.outlines[anchorIndex]
      if (!anchor || !outline) {
        return ''
      }
      const openClips = record.glyphIndices
        .slice(1)
        .map(
          (_, memberOffset) =>
            `<g clip-path="url(#${prefix}-overlap-${recordIndex}-${memberOffset})">`,
        )
        .join('')
      const closeClips = '</g>'.repeat(Math.max(0, record.glyphIndices.length - 1))
      return `<g transform="translate(${formatNumber(anchor.x)} ${formatNumber(anchor.y)})">${openClips}<path d="${escapeAttribute(outline.path)}" fill="${record.color}" data-overlap="${record.glyphIndices.join('-')}"/>${closeClips}</g>`
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
          const transform = `translate(${formatNumber(glyph.x)} ${formatNumber(glyph.y)})`
          const halo = selected
            ? `<path d="${escapeAttribute(outline.path)}" fill="none" stroke="#ffffff" stroke-width="4" stroke-linejoin="round" vector-effect="non-scaling-stroke" transform="${transform}" data-selection-halo="${index}" pointer-events="none"/>`
            : ''
          return `${halo}<path d="${escapeAttribute(outline.path)}" fill="transparent" stroke="${selected ? '#2563eb' : 'transparent'}" stroke-width="${selected ? '1.5' : '0'}" stroke-linejoin="round" vector-effect="non-scaling-stroke" transform="${transform}" data-glyph-hit="${index}" data-selected="${selected}" tabindex="-1"/>`
        })
        .join('')
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${rectToViewBox(bounds)}" class="${escapeAttribute(options.className ?? '')}" role="img" aria-label="${escapeAttribute(`${design.text} logo proof in ${font.name}`)}" preserveAspectRatio="xMidYMid meet"><defs>${clips}</defs>${bases}${overlaps}${hits}</svg>`
}
