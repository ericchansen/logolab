import { afterEach, describe, expect, it } from 'vitest'
import type { PathCommand } from 'opentype.js'
import {
  flattenPathCommands,
  installedFontFile,
  listInstalledFonts,
  supportsInstalledFonts,
} from './fonts'

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

describe('installed fonts', () => {
  afterEach(() => {
    delete window.queryLocalFonts
  })

  function stubInstalled(fonts: Array<{ postscriptName: string; fullName: string; family: string }>) {
    window.queryLocalFonts = () =>
      Promise.resolve(
        fonts.map((font) => ({
          ...font,
          blob: () =>
            Promise.resolve(new Blob([new Uint8Array([0, 1, 0, 0])], { type: 'font/ttf' })),
        })),
      )
  }

  it('reports no support when the browser lacks the API', async () => {
    expect(supportsInstalledFonts()).toBe(false)
    await expect(listInstalledFonts()).rejects.toThrow(/cannot read fonts installed/i)
    await expect(installedFontFile('SegoeUI')).rejects.toThrow(/cannot read fonts installed/i)
  })

  it('sorts installed fonts by full name', async () => {
    stubInstalled([
      { postscriptName: 'SegoeUI-Bold', fullName: 'Segoe UI Bold', family: 'Segoe UI' },
      { postscriptName: 'Arial', fullName: 'Arial', family: 'Arial' },
    ])
    expect((await listInstalledFonts()).map((font) => font.fullName)).toEqual([
      'Arial',
      'Segoe UI Bold',
    ])
  })

  it('reads the file for an installed font', async () => {
    stubInstalled([{ postscriptName: 'SegoeUI', fullName: 'Segoe UI', family: 'Segoe UI' }])
    const file = await installedFontFile('SegoeUI')
    expect(file.name).toBe('SegoeUI.ttf')
    expect(file.size).toBe(4)
  })

  it('reports a blocked permission rather than a missing font', async () => {
    stubInstalled([])
    await expect(installedFontFile('SegoeUI')).rejects.toThrow(/no longer allowed/i)
  })

  it('reports a font that is no longer installed', async () => {
    stubInstalled([{ postscriptName: 'Arial', fullName: 'Arial', family: 'Arial' }])
    await expect(installedFontFile('SegoeUI')).rejects.toThrow(/no longer installed/i)
  })
})
