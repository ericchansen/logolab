import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LogoStage } from './LogoStage'
import type { DesignDocument, FontRuntime } from '../domain/types'

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

afterEach(cleanup)

function renderStage(onClearSelection = vi.fn()) {
  render(
    <LogoStage
      design={design}
      font={font}
      viewBox={{ x: -50, y: -750, width: 700, height: 800 }}
      background="#FFFFFF"
      selectedGlyph={0}
      moveMode="single"
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
