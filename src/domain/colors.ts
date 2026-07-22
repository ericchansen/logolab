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

const PAIR_COLORS = [
  '#00A4EF',
  '#FFB900',
  '#7FBA00',
  '#F25022',
  '#8661C5',
  '#00B294',
  '#D13438',
  '#4F6BED',
  '#C19C00',
  '#E43BA6',
  '#13A10E',
]

export function glyphColor(index: number): string {
  return GLYPH_COLORS[index % GLYPH_COLORS.length] ?? '#1B6EF3'
}

export function pairColor(index: number): string {
  return PAIR_COLORS[index % PAIR_COLORS.length] ?? '#00A4EF'
}

function channel(hex: string, offset: number): number {
  return Number.parseInt(hex.slice(offset, offset + 2), 16)
}

export function suggestOverlapColor(left: string, right: string): string {
  const normalizedLeft = left.replace('#', '').padEnd(6, '0')
  const normalizedRight = right.replace('#', '').padEnd(6, '0')
  const values = [0, 2, 4].map((offset) =>
    Math.round(
      (channel(normalizedLeft, offset) + channel(normalizedRight, offset)) / 2,
    ),
  )
  return `#${values.map((value) => value.toString(16).padStart(2, '0')).join('')}`.toUpperCase()
}
