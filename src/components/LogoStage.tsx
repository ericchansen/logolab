import {
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
} from 'react'
import { buildSvgMarkup } from '../domain/svg'
import type {
  DesignDocument,
  FontRuntime,
  Point,
  Rect,
} from '../domain/types'

export type GlyphSelectionAction = 'replace' | 'toggle' | 'primary'

interface LogoStageProps {
  design: DesignDocument
  font: FontRuntime
  viewBox: Rect
  background: string
  selectedGlyphs: readonly number[]
  primaryGlyph: number | null
  onSelect: (index: number, action: GlyphSelectionAction) => void
  onClearSelection: () => void
  onMove: (indices: readonly number[], delta: Point) => void
  onViewBoxChange: (viewBox: Rect) => void
}

type DragState =
  | {
      kind: 'glyph'
      indices: readonly number[]
      previous: Point
    }
  | {
      kind: 'pan'
      startClient: Point
      startViewBox: Rect
    }

let renderSequence = 0

function clientToSvg(target: HTMLElement, clientX: number, clientY: number): Point {
  const svg = target.querySelector('svg')
  const matrix = svg?.getScreenCTM()
  if (!svg || !matrix) {
    throw new Error('The proof coordinate system is not available.')
  }
  const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse())
  return { x: point.x, y: point.y }
}

export function LogoStage({
  design,
  font,
  viewBox,
  background,
  selectedGlyphs,
  primaryGlyph,
  onSelect,
  onClearSelection,
  onMove,
  onViewBoxChange,
}: LogoStageProps) {
  const drag = useRef<DragState | null>(null)
  const [spacePressed, setSpacePressed] = useState(false)
  const renderId = `editor-${++renderSequence}`
  const markup = useMemo(
    () =>
      buildSvgMarkup(design, font, {
        renderId,
        viewBox,
        selectedGlyphs,
        primaryGlyph,
        interactive: true,
        className: 'logo-svg',
      }),
    [design, font, primaryGlyph, renderId, selectedGlyphs, viewBox],
  )

  function beginDrag(event: PointerEvent<HTMLDivElement>) {
    const hit =
      event.target instanceof Element
        ? event.target.closest<SVGPathElement>('[data-glyph-hit]')
        : null
    const hitIndex = Number(hit?.dataset.glyphHit)
    if (hit && Number.isInteger(hitIndex) && event.button === 0 && !spacePressed) {
      event.preventDefault()
      event.currentTarget.focus({ preventScroll: true })
      if (event.shiftKey) {
        onSelect(hitIndex, 'toggle')
        return
      }
      const point = clientToSvg(event.currentTarget, event.clientX, event.clientY)
      const alreadySelected = selectedGlyphs.includes(hitIndex)
      const dragIndices = alreadySelected ? selectedGlyphs : [hitIndex]
      onSelect(hitIndex, alreadySelected ? 'primary' : 'replace')
      drag.current = { kind: 'glyph', indices: dragIndices, previous: point }
    } else if (spacePressed || event.button === 1) {
      event.preventDefault()
      drag.current = {
        kind: 'pan',
        startClient: { x: event.clientX, y: event.clientY },
        startViewBox: { ...viewBox },
      }
    } else if (event.button === 0) {
      onClearSelection()
      return
    } else {
      return
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function continueDrag(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) {
      return
    }
    if (drag.current.kind === 'glyph') {
      const point = clientToSvg(event.currentTarget, event.clientX, event.clientY)
      const delta = {
        x: point.x - drag.current.previous.x,
        y: point.y - drag.current.previous.y,
      }
      onMove(drag.current.indices, delta)
      drag.current.previous = point
    } else {
      const bounds = event.currentTarget.getBoundingClientRect()
      const deltaX =
        ((event.clientX - drag.current.startClient.x) *
          drag.current.startViewBox.width) /
        bounds.width
      const deltaY =
        ((event.clientY - drag.current.startClient.y) *
          drag.current.startViewBox.height) /
        bounds.height
      onViewBoxChange({
        ...drag.current.startViewBox,
        x: drag.current.startViewBox.x - deltaX,
        y: drag.current.startViewBox.y - deltaY,
      })
    }
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClearSelection()
      return
    }
    if (event.code === 'Space') {
      event.preventDefault()
      setSpacePressed(true)
      return
    }
    const step = event.shiftKey ? 10 : 1
    const deltas: Record<string, Point> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    }
    const delta = deltas[event.key]
    if (delta && selectedGlyphs.length > 0) {
      event.preventDefault()
      onMove(selectedGlyphs, delta)
    }
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    event.preventDefault()
    const scale = event.deltaY > 0 ? 1.12 : 0.89
    const centerX = viewBox.x + viewBox.width / 2
    const centerY = viewBox.y + viewBox.height / 2
    const width = viewBox.width * scale
    const height = viewBox.height * scale
    onViewBoxChange({
      x: centerX - width / 2,
      y: centerY - height / 2,
      width,
      height,
    })
  }

  return (
    <div
      className={`editor-stage${spacePressed ? ' is-panning' : ''}`}
      style={{ background }}
      role="application"
      aria-label="Interactive logo proof. Click a letter to select it, or Shift-click to select multiple letters. Drag a selected letter to move the selection. Click empty space or press Escape to clear the selection. Hold Space and drag to pan. Use arrow keys to nudge selected letters."
      tabIndex={0}
      data-testid="editor-stage"
      onPointerDown={beginDrag}
      onPointerMove={continueDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={handleKeyDown}
      onKeyUp={(event) => {
        if (event.code === 'Space') {
          setSpacePressed(false)
        }
      }}
      onBlur={() => setSpacePressed(false)}
      onWheel={handleWheel}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  )
}
