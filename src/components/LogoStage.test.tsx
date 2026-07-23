import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LogoStage } from './LogoStage'
import type { DesignDocument, FontRuntime, Point } from '../domain/types'

const design: DesignDocument = {
  schemaVersion: 2,
  fontId: 'test-font',
  fontName: 'Test Font',
  text: 'A',
  glyphs: [{ x: 0, y: 0, color: '#112233' }],
  overlaps: [],
  overlapsStale: false,
  lightBackground: '#FFFFFF',
  darkBackground: '#111111',
  smallProofPx: 32,
  pngLongestSide: 4096,
  updatedAt: '2026-07-22T00:00:00.000Z',
}

const font: FontRuntime = {
  id: 'test-font',
  name: 'Test Font',
  source: 'builtin',
  unitsPerEm: 1000,
  outlines: [
    {
      character: 'A',
      glyphIndex: 1,
      path: 'M0 0H600V-700H0Z',
      advance: 650,
      bounds: { x1: 0, y1: -700, x2: 600, y2: 0 },
      contours: [[
        { x: 0, y: 0 },
        { x: 600, y: 0 },
        { x: 600, y: -700 },
        { x: 0, y: -700 },
        { x: 0, y: 0 },
      ]],
    },
  ],
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderStage(onClearSelection = vi.fn()) {
  render(
    <LogoStage
      design={design}
      font={font}
      viewBox={{ x: -50, y: -750, width: 700, height: 800 }}
      background="#FFFFFF"
      selectedGlyphs={[0]}
      primaryGlyph={0}
      onSelect={vi.fn()}
      onClearSelection={onClearSelection}
      onMove={vi.fn()}
      onViewBoxChange={vi.fn()}
    />,
  )
  return { stage: screen.getByTestId('editor-stage'), onClearSelection }
}

describe('LogoStage selection clearing', () => {
  it('clears selection when empty stage space is clicked', () => {
    const { stage, onClearSelection } = renderStage()
    fireEvent.pointerDown(stage, { button: 0, pointerId: 1 })
    expect(onClearSelection).toHaveBeenCalledOnce()
  })

  it('clears selection with Escape', () => {
    const { stage, onClearSelection } = renderStage()
    fireEvent.keyDown(stage, { key: 'Escape', code: 'Escape' })
    expect(onClearSelection).toHaveBeenCalledOnce()
  })
})

describe('LogoStage keyboard movement', () => {
  it('toggles a glyph into the selection with Shift-click', () => {
    const onSelect = vi.fn()
    render(
      <LogoStage
        design={design}
        font={font}
        viewBox={{ x: -50, y: -750, width: 700, height: 800 }}
        background="#FFFFFF"
        selectedGlyphs={[]}
        primaryGlyph={null}
        onSelect={onSelect}
        onClearSelection={vi.fn()}
        onMove={vi.fn()}
        onViewBoxChange={vi.fn()}
      />,
    )
    const stage = screen.getByTestId('editor-stage')
    const hit = stage.querySelector<SVGPathElement>('[data-glyph-hit="0"]')
    fireEvent.pointerDown(hit as SVGPathElement, {
      button: 0,
      pointerId: 1,
      shiftKey: true,
    })

    expect(onSelect).toHaveBeenCalledWith(0, 'toggle')
    expect(document.activeElement).toBe(stage)
  })

  it('keeps moving on repeated arrow keydowns after a glyph is clicked', () => {
    const onMove = vi.fn()

    function MovingStage() {
      const [currentDesign, setCurrentDesign] = useState(design)

      function moveGlyph(indices: readonly number[], delta: Point) {
        onMove(indices, delta)
        setCurrentDesign((current) => ({
          ...current,
          glyphs: current.glyphs.map((glyph, glyphIndex) =>
            indices.includes(glyphIndex)
              ? { ...glyph, x: glyph.x + delta.x, y: glyph.y + delta.y }
              : glyph,
          ),
        }))
      }

      return (
        <LogoStage
          design={currentDesign}
          font={font}
          viewBox={{ x: -50, y: -750, width: 700, height: 800 }}
          background="#FFFFFF"
          selectedGlyphs={[0]}
          primaryGlyph={0}
          onSelect={vi.fn()}
          onClearSelection={vi.fn()}
          onMove={moveGlyph}
          onViewBoxChange={vi.fn()}
        />
      )
    }

    vi.stubGlobal('DOMPoint', class {
      constructor(
        public x = 0,
        public y = 0,
      ) {}

      matrixTransform() {
        return this
      }
    })

    render(<MovingStage />)
    const stage = screen.getByTestId('editor-stage')
    const svg = stage.querySelector('svg')
    const hit = stage.querySelector<SVGPathElement>('[data-glyph-hit="0"]')
    expect(svg).not.toBeNull()
    expect(hit).not.toBeNull()
    Object.defineProperty(svg, 'getScreenCTM', {
      value: () => ({ inverse: () => ({}) }),
    })
    Object.defineProperty(stage, 'setPointerCapture', { value: vi.fn() })

    hit?.focus()
    fireEvent.pointerDown(hit as SVGPathElement, {
      button: 0,
      pointerId: 1,
      clientX: 10,
      clientY: 20,
    })
    expect(document.activeElement).toBe(stage)

    fireEvent.keyDown(document.activeElement as HTMLElement, {
      key: 'ArrowRight',
      code: 'ArrowRight',
    })
    fireEvent.keyDown(document.activeElement as HTMLElement, {
      key: 'ArrowRight',
      code: 'ArrowRight',
      repeat: true,
    })

    expect(onMove).toHaveBeenCalledTimes(2)
    expect(onMove).toHaveBeenNthCalledWith(1, [0], { x: 1, y: 0 })
    expect(onMove).toHaveBeenNthCalledWith(2, [0], { x: 1, y: 0 })
  })
})
