import { parse, type Font, type Glyph, type PathCommand } from 'opentype.js'
import type {
  FontRuntime,
  FontSpec,
  GlyphOutline,
  StoredFont,
} from './types'

const OUTLINE_SIZE = 1000
const FLATTENING_TOLERANCE = 0.5

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
    id: 'archivo-black',
    name: 'Archivo',
    source: 'builtin',
    url: 'fonts/Archivo-Black.ttf',
    previewFamily: 'LogoLab Archivo',
  },
  {
    id: 'bricolage-grotesque-extrabold',
    name: 'Bricolage Grotesque',
    source: 'builtin',
    url: 'fonts/BricolageGrotesque-ExtraBold.ttf',
    previewFamily: 'LogoLab Bricolage Grotesque',
  },
  {
    id: 'figtree-extrabold',
    name: 'Figtree',
    source: 'builtin',
    url: 'fonts/Figtree-Black.ttf',
    previewFamily: 'LogoLab Figtree',
  },
  {
    id: 'fraunces-black',
    name: 'Fraunces',
    source: 'builtin',
    url: 'fonts/Fraunces144pt-Black.ttf',
    previewFamily: 'LogoLab Fraunces',
  },
  {
    id: 'manrope-extrabold',
    name: 'Manrope',
    source: 'builtin',
    url: 'fonts/Manrope-ExtraBold.ttf',
    previewFamily: 'LogoLab Manrope',
  },
  {
    id: 'plus-jakarta-sans-extrabold',
    name: 'Plus Jakarta Sans',
    source: 'builtin',
    url: 'fonts/PlusJakartaSans-ExtraBold.ttf',
    previewFamily: 'LogoLab Plus Jakarta Sans',
  },
  {
    id: 'rubik-extrabold',
    name: 'Rubik',
    source: 'builtin',
    url: 'fonts/Rubik-Black.ttf',
    previewFamily: 'LogoLab Rubik',
  },
  {
    id: 'sora-extrabold',
    name: 'Sora',
    source: 'builtin',
    url: 'fonts/Sora-ExtraBold.ttf',
    previewFamily: 'LogoLab Sora',
  },
  {
    id: 'space-grotesk-bold',
    name: 'Space Grotesk',
    source: 'builtin',
    url: 'fonts/SpaceGrotesk-Bold.ttf',
    previewFamily: 'LogoLab Space Grotesk',
  },
  {
    id: 'syne-extrabold',
    name: 'Syne',
    source: 'builtin',
    url: 'fonts/Syne-ExtraBold.ttf',
    previewFamily: 'LogoLab Syne',
  },
  {
    id: 'unbounded-black',
    name: 'Unbounded',
    source: 'builtin',
    url: 'fonts/Unbounded-Black.ttf',
    previewFamily: 'LogoLab Unbounded',
  },
  {
    id: 'work-sans-extrabold',
    name: 'Work Sans',
    source: 'builtin',
    url: 'fonts/WorkSans-Black.ttf',
    previewFamily: 'LogoLab Work Sans',
  },
]

export const DEFAULT_FONT_ID = 'rubik-extrabold'

export interface InstalledFont {
  postscriptName: string
  fullName: string
  family: string
}

interface FontData extends InstalledFont {
  blob(): Promise<Blob>
}

declare global {
  interface Window {
    queryLocalFonts?: () => Promise<FontData[]>
  }
}

export function supportsInstalledFonts(): boolean {
  return typeof window !== 'undefined' && typeof window.queryLocalFonts === 'function'
}

export async function listInstalledFonts(): Promise<InstalledFont[]> {
  if (!supportsInstalledFonts()) {
    throw new Error('This browser cannot read fonts installed on your machine.')
  }
  const fonts = await window.queryLocalFonts!()
  return fonts
    .map(({ postscriptName, fullName, family }) => ({ postscriptName, fullName, family }))
    .sort((left, right) => left.fullName.localeCompare(right.fullName))
}

export async function installedFontFile(postscriptName: string): Promise<File> {
  if (!supportsInstalledFonts()) {
    throw new Error('This browser cannot read fonts installed on your machine.')
  }
  const fonts = await window.queryLocalFonts!()
  if (fonts.length === 0) {
    throw new Error('This site is no longer allowed to read your installed fonts.')
  }
  const match = fonts.find((candidate) => candidate.postscriptName === postscriptName)
  if (!match) {
    throw new Error(`${postscriptName} is no longer installed on this machine.`)
  }
  const blob = await match.blob()
  return new File([blob], `${postscriptName}.ttf`, { type: blob.type || 'font/ttf' })
}

export function builtInFontUrl(spec: FontSpec): string {
  if (!spec.url) {
    throw new Error(`Built-in font ${spec.name} has no URL.`)
  }
  return `${import.meta.env.BASE_URL}${spec.url}`
}

