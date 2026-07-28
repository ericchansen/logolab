import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent,
} from 'react'
import { LogoStage, type GlyphSelectionAction } from './components/LogoStage'
import { RUBIK_LOGOLAB_PRESET } from './domain/defaultPreset'
import {
  createDesign,
  refreshMixedOverlapColors,
  resolveDesign,
  validatePortableDesign,
} from './domain/design'
import { downloadDesign, downloadPng, downloadSvg } from './domain/export'
import {
  BUILT_IN_FONTS,
  DEFAULT_FONT_ID,
  builtInFontUrl,
  createStoredFont,
  installedFontFile,
  listInstalledFonts,
  loadBuiltInFont,
  loadStoredFont,
  normalizeStoredFont,
  supportsInstalledFonts,
  type InstalledFont,
} from './domain/fonts'
import {
  averageGlyphGap,
  expandRect,
  getDesignBounds,
  getPaintedBounds,
  moveGlyphs,
  normalizeDesignCoordinates,
  setAverageGlyphGap,
} from './domain/geometry'
import { recalculateOverlaps } from './domain/overlaps'
import {
  deleteStoredFont,
  getStoredFonts,
  loadDesign,
  putStoredFont,
  removeDesignsForFont,
  trySaveDesign,
} from './domain/persistence'
import { buildSvgMarkup } from './domain/svg'
import type {
  DesignDocument,
  FontRuntime,
  FontSpec,
  Point,
  Rect,
  StoredFont,
} from './domain/types'

const INITIAL_TEXT = 'LogoLab'
const PNG_PRESETS = [512, 1024, 2048, 4096]
let proofRenderSequence = 0

interface GlyphSelection {
  indices: number[]
  primary: number | null
}

function clampGlyphSelection(selection: GlyphSelection, glyphCount: number): GlyphSelection {
  if (selection.primary === null || glyphCount === 0) {
    return { indices: [], primary: null }
  }
  const lastIndex = glyphCount - 1
  const primary = Math.min(selection.primary, lastIndex)
  const indices = [...new Set(
    selection.indices
      .filter((index) => index >= 0)
      .map((index) => Math.min(index, lastIndex)),
  )]
  if (!indices.includes(primary)) {
    indices.push(primary)
  }
  return { indices, primary }
}

function withUpdatedTime(design: DesignDocument): DesignDocument {
  return { ...design, updatedAt: new Date().toISOString() }
}

function proofMarkup(
  design: DesignDocument,
  font: FontRuntime,
  renderId: string,
): string {
  return buildSvgMarkup(design, font, {
    renderId,
    viewBox: getPaintedBounds(design, font),
    className: 'logo-svg',
  })
}

function glyphLabel(character: string): string {
  return character === ' ' ? '␠' : character
}

