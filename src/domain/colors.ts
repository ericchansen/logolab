const GLYPH_COLORS = [
  '#1B6EF3',
  '#D83B01',
  '#008272',
  '#8764B8',
  '#C239B3',
  '#107C10',
  '#CA5010',
  '#5C2D91',
  '#038387',
  '#E3008C',
  '#498205',
  '#004E8C',
]

export function glyphColor(index: number): string {
  return GLYPH_COLORS[index % GLYPH_COLORS.length] ?? '#1B6EF3'
}

function channel(hex: string, offset: number): number {
  return Number.parseInt(hex.slice(offset, offset + 2), 16)
}

export function mixSrgbColors(colors: string[]): string {
  if (colors.length === 0) {
    throw new Error('At least one color is required to mix an overlap.')
  }
  const normalized = colors.map((color) => color.replace('#', '').padEnd(6, '0'))
  const values = [0, 2, 4].map((offset) =>
    Math.round(normalized.reduce((sum, color) => sum + channel(color, offset), 0) / normalized.length),
  )
  return `#${values.map((value) => value.toString(16).padStart(2, '0')).join('')}`.toUpperCase()
}

export function suggestOverlapColor(left: string, right: string): string {
  return mixSrgbColors([left, right])
}