function pointLineDistance(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
): number {
  const dx = end.x - start.x
  const dy = end.y - start.y
  if (dx === 0 && dy === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y)
  }
  return Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x) /
    Math.hypot(dx, dy)
}

function flattenQuadratic(
  start: { x: number; y: number },
  control: { x: number; y: number },
  end: { x: number; y: number },
  points: Array<{ x: number; y: number }>,
): void {
  if (pointLineDistance(control, start, end) <= FLATTENING_TOLERANCE) {
    points.push(end)
    return
  }
  const startControl = { x: (start.x + control.x) / 2, y: (start.y + control.y) / 2 }
  const controlEnd = { x: (control.x + end.x) / 2, y: (control.y + end.y) / 2 }
  const midpoint = {
    x: (startControl.x + controlEnd.x) / 2,
    y: (startControl.y + controlEnd.y) / 2,
  }
  flattenQuadratic(start, startControl, midpoint, points)
  flattenQuadratic(midpoint, controlEnd, end, points)
}

function flattenCubic(
  start: { x: number; y: number },
  first: { x: number; y: number },
  second: { x: number; y: number },
  end: { x: number; y: number },
  points: Array<{ x: number; y: number }>,
): void {
  if (
    Math.max(
      pointLineDistance(first, start, end),
      pointLineDistance(second, start, end),
    ) <= FLATTENING_TOLERANCE
  ) {
    points.push(end)
    return
  }
  const startFirst = { x: (start.x + first.x) / 2, y: (start.y + first.y) / 2 }
  const firstSecond = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
  const secondEnd = { x: (second.x + end.x) / 2, y: (second.y + end.y) / 2 }
  const leftControl = {
    x: (startFirst.x + firstSecond.x) / 2,
    y: (startFirst.y + firstSecond.y) / 2,
  }
  const rightControl = {
    x: (firstSecond.x + secondEnd.x) / 2,
    y: (firstSecond.y + secondEnd.y) / 2,
  }
  const midpoint = {
    x: (leftControl.x + rightControl.x) / 2,
    y: (leftControl.y + rightControl.y) / 2,
  }
  flattenCubic(start, startFirst, leftControl, midpoint, points)
  flattenCubic(midpoint, rightControl, secondEnd, end, points)
}

export function flattenPathCommands(commands: PathCommand[]): Array<Array<{ x: number; y: number }>> {
  const contours: Array<Array<{ x: number; y: number }>> = []
  let contour: Array<{ x: number; y: number }> = []
  let current = { x: 0, y: 0 }
  let start = current
  const finish = () => {
    if (contour.length >= 3) {
      const last = contour.at(-1)
      if (last && (last.x !== start.x || last.y !== start.y)) {
        contour.push(start)
      }
      contours.push(contour)
    }
    contour = []
  }
  for (const command of commands) {
    if (command.type === 'M') {
      finish()
      current = { x: command.x, y: command.y }
      start = current
      contour.push(current)
    } else if (command.type === 'L') {
      current = { x: command.x, y: command.y }
      contour.push(current)
    } else if (command.type === 'Q') {
      const end = { x: command.x, y: command.y }
      flattenQuadratic(current, { x: command.x1, y: command.y1 }, end, contour)
      current = end
    } else if (command.type === 'C') {
      const end = { x: command.x, y: command.y }
      flattenCubic(
        current,
        { x: command.x1, y: command.y1 },
        { x: command.x2, y: command.y2 },
        end,
        contour,
      )
      current = end
    } else {
      finish()
      current = start
    }
  }
  finish()
  return contours
}

function toOutline(font: VariableFont, character: string): GlyphOutline {
  const sourceGlyph = font.charToGlyph(character)
  if (sourceGlyph.index === 0 && character.codePointAt(0) !== 0) {
    throw new Error(`“${character}” is not supported by ${font.getEnglishName('fontFamily')}.`)
  }

  const glyph = font.variation?.process.getTransform(sourceGlyph) ?? sourceGlyph
  const scale = OUTLINE_SIZE / font.unitsPerEm
  const glyphPath = glyph.getPath(0, 0, OUTLINE_SIZE)
  const box = glyphPath.getBoundingBox()
  const path = glyphPath.toPathData(3)
  const bounds = {
    x1: box.x1,
    y1: box.y1,
    x2: box.x2,
    y2: box.y2,
  }
  if (
    Object.values(bounds).some((value) => !Number.isFinite(value) || Math.abs(value) > 20_000) ||
    (path && (bounds.x2 <= bounds.x1 || bounds.y2 <= bounds.y1))
  ) {
    throw new Error(`The outline for “${character}” in ${font.getEnglishName('fontFamily')} is malformed.`)
  }

  return {
    character,
    glyphIndex: glyph.index,
    path,
    advance: (glyph.advanceWidth ?? font.unitsPerEm) * scale,
    bounds,
    contours: flattenPathCommands(glyphPath.commands),
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
  const response = await fetch(builtInFontUrl(spec))
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
