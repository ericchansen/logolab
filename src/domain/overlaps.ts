import polygonClipping, {
  type MultiPolygon,
  type Pair,
  type Ring,
} from 'polygon-clipping'
import { mixSrgbColors } from './colors'
import type {
  DesignDocument,
  FontRuntime,
  GlyphBounds,
  LegacyDesignDocument,
  OverlapRecord,
  Point,
} from './types'

export const FLATTENING_TOLERANCE = 0.5
const MIN_REGION_AREA = FLATTENING_TOLERANCE ** 2
const { difference, intersection, union } = polygonClipping

function unionMany(geometries: MultiPolygon[]): MultiPolygon {
  const first = geometries[0]
  if (!first) {
    return []
  }
  return geometries.length === 1 ? first : union(first, ...geometries.slice(1))
}

interface OccupancyRegion {
  glyphIndices: number[]
  geometry: MultiPolygon
}

interface PositionedGlyph {
  index: number
  geometry: MultiPolygon
  bounds: GlyphBounds
  area: number
}

export function overlapKey(glyphIndices: number[]): string {
  return [...glyphIndices].sort((left, right) => left - right).join('-')
}

function signedRingArea(ring: Pair[]): number {
  let area = 0
  for (let index = 0; index < ring.length - 1; index += 1) {
    const current = ring[index]
    const next = ring[index + 1]
    if (current && next) {
      area += current[0] * next[1] - next[0] * current[1]
    }
  }
  return area / 2
}

function closeRing(points: Point[]): Ring {
  const ring: Ring = points.map(({ x, y }) => [x, y])
  const first = ring[0]
  const last = ring.at(-1)
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
    ring.push([first[0], first[1]])
  }
  return ring
}

function pointInRing(point: Pair, ring: Ring): boolean {
  let inside = false
  for (let currentIndex = 0, priorIndex = ring.length - 1;
    currentIndex < ring.length;
    priorIndex = currentIndex, currentIndex += 1) {
    const current = ring[currentIndex]
    const prior = ring[priorIndex]
    if (!current || !prior) {
      continue
    }
    const crosses = (current[1] > point[1]) !== (prior[1] > point[1])
    if (
      crosses &&
      point[0] <
        ((prior[0] - current[0]) * (point[1] - current[1])) /
          (prior[1] - current[1]) +
          current[0]
    ) {
      inside = !inside
    }
  }
  return inside
}

export function contoursToMultiPolygon(contours: Point[][]): MultiPolygon {
  const rings = contours
    .map(closeRing)
    .filter((ring) => ring.length >= 4 && Math.abs(signedRingArea(ring)) > MIN_REGION_AREA)
  if (rings.length === 0) {
    return []
  }
  const dominant = rings.reduce((largest, ring) =>
    Math.abs(signedRingArea(ring)) > Math.abs(signedRingArea(largest)) ? ring : largest,
  )
  const outerSign = Math.sign(signedRingArea(dominant))
  const nodes = rings
    .map((ring) => ({
      ring,
      area: Math.abs(signedRingArea(ring)),
      direction: Math.sign(signedRingArea(ring)) === outerSign ? 1 : -1,
      winding: 0,
    }))
    .sort((left, right) => right.area - left.area)
  let filled: MultiPolygon = []
  for (const [index, node] of nodes.entries()) {
    const sample = node.ring[0]
    const parent = sample
      ? nodes
          .slice(0, index)
          .filter((candidate) => pointInRing(sample, candidate.ring))
          .sort((left, right) => left.area - right.area)[0]
      : undefined
    const priorWinding = parent?.winding ?? 0
    node.winding = priorWinding + node.direction
    if (priorWinding === 0 && node.winding !== 0) {
      filled = filled.length === 0 ? [[node.ring]] : union(filled, [[node.ring]])
    } else if (priorWinding !== 0 && node.winding === 0) {
      filled = difference(filled, [node.ring])
    }
  }
  return filled
}

function translateGeometry(geometry: MultiPolygon, offset: Point): MultiPolygon {
  return geometry.map((polygon) =>
    polygon.map((ring) =>
      ring.map(([x, y]) => [x + offset.x, y + offset.y] as Pair),
    ),
  )
}

function geometryArea(geometry: MultiPolygon): number {
  return geometry.reduce(
    (total, polygon) =>
      total +
      polygon.reduce((polygonArea, ring, ringIndex) => {
        const area = Math.abs(signedRingArea(ring))
        return polygonArea + (ringIndex === 0 ? area : -area)
      }, 0),
    0,
  )
}

function geometryBounds(geometry: MultiPolygon): GlyphBounds {
  const points = geometry.flat(2)
  return {
    x1: Math.min(...points.map(([x]) => x)),
    y1: Math.min(...points.map(([, y]) => y)),
    x2: Math.max(...points.map(([x]) => x)),
    y2: Math.max(...points.map(([, y]) => y)),
  }
}

function boundsIntersect(left: GlyphBounds, right: GlyphBounds): boolean {
  return (
    left.x1 < right.x2 &&
    left.x2 > right.x1 &&
    left.y1 < right.y2 &&
    left.y2 > right.y1
  )
}

function connectedClusters(glyphs: PositionedGlyph[]): PositionedGlyph[][] {
  const remaining = new Set(glyphs.map(({ index }) => index))
  const byIndex = new Map(glyphs.map((glyph) => [glyph.index, glyph]))
  const clusters: PositionedGlyph[][] = []
  while (remaining.size > 0) {
    const seed = remaining.values().next().value as number
    remaining.delete(seed)
    const queue = [seed]
    const cluster: PositionedGlyph[] = []
    while (queue.length > 0) {
      const index = queue.shift()
      const glyph = index === undefined ? undefined : byIndex.get(index)
      if (!glyph) {
        continue
      }
      cluster.push(glyph)
      for (const candidateIndex of remaining) {
        const candidate = byIndex.get(candidateIndex)
        if (candidate && boundsIntersect(glyph.bounds, candidate.bounds)) {
          remaining.delete(candidateIndex)
          queue.push(candidateIndex)
        }
      }
    }
    clusters.push(cluster)
  }
  return clusters
}

