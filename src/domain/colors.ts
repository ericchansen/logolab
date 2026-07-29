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

const SHORTHAND_HEX = /^[0-9a-f]{3}$/
const FULL_HEX = /^[0-9a-f]{6}$/

/**
 * Accepts `#RRGGBB`, `RRGGBB`, `#RGB` and `RGB` in any case, and returns the
 * canonical lowercase `#rrggbb` form that `<input type="color">` also produces.
 * Returns null for anything that is not a complete hex color.
 */
export function parseHexColor(input: string): string | null {
  const digits = input.trim().replace(/^#/, '').toLowerCase()
  if (FULL_HEX.test(digits)) {
    return `#${digits}`
  }
  if (SHORTHAND_HEX.test(digits)) {
    return `#${[...digits].map((digit) => digit.repeat(2)).join('')}`
  }
  return null
}

function toLinear(value: number): number {
  const channelValue = value / 255
  return channelValue <= 0.03928
    ? channelValue / 12.92
    : ((channelValue + 0.055) / 1.055) ** 2.4
}

/**
 * Picks readable ink for text drawn directly on `background`, using the WCAG
 * relative luminance of the fill. Falls back to dark ink for unparseable input.
 */
export function readableInkColor(background: string): string {
  const parsed = parseHexColor(background)
  if (!parsed) {
    return '#111111'
  }
  const hex = parsed.slice(1)
  const luminance =
    0.2126 * toLinear(channel(hex, 0)) +
    0.7152 * toLinear(channel(hex, 2)) +
    0.0722 * toLinear(channel(hex, 4))
  return luminance > 0.4 ? '#111111' : '#f5f5f5'
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