function App() {
  const [storedFonts, setStoredFonts] = useState<StoredFont[]>([])
  const [installedFonts, setInstalledFonts] = useState<InstalledFont[] | null>(null)
  const [installedFilter, setInstalledFilter] = useState('')
  const [font, setFont] = useState<FontRuntime | null>(null)
  const [design, setDesign] = useState<DesignDocument | null>(null)
  const [textDraft, setTextDraft] = useState(INITIAL_TEXT)
  const [smallProofDraft, setSmallProofDraft] = useState('32')
  const [isSmallProofEditing, setIsSmallProofEditing] = useState(false)
  const [selection, setSelection] = useState<GlyphSelection>({ indices: [0], primary: 0 })
  const [layerFocusIndex, setLayerFocusIndex] = useState(0)
  const [viewBox, setViewBox] = useState<Rect>({
    x: 0,
    y: -1000,
    width: 3600,
    height: 1400,
  })
  const [status, setStatus] = useState('Loading…')
  const [error, setError] = useState('')
  const [geometryFeedback, setGeometryFeedback] = useState('')
  const [isBusy, setIsBusy] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const requestId = useRef(0)
  const exportId = useRef(0)
  const editVersion = useRef(0)
  const textVersion = useRef(0)
  const textDraftRef = useRef(INITIAL_TEXT)
  const pendingFontSpec = useRef<FontSpec | null>(null)
  const autosaveSuppressed = useRef(false)
  const deletedFontIds = useRef(new Set<string>())
  const tombstonedFonts = useRef(new Map<string, StoredFont>())
  const smallProofEditStart = useRef(32)
  const exportTriggerRef = useRef<HTMLButtonElement>(null)
  const exportPopoverRef = useRef<HTMLDivElement>(null)

  const fontSpecs = useMemo<FontSpec[]>(
    () => [
      ...BUILT_IN_FONTS,
      ...storedFonts.map(({ id, name, fileName }) => ({
        id,
        name,
        fileName,
        source: 'local' as const,
        previewFamily: `LogoLab Local ${id}`,
      })),
    ],
    [storedFonts],
  )

  const visibleInstalledFonts = useMemo(() => {
    if (!installedFonts) {
      return []
    }
    const needle = installedFilter.trim().toLowerCase()
    const matches = needle
      ? installedFonts.filter((candidate) =>
          candidate.fullName.toLowerCase().includes(needle),
        )
      : installedFonts
    return matches.slice(0, 60)
  }, [installedFonts, installedFilter])

  function persistDesign(nextDesign: DesignDocument): boolean {
    if (deletedFontIds.current.has(nextDesign.fontId)) {
      return true
    }
    const result = trySaveDesign(nextDesign)
    if (result.ok) {
      return true
    }
    setError('Could not save locally. Free browser storage or export JSON, then try again.')
    return false
  }

  function validatedDraft(): string | null {
    if (Array.from(textDraft).length === 0) {
      setError('Text cannot be empty.')
      return null
    }
    return textDraft
  }

  function replaceTextDraft(text: string) {
    textDraftRef.current = text
    setTextDraft(text)
  }

  function specForFont(fontId: string): FontSpec | undefined {
    const available = fontSpecs.find((candidate) => candidate.id === fontId)
    if (available) {
      return available
    }
    const tombstoned = tombstonedFonts.current.get(fontId)
    return tombstoned
      ? {
          id: tombstoned.id,
          name: tombstoned.name,
          fileName: tombstoned.fileName,
          source: 'local',
        }
      : undefined
  }

  async function loadRuntime(spec: FontSpec, text: string): Promise<FontRuntime> {
    const storedFont =
      spec.source === 'local'
        ? storedFonts.find((candidate) => candidate.id === spec.id) ??
          tombstonedFonts.current.get(spec.id)
        : undefined
    return storedFont
      ? loadStoredFont(storedFont, text)
      : loadBuiltInFont(spec, text)
  }

  useEffect(() => {
    const loadedFaces: FontFace[] = []
    const specs = [
      ...BUILT_IN_FONTS.map((spec) => ({
        family: spec.previewFamily,
        source: `url("${builtInFontUrl(spec)}")`,
      })),
      ...storedFonts.map((stored) => ({
        family: `LogoLab Local ${stored.id}`,
        source: `url("${stored.dataUrl}")`,
      })),
    ]
    for (const spec of specs) {
      if (!spec.family) {
        continue
      }
      const face = new FontFace(spec.family, spec.source)
      loadedFaces.push(face)
      void face.load().then((loaded) => document.fonts.add(loaded)).catch(() => undefined)
    }
    return () => {
      for (const face of loadedFaces) {
        document.fonts.delete(face)
      }
    }
  }, [storedFonts])

  async function openDesign(
    spec: FontSpec,
    text: string,
    imported?: DesignDocument,
    skipCurrentSave = false,
  ): Promise<DesignDocument | null> {
    if (design && !skipCurrentSave && !persistDesign(design)) {
      return null
    }
    const operation = ++requestId.current
    const startingEditVersion = editVersion.current
    const startingTextVersion = textVersion.current
    pendingFontSpec.current = spec
    setIsBusy(true)
    setError('')
    setStatus(`Loading ${spec.name}…`)
    try {
      const runtime = await loadRuntime(spec, text)
      if (operation !== requestId.current) {
        return null
      }
      if (startingTextVersion !== textVersion.current) {
        const latestText = textDraftRef.current
        if (Array.from(latestText).length === 0) {
          pendingFontSpec.current = null
          setError('Text cannot be empty.')
          return null
        }
        return openDesign(spec, latestText, imported, skipCurrentSave)
      }
      if (startingEditVersion !== editVersion.current) {
        pendingFontSpec.current = null
        setError('The design changed while the font was loading. Choose the font again.')
        return null
      }
      const savedDesign = imported ?? loadDesign(spec.id, text)
      const initialDesign =
        savedDesign ??
        (spec.id === DEFAULT_FONT_ID && text === INITIAL_TEXT
          ? RUBIK_LOGOLAB_PRESET
          : createDesign(runtime, text))
      const nextDesign = resolveDesign(initialDesign, runtime)
      if (nextDesign.glyphs.length !== runtime.outlines.length) {
        throw new Error('The saved design no longer matches its text.')
      }
      setFont(runtime)
      setDesign(nextDesign)
      replaceTextDraft(text)
      pendingFontSpec.current = null
      setSelection((current) => clampGlyphSelection(current, nextDesign.glyphs.length))
      setLayerFocusIndex((current) => Math.min(current, nextDesign.glyphs.length - 1))
      setViewBox(expandRect(getPaintedBounds(nextDesign, runtime), 100))
      setStatus('')
      return nextDesign
    } catch (caught) {
      if (operation !== requestId.current) {
        return null
      }
      pendingFontSpec.current = null
      setError(caught instanceof Error ? caught.message : 'The font could not be loaded.')
      setStatus('')
      return null
    } finally {
      if (operation === requestId.current) {
        setIsBusy(false)
      }
    }
  }

  useEffect(() => {
    let active = true
    void getStoredFonts()
      .then((fonts) => {
        if (active) {
          setStoredFonts(fonts)
        }
      })
      .catch(() => {
        if (active) {
          setError('Local fonts could not be restored.')
        }
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const defaultFont = BUILT_IN_FONTS.find((candidate) => candidate.id === DEFAULT_FONT_ID)
    if (defaultFont) {
      void openDesign(defaultFont, INITIAL_TEXT)
    }
  }, [])

  useEffect(() => {
    if (!design || autosaveSuppressed.current) {
      return
    }
    setIsSaving(true)
    if (!persistDesign(design)) {
      setIsSaving(false)
      return
    }
    const timer = window.setTimeout(() => setIsSaving(false), 180)
    return () => window.clearTimeout(timer)
  }, [design])

  useEffect(() => {
    if (design && !isSmallProofEditing) {
      setSmallProofDraft(String(design.smallProofPx))
    }
  }, [design, isSmallProofEditing])

  useEffect(() => {
    if (!design || textDraft === design.text) {
      return
    }
    const scheduledRequest = requestId.current
    const timer = window.setTimeout(() => {
      if (scheduledRequest !== requestId.current) {
        return
      }
      if (Array.from(textDraft).length === 0) {
        setError('Text cannot be empty.')
        return
      }
      const activeSpec = pendingFontSpec.current ?? specForFont(design.fontId)
      if (activeSpec) {
        void openDesign(activeSpec, textDraft)
      }
    }, 240)
    return () => window.clearTimeout(timer)
  }, [design, fontSpecs, textDraft])

  function updateDesign(update: (current: DesignDocument) => DesignDocument) {
    editVersion.current += 1
    setGeometryFeedback('')
    setDesign((current) => (current ? update(current) : current))
  }

  function updateSmallProofDraft(value: string) {
    setSmallProofDraft(value)
    if (value.trim() === '') {
      return
    }
    const size = Number(value)
    if (Number.isInteger(size) && size >= 8 && size <= 64) {
      setError('')
      updateDesign((current) =>
        withUpdatedTime({ ...current, smallProofPx: size }),
      )
    }
  }

  function commitSmallProofDraft() {
    if (!design) {
      return
    }
    const size = Number(smallProofDraft)
    if (
      smallProofDraft.trim() === '' ||
      !Number.isInteger(size) ||
      size < 8 ||
      size > 64
    ) {
      setError('Small proof size must be a whole number from 8 to 64 px.')
      setSmallProofDraft(String(design.smallProofPx))
    } else {
      setError('')
      setSmallProofDraft(String(size))
      if (design.smallProofPx !== size) {
        updateDesign((current) =>
          withUpdatedTime({ ...current, smallProofPx: size }),
        )
      }
    }
    setIsSmallProofEditing(false)
  }

  function cancelSmallProofEdit() {
    const size = smallProofEditStart.current
    setSmallProofDraft(String(size))
    setError('')
    setIsSmallProofEditing(false)
    if (design?.smallProofPx !== size) {
      updateDesign((current) =>
        withUpdatedTime({ ...current, smallProofPx: size }),
      )
    }
  }

  function switchFont(spec: FontSpec) {
    const draft = validatedDraft()
    if (draft) {
      void openDesign(spec, draft)
    }
  }

  function fitProof() {
    if (design && font) {
      setViewBox(expandRect(getPaintedBounds(design, font), 100))
    }
  }

  function zoom(factor: number) {
    setViewBox((current) => {
      const centerX = current.x + current.width / 2
      const centerY = current.y + current.height / 2
      const width = current.width * factor
      const height = current.height * factor
      return {
        x: centerX - width / 2,
        y: centerY - height / 2,
        width,
        height,
      }
    })
  }

  function updateGlyphSelection(index: number, action: GlyphSelectionAction) {
    setLayerFocusIndex(index)
    setSelection((current) => {
      if (action === 'replace' || !current.indices.includes(index)) {
        if (action === 'toggle' && !current.indices.includes(index)) {
          return { indices: [...current.indices, index], primary: index }
        }
        return { indices: [index], primary: index }
      }
      if (action === 'primary') {
        return { ...current, primary: index }
      }
      const indices = current.indices.filter((candidate) => candidate !== index)
      return {
        indices,
        primary: current.primary === index ? indices.at(-1) ?? null : current.primary,
      }
    })
  }

  function activateGlyphSelection(index: number, toggle: boolean) {
    updateGlyphSelection(
      index,
      toggle ? 'toggle' : selection.indices.includes(index) ? 'primary' : 'replace',
    )
  }

  function handleLayerKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const lastIndex = Array.from(design?.text ?? '').length - 1
    let nextIndex: number | null = null
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      nextIndex = Math.min(index + 1, lastIndex)
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      nextIndex = Math.max(index - 1, 0)
    } else if (event.key === 'Home') {
      nextIndex = 0
    } else if (event.key === 'End') {
      nextIndex = lastIndex
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      activateGlyphSelection(index, event.shiftKey)
      return
    }
    if (nextIndex !== null) {
      event.preventDefault()
      setLayerFocusIndex(nextIndex)
      event.currentTarget.parentElement
        ?.querySelector<HTMLButtonElement>(`[data-glyph-index="${nextIndex}"]`)
        ?.focus()
    }
  }

  function handleMove(indices: readonly number[], delta: Point) {
    updateDesign((current) => moveGlyphs(current, indices, delta))
  }

  function updatePrimaryCoordinate(axis: 'x' | 'y', value: number) {
    const primary = selection.primary
    if (primary === null) {
      return
    }
    updateDesign((current) => {
      const glyph = current.glyphs[primary]
      if (!glyph) {
        return current
      }
      const delta = axis === 'x'
        ? { x: value - glyph.x, y: 0 }
        : { x: 0, y: value - glyph.y }
      return moveGlyphs(current, selection.indices, delta)
    })
  }

  function recalculate() {
    if (!design || !font) {
      return
    }
    const refreshed = recalculateOverlaps(design, font)
    editVersion.current += 1
    setDesign(refreshed)
    persistDesign(refreshed)
    setGeometryFeedback('')
  }

  function normalizeCoordinates() {
    if (!design || !font) {
      return
    }
    setError('')
    setGeometryFeedback('')
    try {
      const normalized = normalizeDesignCoordinates(design, selection.primary ?? 0)
      if (normalized === design) {
        setGeometryFeedback('Coordinates are already normalized to 0,0.')
        return
      }
      const refreshed = recalculateOverlaps(normalized, font)
      editVersion.current += 1
      setDesign(refreshed)
      setViewBox(expandRect(getPaintedBounds(refreshed, font), 100))
      if (persistDesign(refreshed)) {
        setGeometryFeedback('Coordinates normalized to 0,0.')
      }
    } catch (caught) {
      setGeometryFeedback('')
      const detail = caught instanceof Error ? ` ${caught.message}` : ''
      setError(`Coordinates could not be normalized.${detail}`)
    }
  }

  async function prepareExport(): Promise<{
    design: DesignDocument
    font: FontRuntime
  } | null> {
    if (!design || !font) {
      return null
    }
    const operation = ++exportId.current
    const startingRequest = requestId.current
    const startingEditVersion = editVersion.current
    const startingTextVersion = textVersion.current
    const startingDesign = design
    const draft = textDraft
    setIsBusy(true)
    setError('')
    try {
      let accurateDesign = startingDesign
      let accurateFont = font
      if (draft !== startingDesign.text) {
        if (Array.from(draft).length === 0) {
          setError('Text cannot be empty.')
          return null
        }
        const activeSpec = specForFont(startingDesign.fontId)
        if (!activeSpec) {
          setError('The active font is unavailable.')
          return null
        }
        accurateFont = await loadRuntime(activeSpec, draft)
        if (
          operation !== exportId.current ||
          startingRequest !== requestId.current
        ) {
          return null
        }
        const savedDesign = loadDesign(activeSpec.id, draft)
        const initialDesign =
          savedDesign ??
          (activeSpec.id === DEFAULT_FONT_ID && draft === INITIAL_TEXT
            ? RUBIK_LOGOLAB_PRESET
            : createDesign(accurateFont, draft))
        accurateDesign = resolveDesign(initialDesign, accurateFont)
      }
      if (
        operation !== exportId.current ||
        startingRequest !== requestId.current
      ) {
        return null
      }
      if (startingEditVersion !== editVersion.current) {
        setError('The design changed while export was preparing. Export again.')
        return null
      }
      if (startingTextVersion !== textVersion.current) {
        setError('The text changed while export was preparing. Export again.')
        return null
      }
      if (accurateDesign.overlapsStale) {
        accurateDesign = recalculateOverlaps(accurateDesign, accurateFont)
      }
      if (
        operation !== exportId.current ||
        startingRequest !== requestId.current ||
        startingEditVersion !== editVersion.current ||
        startingTextVersion !== textVersion.current
      ) {
        if (
          operation === exportId.current &&
          startingRequest === requestId.current
        ) {
          setError('The design changed while export was preparing. Export again.')
        }
        return null
      }
      if (accurateDesign !== startingDesign) {
        setFont(accurateFont)
        setDesign(accurateDesign)
        replaceTextDraft(draft)
        setSelection((current) => clampGlyphSelection(current, accurateDesign.glyphs.length))
        setLayerFocusIndex((current) => Math.min(current, accurateDesign.glyphs.length - 1))
        setViewBox(expandRect(getDesignBounds(accurateDesign, accurateFont), 100))
        persistDesign(accurateDesign)
      }
      return { design: accurateDesign, font: accurateFont }
    } catch (caught) {
      if (
        operation === exportId.current &&
        startingRequest === requestId.current
      ) {
        setError(caught instanceof Error ? caught.message : 'Export failed.')
      }
      return null
    } finally {
      if (
        operation === exportId.current &&
        startingRequest === requestId.current
      ) {
        setIsBusy(false)
      }
    }
  }

  async function runExport(kind: 'svg' | 'png' | 'json') {
    if (isBusy) {
      setError('Wait for the current font operation to finish, then export again.')
      return
    }
    try {
      const prepared = await prepareExport()
      if (!prepared) {
        return
      }
      if (kind === 'svg') {
        downloadSvg(prepared.design, prepared.font)
      } else if (kind === 'png') {
        await downloadPng(prepared.design, prepared.font)
      } else {
        const stored = storedFonts.find(
          (candidate) => candidate.id === prepared.design.fontId,
        ) ?? tombstonedFonts.current.get(prepared.design.fontId)
        downloadDesign(prepared.design, stored)
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Export failed.')
    }
  }

  function positionExportPopover() {
    const trigger = exportTriggerRef.current
    const popover = exportPopoverRef.current
    if (!trigger || !popover) {
      return
    }
    const bounds = trigger.getBoundingClientRect()
    popover.style.setProperty('--export-top', `${bounds.bottom + 7}px`)
    popover.style.setProperty('--export-right', `${Math.max(8, window.innerWidth - bounds.right)}px`)
  }

  function runExportFromPopover(kind: 'svg' | 'png' | 'json') {
    exportPopoverRef.current?.hidePopover()
    exportTriggerRef.current?.focus()
    void runExport(kind)
  }

  async function uploadFont(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) {
      return
    }
    if (!/\.(ttf|otf)$/i.test(file.name)) {
      setError('Choose a TTF or OTF font file.')
      return
    }
    await ingestFont(file)
  }

  async function revealInstalledFonts() {
    setError('')
    try {
      const installed = await listInstalledFonts()
      if (installed.length === 0) {
        setError(
          'This site is blocked from reading your installed fonts. Allow font access in your browser site permissions, then try again.',
        )
        return
      }
      setInstalledFonts(installed)
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Fonts installed on this machine could not be read.',
      )
    }
  }

  async function useInstalledFont(postscriptName: string) {
    setError('')
    try {
      await ingestFont(await installedFontFile(postscriptName))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The font could not be read.')
    }
  }

  async function ingestFont(file: File) {
    if (file.size > 10 * 1024 * 1024) {
      setError('Local font files must be 10 MB or smaller.')
      return
    }
    const targetText = validatedDraft()
    if (!targetText) {
      return
    }
    const operation = ++requestId.current
    setIsBusy(true)
    setStatus('Reading font…')
    setError('')
    try {
      const stored = await createStoredFont(file)
      if (operation !== requestId.current) {
        return
      }
      await putStoredFont(stored)
      deletedFontIds.current.delete(stored.id)
      tombstonedFonts.current.delete(stored.id)
      const nextFonts = [
        ...storedFonts.filter((candidate) => candidate.id !== stored.id),
        stored,
      ]
      setStoredFonts(nextFonts)
      const runtime = loadStoredFont(stored, targetText)
      const nextDesign = resolveDesign(
        loadDesign(stored.id, targetText) ??
          createDesign(runtime, targetText),
        runtime,
      )
      setFont(runtime)
      setDesign(nextDesign)
      replaceTextDraft(targetText)
      setSelection((current) => clampGlyphSelection(current, nextDesign.glyphs.length))
      setLayerFocusIndex((current) => Math.min(current, nextDesign.glyphs.length - 1))
      setViewBox(expandRect(getDesignBounds(nextDesign, runtime), 100))
      setStatus('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The font could not be read.')
      setStatus('')
    } finally {
      if (operation === requestId.current) {
        setIsBusy(false)
      }
    }
  }

  async function removeLocalFont(stored: StoredFont) {
    if (!window.confirm(`Remove ${stored.name} and its saved designs from this browser?`)) {
      return
    }
    const wasActive = design?.fontId === stored.id
    const activeDesign = design
    const activeFont = font
    const activeDraft = textDraft
    let fontDeleted = false
    let fallbackOpened = false
    if (wasActive) {
      requestId.current += 1
      autosaveSuppressed.current = true
      setIsBusy(true)
      setStatus(`Removing ${stored.name}…`)
      setDesign(null)
      setFont(null)
    }
    try {
      await deleteStoredFont(stored.id)
      fontDeleted = true
      deletedFontIds.current.add(stored.id)
      tombstonedFonts.current.set(stored.id, stored)
      let cleanupError: unknown
      try {
        removeDesignsForFont(stored.id)
      } catch (caught) {
        cleanupError = caught
      }
      setStoredFonts((current) => current.filter((candidate) => candidate.id !== stored.id))
      if (wasActive) {
        const fallback = BUILT_IN_FONTS.find((candidate) => candidate.id === DEFAULT_FONT_ID)
        if (!fallback) {
          throw new Error('The fallback font is unavailable.')
        }
        const opened = await openDesign(
          fallback,
          Array.from(activeDraft).length > 0 ? activeDraft : activeDesign?.text ?? INITIAL_TEXT,
          undefined,
          true,
        )
        if (!opened) {
          throw new Error('The local font was removed, but the fallback font could not load.')
        }
        fallbackOpened = true
      }
      if (cleanupError) {
        throw cleanupError instanceof Error
          ? cleanupError
          : new Error('The saved local-font designs could not be removed.')
      }
    } catch (caught) {
      if (wasActive && (!fontDeleted || !fallbackOpened)) {
        setDesign(activeDesign)
        setFont(activeFont)
        replaceTextDraft(activeDraft)
      }
      setError(caught instanceof Error ? caught.message : 'The local font could not be removed.')
    } finally {
      if (wasActive) {
        autosaveSuppressed.current = false
        setIsBusy(false)
        setStatus('')
      }
    }
  }

  async function importDesign(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) {
      return
    }
    setIsBusy(true)
    setError('')
    try {
      const portable = validatePortableDesign(JSON.parse(await file.text()))
      let importedFonts = storedFonts
      if (portable.font) {
        if (BUILT_IN_FONTS.some((candidate) => candidate.id === portable.font?.id)) {
          throw new Error('A local font cannot use a built-in font identity.')
        }
        const normalized = await normalizeStoredFont(portable.font)
        if (portable.design.fontId !== normalized.id) {
          throw new Error('The imported design and local font identities do not match.')
        }
        await putStoredFont(normalized)
        deletedFontIds.current.delete(normalized.id)
        tombstonedFonts.current.delete(normalized.id)
        importedFonts = [
          ...storedFonts.filter((candidate) => candidate.id !== normalized.id),
          normalized,
        ]
        setStoredFonts(importedFonts)
      }
      const spec =
        BUILT_IN_FONTS.find((candidate) => candidate.id === portable.design.fontId) ??
        importedFonts
          .filter((candidate) => candidate.id === portable.design.fontId)
          .map<FontSpec>((candidate) => ({
            id: candidate.id,
            name: candidate.name,
            fileName: candidate.fileName,
            source: 'local',
          }))[0]
      if (!spec) {
        throw new Error('This design needs a local font that was not included.')
      }
      const stored = importedFonts.find((candidate) => candidate.id === spec.id)
      const runtime = stored
        ? loadStoredFont(stored, portable.design.text)
        : await loadBuiltInFont(spec, portable.design.text)
      const imported = resolveDesign(portable.design, runtime)
      setFont(runtime)
      setDesign(imported)
      replaceTextDraft(imported.text)
      setSelection((current) => clampGlyphSelection(current, imported.glyphs.length))
      setLayerFocusIndex((current) => Math.min(current, imported.glyphs.length - 1))
      setViewBox(expandRect(getPaintedBounds(imported, runtime), 100))
      persistDesign(imported)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The design could not be imported.')
    } finally {
      setIsBusy(false)
    }
  }

  if (!font || !design) {
    return <main className="loading-shell" aria-live="polite">{error || status}</main>
  }

  const selectedGlyphs = new Set(selection.indices)
  const selected = selection.primary === null ? undefined : design.glyphs[selection.primary]
  const characters = Array.from(design.text)
  const selectedCharacter = selection.primary === null ? '' : characters[selection.primary] ?? ''
  const tightBounds = getDesignBounds(design, font)
  const proofRenderId = ++proofRenderSequence
  const lightMarkup = proofMarkup(design, font, `light-${proofRenderId}`)
  const darkMarkup = proofMarkup(design, font, `dark-${proofRenderId}`)
  const smallMarkup = proofMarkup(design, font, `small-${proofRenderId}`)
  const pngPreset = PNG_PRESETS.includes(design.pngLongestSide)
    ? String(design.pngLongestSide)
    : 'custom'
  const averageGap = averageGlyphGap(design, font)

  return (
    <div className="app-shell">
      {error && (
        <div className="error-banner" role="alert">
          <span aria-hidden="true">!</span>
          <p>{error}</p>
          <button onClick={() => setError('')} aria-label="Dismiss error">×</button>
        </div>
      )}

      <main className="workspace" data-testid="workbench-shell">
        <aside className="layer-rail" aria-label="Document and glyphs">
          <div className="text-control">
            <input
              id="logo-text"
              aria-label="Logo text"
              value={textDraft}
              spellCheck={false}
              onChange={(event) => {
                setError('')
                textVersion.current += 1
                replaceTextDraft(event.target.value)
              }}
            />
          </div>

          <details className="font-picker">
            <summary aria-label={`Typeface, ${design.fontName}`}>
              <strong style={{ fontFamily: font.previewFamily }}>{design.fontName}</strong>
              <svg className="chevron-icon" viewBox="0 0 16 16" aria-hidden="true">
                <path d="m3.5 6 4.5 4 4.5-4" />
              </svg>
            </summary>
            <div className="font-options" role="listbox" aria-label="Built-in fonts">
              {BUILT_IN_FONTS.map((spec) => (
                <button
                  key={spec.id}
                  role="option"
                  aria-selected={design.fontId === spec.id}
                  style={{ fontFamily: spec.previewFamily }}
                  onClick={() => switchFont(spec)}
                >
                  {spec.name}
                </button>
              ))}
              {storedFonts.length > 0 && <span className="font-group-label">Local</span>}
              {storedFonts.map((stored) => {
                const spec = fontSpecs.find((candidate) => candidate.id === stored.id)
                return (
                  <div className="local-font-option" key={stored.id}>
                    <button
                      role="option"
                      aria-selected={design.fontId === stored.id}
                      style={{ fontFamily: spec?.previewFamily }}
                      onClick={() => spec && switchFont(spec)}
                    >
                      {stored.name}
                    </button>
                    <button
                      className="remove-font"
                      aria-label={`Remove ${stored.name}`}
                      onClick={() => void removeLocalFont(stored)}
                    >
                      ×
                    </button>
                  </div>
                )
              })}
              {supportsInstalledFonts() && (
                installedFonts === null ? (
                  <button
                    className="installed-font-trigger"
                    disabled={isBusy}
                    onClick={() => void revealInstalledFonts()}
                  >
                    Installed on this machine
                  </button>
                ) : (
                  <>
                    <span className="font-group-label">Installed</span>
                    <input
                      className="installed-font-filter"
                      aria-label="Filter installed fonts"
                      placeholder="Segoe UI"
                      value={installedFilter}
                      spellCheck={false}
                      onChange={(event) => setInstalledFilter(event.target.value)}
                    />
                    {visibleInstalledFonts.map((installed) => (
                      <button
                        key={installed.postscriptName}
                        role="option"
                        aria-selected={false}
                        disabled={isBusy}
                        onClick={() => void useInstalledFont(installed.postscriptName)}
                      >
                        {installed.fullName}
                      </button>
                    ))}
                  </>
                )
              )}
            </div>
          </details>

          <label className="file-button">
            Add font
            <input
              type="file"
              accept=".ttf,.otf,font/ttf,font/otf"
              disabled={isBusy}
              onChange={(event) => void uploadFont(event)}
            />
          </label>

          <div
            className="glyph-tabs"
            role="listbox"
            aria-label="Glyph layers"
            aria-multiselectable="true"
          >
            {characters.map((character, index) => (
              <button
                key={`${character}-${index}`}
                className={[
                  selectedGlyphs.has(index) ? 'is-selected' : '',
                  selection.primary === index ? 'is-primary' : '',
                ].filter(Boolean).join(' ')}
                role="option"
                aria-label={[
                  String(index + 1).padStart(2, '0'),
                  glyphLabel(character),
                  selection.primary === index ? 'primary' : '',
                ].filter(Boolean).join(' ')}
                aria-selected={selectedGlyphs.has(index)}
                data-glyph-index={index}
                tabIndex={layerFocusIndex === index ? 0 : -1}
                onFocus={() => setLayerFocusIndex(index)}
                onKeyDown={(event) => handleLayerKeyDown(event, index)}
                onClick={(event) => activateGlyphSelection(index, event.shiftKey)}
              >
                <span>{String(index + 1).padStart(2, '0')}</span>
                <strong>{glyphLabel(character)}</strong>
                <i aria-hidden="true" style={{ background: design.glyphs[index]?.color }} />
              </button>
            ))}
          </div>
        </aside>

        <section className="canvas-column" aria-label="Logo proof workspace">
          <div className="canvas-toolbar">
            <div className="view-actions" aria-label="Proof view">
              <button onClick={() => zoom(0.8)} aria-label="Zoom in">+</button>
              <button onClick={() => zoom(1.25)} aria-label="Zoom out">−</button>
              <button onClick={fitProof}>Fit</button>
            </div>
            <div className="header-actions" aria-label="File actions">
              {isSaving && <span className="saving-status" role="status">Saving…</span>}
              <label className="header-file-button">
                Import
                <input
                  aria-label="Import JSON"
                  type="file"
                  accept=".json,application/json"
                  disabled={isBusy}
                  onChange={(event) => void importDesign(event)}
                />
              </label>
              <button
                ref={exportTriggerRef}
                className="export-trigger"
                popoverTarget="export-popover"
                aria-haspopup="dialog"
                onClick={positionExportPopover}
              >
                Export
              </button>
              <div
                ref={exportPopoverRef}
                id="export-popover"
                className="export-popover"
                popover="auto"
                role="dialog"
                aria-label="Export options"
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    event.currentTarget.hidePopover()
                    exportTriggerRef.current?.focus()
                  }
                }}
              >
                  <button onClick={() => runExportFromPopover('svg')}>SVG</button>
                  <div className="png-export-row">
                    <label>
                      PNG
                      <select
                        aria-label="PNG longest side preset"
                        value={pngPreset}
                        onChange={(event) => {
                          updateDesign((current) =>
                            withUpdatedTime({
                              ...current,
                              pngLongestSide:
                                event.target.value === 'custom'
                                  ? 4095
                                  : Number(event.target.value),
                            }),
                          )
                        }}
                      >
                        {PNG_PRESETS.map((size) => (
                          <option key={size} value={size}>{size}px</option>
                        ))}
                        <option value="custom">Custom</option>
                      </select>
                    </label>
                    {pngPreset === 'custom' && (
                      <input
                        aria-label="Custom PNG longest side"
                        type="number"
                        min="64"
                        max="8192"
                        value={design.pngLongestSide}
                        onChange={(event) => {
                          const value = Number(event.target.value)
                          if (Number.isFinite(value)) {
                            updateDesign((current) =>
                              withUpdatedTime({ ...current, pngLongestSide: value }),
                            )
                          }
                        }}
                      />
                    )}
                    <button onClick={() => runExportFromPopover('png')}>Download PNG</button>
                  </div>
                  <button onClick={() => runExportFromPopover('json')}>Design JSON</button>
              </div>
            </div>
          </div>
          <div className="stage-wrap">
            <LogoStage
              design={design}
              font={font}
              viewBox={viewBox}
              background={design.lightBackground}
              selectedGlyphs={selection.indices}
              primaryGlyph={selection.primary}
              onSelect={updateGlyphSelection}
              onClearSelection={() => setSelection({ indices: [], primary: null })}
              onMove={handleMove}
              onViewBoxChange={setViewBox}
            />
            <output className="canvas-bounds">
              {Math.round(tightBounds.width)} × {Math.round(tightBounds.height)}
            </output>
          </div>

          <div className="proof-grid" aria-label="Proofs">
            <label
              className="proof proof-large proof-interactive proof-light"
              style={{ background: design.lightBackground }}
            >
              <span
                className="proof-artwork"
                dangerouslySetInnerHTML={{ __html: lightMarkup }}
              />
              <input
                className="proof-background-input"
                aria-label="Change light proof background"
                title="Change light proof background"
                type="color"
                value={design.lightBackground}
                onChange={(event) =>
                  updateDesign((current) =>
                    withUpdatedTime({ ...current, lightBackground: event.target.value }),
                  )
                }
              />
            </label>
            <label
              className="proof proof-large proof-interactive proof-dark"
              style={{ background: design.darkBackground }}
            >
              <span
                className="proof-artwork"
                dangerouslySetInnerHTML={{ __html: darkMarkup }}
              />
              <input
                className="proof-background-input"
                aria-label="Change dark proof background"
                title="Change dark proof background"
                type="color"
                value={design.darkBackground}
                onChange={(event) =>
                  updateDesign((current) =>
                    withUpdatedTime({ ...current, darkBackground: event.target.value }),
                  )
                }
              />
            </label>
            <div
              className="proof-small"
              style={{
                '--small-proof-px': `${design.smallProofPx}px`,
              } as CSSProperties}
              data-testid="small-proof"
            >
              <span className="small-proof-center">
                <span
                  className="proof-artwork"
                  dangerouslySetInnerHTML={{ __html: smallMarkup }}
                />
                <label className="small-proof-size">
                  <input
                    aria-label="Small proof size"
                    type="number"
                    min="8"
                    max="64"
                    title="Small proof size, 8 to 64 pixels"
                    value={smallProofDraft}
                    onFocus={() => {
                      smallProofEditStart.current = design.smallProofPx
                      setIsSmallProofEditing(true)
                    }}
                    onChange={(event) => updateSmallProofDraft(event.target.value)}
                    onBlur={commitSmallProofDraft}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        event.currentTarget.blur()
                      } else if (event.key === 'Escape') {
                        event.preventDefault()
                        cancelSmallProofEdit()
                      }
                    }}
                  />
                  <span>px</span>
                </label>
              </span>
            </div>
          </div>
        </section>

        <aside className="inspector" aria-label="Properties">
          <div className="overlap-actions">
            <div className="overlap-action-buttons">
              <button onClick={recalculate} disabled={isBusy}>Recalculate</button>
              <button
                onClick={normalizeCoordinates}
                disabled={isBusy || selection.primary === null}
                aria-label="Normalize coordinates"
                title="Set the selected glyph to 0,0 without changing relative placement"
              >
                Normalize
              </button>
            </div>
            {design.overlapsStale
              ? <span role="status">Stale</span>
              : geometryFeedback && <span role="status">{geometryFeedback}</span>}
          </div>

          <div className="spacing-control">
            <label>
              Avg gap
              <input
                aria-label="Average glyph gap"
                title="Average edge-to-edge gap; negative values overlap"
                type="number"
                step="1"
                value={Math.round(averageGap * 100) / 100}
                disabled={design.glyphs.length < 2}
                onChange={(event) => {
                  const gap = Number(event.target.value)
                  if (Number.isFinite(gap)) {
                    updateDesign((current) => setAverageGlyphGap(current, font, gap))
                  }
                }}
              />
            </label>
          </div>

          {selected && (
            <div className="coordinate-grid">
              <label>
                X
                <input
                  aria-label={`${glyphLabel(selectedCharacter)} X position`}
                  type="number"
                  step="1"
                  value={Math.round(selected.x * 100) / 100}
                  onChange={(event) => {
                    const x = Number(event.target.value)
                    if (Number.isFinite(x)) {
                      updatePrimaryCoordinate('x', x)
                    }
                  }}
                />
              </label>
              <label>
                Y
                <input
                  aria-label={`${glyphLabel(selectedCharacter)} Y position`}
                  type="number"
                  step="1"
                  value={Math.round(selected.y * 100) / 100}
                  onChange={(event) => {
                    const y = Number(event.target.value)
                    if (Number.isFinite(y)) {
                      updatePrimaryCoordinate('y', y)
                    }
                  }}
                />
              </label>
              <label className="color-field">
                Base
                <input
                  aria-label={`${glyphLabel(selectedCharacter)} base color`}
                  type="color"
                  value={selected.color}
                  onChange={(event) => {
                    const color = event.target.value
                    updateDesign((current) =>
                      refreshMixedOverlapColors(withUpdatedTime({
                        ...current,
                        glyphs: current.glyphs.map((glyph, index) =>
                          index === selection.primary ? { ...glyph, color } : glyph,
                        ),
                      })),
                    )
                  }}
                />
              </label>
              <button
                className="following-toggle"
                aria-label={`Select ${glyphLabel(selectedCharacter)} and following glyphs`}
                title={`Select ${glyphLabel(selectedCharacter)} and following glyphs`}
                onClick={() => {
                  const primary = selection.primary
                  if (primary !== null) {
                    setSelection({
                      indices: characters.map((_, index) => index).slice(primary),
                      primary,
                    })
                  }
                }}
              >
                <svg className="chain-link-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
              </button>
            </div>
          )}

          <div className="pair-list" data-testid="properties-inspector">
            {design.overlaps.map((overlap, index) => {
              const labels = overlap.glyphIndices.map((glyphIndex) =>
                glyphLabel(characters[glyphIndex] ?? ''),
              )
              return (
                <div
                  className={`pair-row${
                    overlap.glyphIndices.some((glyphIndex) => selectedGlyphs.has(glyphIndex))
                      ? ' is-related'
                      : ''
                  }`}
                  key={overlap.glyphIndices.join('-')}
                >
                  <div>
                    <strong>{labels.join('–')}</strong>
                    <span>
                      {overlap.coverage < 0.1 ? '<0.1' : overlap.coverage.toFixed(1)}%
                    </span>
                  </div>
                  <input
                    aria-label={`${labels.join(' ')} overlap color`}
                    type="color"
                    value={overlap.color}
                    onChange={(event) => {
                      const color = event.target.value
                      updateDesign((current) =>
                        withUpdatedTime({
                          ...current,
                          overlaps: current.overlaps.map((candidate, overlapIndex) =>
                            overlapIndex === index
                              ? { ...candidate, color, colorMode: 'custom' }
                              : candidate,
                          ),
                        }),
                      )
                    }}
                  />
                  <button
                    className="mix-button"
                    aria-pressed={overlap.colorMode === 'mixed'}
                    onClick={() =>
                      updateDesign((current) =>
                        refreshMixedOverlapColors(withUpdatedTime({
                          ...current,
                          overlaps: current.overlaps.map((candidate, overlapIndex) =>
                            overlapIndex === index
                              ? { ...candidate, colorMode: 'mixed' }
                              : candidate,
                          ),
                        })),
                      )
                    }
                  >
                    Mix
                  </button>
                </div>
              )
            })}
          </div>
        </aside>
      </main>
    </div>
  )
}

export default App