function splitCluster(glyphs: PositionedGlyph[]): OccupancyRegion[] {
  let regions: OccupancyRegion[] = []
  for (const glyph of glyphs) {
    const priorUnion =
      unionMany(regions.map(({ geometry }) => geometry))
    const next: OccupancyRegion[] = []
    for (const region of regions) {
      const shared = intersection(region.geometry, glyph.geometry)
      const existingOnly = difference(region.geometry, glyph.geometry)
      if (geometryArea(existingOnly) > MIN_REGION_AREA) {
        next.push({ ...region, geometry: existingOnly })
      }
      if (geometryArea(shared) > MIN_REGION_AREA) {
        next.push({
          glyphIndices: [...region.glyphIndices, glyph.index].sort((a, b) => a - b),
          geometry: shared,
        })
      }
    }
    const glyphOnly = priorUnion.length === 0
      ? glyph.geometry
      : difference(glyph.geometry, priorUnion)
    if (geometryArea(glyphOnly) > MIN_REGION_AREA) {
      next.push({ glyphIndices: [glyph.index], geometry: glyphOnly })
    }
    regions = next
  }
  return regions
}

export function discoverOverlapRecords(
  design: Pick<DesignDocument, 'glyphs'>,
  font: FontRuntime,
): Array<{ glyphIndices: number[]; area: number; coverage: number }> {
  const glyphs = font.outlines.flatMap((outline, index): PositionedGlyph[] => {
    const placement = design.glyphs[index]
    if (!placement || outline.contours.length === 0) {
      return []
    }
    const geometry = translateGeometry(contoursToMultiPolygon(outline.contours), placement)
    const area = geometryArea(geometry)
    if (geometry.length === 0 || area <= MIN_REGION_AREA) {
      return []
    }
    return [{ index, geometry, bounds: geometryBounds(geometry), area }]
  })
  const areas = new Map(glyphs.map(({ index, area }) => [index, area]))
  const aggregated = new Map<string, { glyphIndices: number[]; area: number }>()
  for (const cluster of connectedClusters(glyphs)) {
    if (cluster.length < 2) {
      continue
    }
    for (const region of splitCluster(cluster)) {
      if (region.glyphIndices.length < 2) {
        continue
      }
      const area = geometryArea(region.geometry)
      if (area <= MIN_REGION_AREA) {
        continue
      }
      const key = overlapKey(region.glyphIndices)
      const current = aggregated.get(key)
      aggregated.set(key, {
        glyphIndices: region.glyphIndices,
        area: (current?.area ?? 0) + area,
      })
    }
  }
  return [...aggregated.values()]
    .map(({ glyphIndices, area }) => {
      const smallestArea = Math.min(...glyphIndices.map((index) => areas.get(index) ?? Infinity))
      return { glyphIndices, area, coverage: (area / smallestArea) * 100 }
    })
    .sort((left, right) => {
      const leftKey = left.glyphIndices
      const rightKey = right.glyphIndices
      for (let index = 0; index < Math.max(leftKey.length, rightKey.length); index += 1) {
        const differenceAtIndex = (leftKey[index] ?? -1) - (rightKey[index] ?? -1)
        if (differenceAtIndex !== 0) {
          return differenceAtIndex
        }
      }
      return 0
    })
}

export function recalculateOverlaps(
  design: DesignDocument,
  font: FontRuntime,
  legacyCustomColors: Map<string, string> = new Map(),
): DesignDocument {
  const prior = new Map(design.overlaps.map((record) => [overlapKey(record.glyphIndices), record]))
  const overlaps: OverlapRecord[] = discoverOverlapRecords(design, font).map(
    ({ glyphIndices, coverage }) => {
      const key = overlapKey(glyphIndices)
      const existing = prior.get(key)
      const legacyColor = legacyCustomColors.get(key)
      const mixed = mixSrgbColors(
        glyphIndices.map((index) => design.glyphs[index]?.color ?? '#000000'),
      )
      return {
        glyphIndices,
        coverage,
        color: legacyColor ?? (existing?.colorMode === 'custom' ? existing.color : mixed),
        colorMode: legacyColor || existing?.colorMode === 'custom' ? 'custom' : 'mixed',
      }
    },
  )
  return {
    ...design,
    overlaps,
    overlapsStale: false,
    updatedAt: new Date().toISOString(),
  }
}

export function migrateLegacyDesign(
  legacy: LegacyDesignDocument,
  font: FontRuntime,
): DesignDocument {
  const base: DesignDocument = {
    schemaVersion: 2,
    fontId: legacy.fontId,
    fontName: legacy.fontName,
    text: legacy.text,
    glyphs: legacy.glyphs,
    overlaps: [],
    overlapsStale: true,
    lightBackground: legacy.lightBackground,
    darkBackground: legacy.darkBackground,
    smallProofPx: legacy.smallProofPx,
    pngLongestSide: 4096,
    updatedAt: legacy.updatedAt,
  }
  const realKeys = new Set(
    discoverOverlapRecords(base, font).map(({ glyphIndices }) => overlapKey(glyphIndices)),
  )
  const legacyColors = new Map<string, string>()
  legacy.pairs.forEach((pair, index) => {
    const key = overlapKey([index, index + 1])
    if (realKeys.has(key)) {
      legacyColors.set(key, pair.color)
    }
  })
  return recalculateOverlaps(base, font, legacyColors)
}
