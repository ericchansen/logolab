import { describe, expect, it } from 'vitest'

import { parseHexColor, readableInkColor } from './colors'

describe('parseHexColor', () => {
  it('accepts full hex with and without a leading hash', () => {
    expect(parseHexColor('#e3008c')).toBe('#e3008c')
    expect(parseHexColor('e3008c')).toBe('#e3008c')
  })

  it('lowercases uppercase and mixed-case input', () => {
    expect(parseHexColor('#E3008C')).toBe('#e3008c')
    expect(parseHexColor('E3008c')).toBe('#e3008c')
  })

  it('expands three-digit shorthand with and without a leading hash', () => {
    expect(parseHexColor('#abc')).toBe('#aabbcc')
    expect(parseHexColor('abc')).toBe('#aabbcc')
    expect(parseHexColor('#FFF')).toBe('#ffffff')
  })

  it('trims surrounding whitespace', () => {
    expect(parseHexColor('  #e3008c \n')).toBe('#e3008c')
    expect(parseHexColor('\t abc ')).toBe('#aabbcc')
  })

  it('rejects anything that is not a complete hex color', () => {
    for (const input of [
      '',
      '   ',
      '#',
      '#ab',
      '#abcd',
      '#abcde',
      '#abcdefa',
      'e3008g',
      '#e3008g',
      'rebeccapurple',
      'rgb(1, 2, 3)',
      '##abc',
      '#ab c',
    ]) {
      expect(parseHexColor(input), input).toBeNull()
    }
  })
})

describe('readableInkColor', () => {
  it('uses dark ink on light backgrounds', () => {
    expect(readableInkColor('#ffffff')).toBe('#111111')
    expect(readableInkColor('#F7F9FC')).toBe('#111111')
    expect(readableInkColor('#fff')).toBe('#111111')
  })

  it('uses light ink on dark backgrounds', () => {
    expect(readableInkColor('#1a1a1a')).toBe('#f5f5f5')
    expect(readableInkColor('#172033')).toBe('#f5f5f5')
    expect(readableInkColor('#000000')).toBe('#f5f5f5')
  })

  it('falls back to dark ink for unparseable input', () => {
    expect(readableInkColor('not a color')).toBe('#111111')
  })
})
