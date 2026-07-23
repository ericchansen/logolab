import { describe, expect, it } from 'vitest'
import type { PathCommand } from 'opentype.js'
import { flattenPathCommands } from './fonts'

describe('font outline flattening', () => {
  it('flattens quadratic and cubic curves while preserving contour endpoints', () => {
    const commands: PathCommand[] = [
      { type: 'M', x: 0, y: 0 },
      { type: 'Q', x1: 50, y1: -100, x: 100, y: 0 },
      { type: 'C', x1: 125, y1: 100, x2: 175, y2: 100, x: 200, y: 0 },
      { type: 'L', x: 0, y: 0 },
      { type: 'Z' },
    ]
    const contours = flattenPathCommands(commands)
    expect(contours).toHaveLength(1)
    expect(contours[0]?.length).toBeGreaterThan(10)
    expect(contours[0]?.[0]).toEqual({ x: 0, y: 0 })
    expect(contours[0]?.at(-1)).toEqual({ x: 0, y: 0 })
  })
})
