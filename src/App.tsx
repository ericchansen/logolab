import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react'
import { LogoStage } from './components/LogoStage'
import { suggestOverlapColor } from './domain/colors'
import { createDesign, validatePortableDesign } from './domain/design'
import {
  downloadDesign,
  downloadPng,
  downloadSvg,
} from './domain/export'
import {
  BUILT_IN_FONTS,
  createStoredFont,
  loadBuiltInFont,
  loadStoredFont,
  normalizeStoredFont,
} from './domain/fonts'
import {
  expandRect,
  getDesignBounds,
  horizontalOverlap,
  moveGlyphs,
} from './domain/geometry'
import {
  getStoredFonts,
  loadDesign,
  putStoredFont,
  saveDesign,
} from './domain/persistence'
import { buildSvgMarkup } from './domain/svg'
import type {
  DesignDocument,
  FontRuntime,
  FontSpec,
  MoveMode,
  Point,
  Rect,
  StoredFont,
} from './domain/types'

const INITIAL_TEXT = 'Logo'
let proofRenderSequence = 0

function withUpdatedTime(design: DesignDocument): DesignDocument {
  return { ...design, updatedAt: new Date().toISOString() }
}

function proofMarkup(
  design: DesignDocument,
  font: FontRuntime,
  renderId: string,
): string {
  return buildSvgMarkup(design, font, { renderId, className: 'logo-svg' })
}

function App() {
  const [storedFonts, setStoredFonts] = useState<StoredFont[]>([])
  const [font, setFont] = useState<FontRuntime | null>(null)
  const [design, setDesign] = useState<DesignDocument | null>(null)
  const [textDraft, setTextDraft] = useState(INITIAL_TEXT)
  const [selectedGlyph, setSelectedGlyph] = useState(0)
  const [moveMode, setMoveMode] = useState<MoveMode>('single')
  const [viewBox, setViewBox] = useState<Rect>({
    x: 0,
    y: -1000,
    width: 3600,
    height: 1400,
  })
  const [status, setStatus] = useState('Loading Sora ExtraBold…')
  const [error, setError] = useState('')
  const [isBusy, setIsBusy] = useState(true)
  const requestId = useRef(0)

  const fontSpecs = useMemo<FontSpec[]>(
    () => [
      ...BUILT_IN_FONTS,
      ...storedFonts.map(({ id, name, fileName }) => ({
        id,
        name,
        fileName,
        source: 'local' as const,
      })),
    ],
    [storedFonts],
  )

  async function openDesign(
    spec: FontSpec,
    text: string,
    imported?: DesignDocument,
  ): Promise<void> {
    if (design) {
      saveDesign(design)
    }
    const operation = ++requestId.current
    setIsBusy(true)
    setError('')
    setStatus(`Loading ${spec.name}…`)
    try {
      const storedFont =
        spec.source === 'local'
          ? storedFonts.find((candidate) => candidate.id === spec.id)
          : undefined
      const runtime = storedFont
        ? loadStoredFont(storedFont, text)
        : await loadBuiltInFont(spec, text)
      if (operation !== requestId.current) {
        return
      }
      const nextDesign =
        imported ?? loadDesign(spec.id, text) ?? createDesign(runtime, text)
      if (nextDesign.glyphs.length !== runtime.outlines.length) {
        throw new Error('The saved design no longer matches its text.')
      }
      setFont(runtime)
      setDesign(nextDesign)
      setTextDraft(text)
      setSelectedGlyph((current) =>
        Math.min(current, nextDesign.glyphs.length - 1),
      )
      setViewBox(expandRect(getDesignBounds(nextDesign, runtime), 100))
      setStatus('Saved locally')
    } catch (caught) {
      if (operation !== requestId.current) {
        return
      }
      setError(caught instanceof Error ? caught.message : 'The font could not be loaded.')
      setStatus('Could not load design')
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
          setStatus('Local fonts could not be restored')
        }
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const firstFont = BUILT_IN_FONTS[0]
    if (firstFont) {
      void openDesign(firstFont, INITIAL_TEXT)
    }
  }, [])

  useEffect(() => {
    if (design) {
      saveDesign(design)
      setStatus('Saved locally')
    }
  }, [design])

  function updateDesign(update: (current: DesignDocument) => DesignDocument) {
    setDesign((current) => (current ? update(current) : current))
  }

  function fitProof() {
    if (design && font) {
      setViewBox(expandRect(getDesignBounds(design, font), 100))
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

  function handleMove(index: number, delta: Point, mode: MoveMode) {
    updateDesign((current) => moveGlyphs(current, index, delta, mode))
  }

  function submitText(event: FormEvent) {
    event.preventDefault()
    const characters = Array.from(textDraft)
    if (characters.length < 1 || characters.length > 12) {
      setError('Enter between 1 and 12 characters.')
      return
    }
    const activeSpec = fontSpecs.find((candidate) => candidate.id === design?.fontId)
    if (activeSpec) {
      void openDesign(activeSpec, characters.join(''))
    }
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
    if (file.size > 10 * 1024 * 1024) {
      setError('Local font files must be 10 MB or smaller.')
      return
    }
    const operation = ++requestId.current
    setIsBusy(true)
    setStatus('Reading font locally…')
    setError('')
    try {
      const stored = await createStoredFont(file)
      if (operation !== requestId.current) {
        return
      }
      await putStoredFont(stored)
      if (operation !== requestId.current) {
        return
      }
      setStoredFonts((current) => [
        ...current.filter((fontItem) => fontItem.id !== stored.id),
        stored,
      ])
      const text = design?.text ?? INITIAL_TEXT
      const runtime = loadStoredFont(stored, text)
      const nextDesign = loadDesign(stored.id, text) ?? createDesign(runtime, text)
      setFont(runtime)
      setDesign(nextDesign)
      setViewBox(expandRect(getDesignBounds(nextDesign, runtime), 100))
      setStatus(`${stored.name} is stored only in this browser`)
    } catch (caught) {
      if (operation !== requestId.current) {
        return
      }
      setError(caught instanceof Error ? caught.message : 'The font could not be read.')
      setStatus('Font upload failed')
    } finally {
      if (operation === requestId.current) {
        setIsBusy(false)
      }
    }
  }

  async function importDesign(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) {
      return
    }
    const operation = ++requestId.current
    setIsBusy(true)
    setStatus('Importing design locally…')
    setError('')
    try {
      const portable = validatePortableDesign(JSON.parse(await file.text()))
      if (operation !== requestId.current) {
        return
      }
      let importedDesign = portable.design
      let importedFonts = storedFonts
      if (portable.font) {
        if (BUILT_IN_FONTS.some((candidate) => candidate.id === portable.font?.id)) {
          throw new Error('A local font cannot use a built-in font identity.')
        }
        const normalizedFont = await normalizeStoredFont(portable.font)
        if (operation !== requestId.current) {
          return
        }
        if (importedDesign.fontId !== normalizedFont.id) {
          throw new Error('The imported design and local font identities do not match.')
        }
        await putStoredFont(normalizedFont)
        if (operation !== requestId.current) {
          return
        }
        importedFonts = [
          ...storedFonts.filter((candidate) => candidate.id !== normalizedFont.id),
          normalizedFont,
        ]
        setStoredFonts(importedFonts)
      }
      const builtInSpec = BUILT_IN_FONTS.find(
        (candidate) => candidate.id === importedDesign.fontId,
      )
      const importedFont = importedFonts.find(
        (candidate) => candidate.id === importedDesign.fontId,
      )
      const spec: FontSpec | undefined =
        builtInSpec ??
        (importedFont
          ? {
              id: importedFont.id,
              name: importedFont.name,
              fileName: importedFont.fileName,
              source: 'local',
            }
          : undefined)
      if (!spec) {
        throw new Error('This design needs a local font that was not included.')
      }
      const stored =
        spec.source === 'local'
          ? importedFonts.find((candidate) => candidate.id === spec.id)
          : undefined
      const runtime = stored
        ? loadStoredFont(stored, importedDesign.text)
        : await loadBuiltInFont(spec, importedDesign.text)
      if (operation !== requestId.current) {
        return
      }
      importedDesign = { ...importedDesign, fontId: spec.id, fontName: spec.name }
      saveDesign(importedDesign)
      setFont(runtime)
      setDesign(importedDesign)
      setTextDraft(importedDesign.text)
      setViewBox(expandRect(getDesignBounds(importedDesign, runtime), 100))
      setStatus('Design imported and saved locally')
    } catch (caught) {
      if (operation !== requestId.current) {
        return
      }
      setError(caught instanceof Error ? caught.message : 'The design could not be imported.')
      setStatus('Design import failed')
    } finally {
      if (operation === requestId.current) {
        setIsBusy(false)
      }
    }
  }

  if (!font || !design) {
    return (
      <main className="loading-shell">
        <div className="brand-mark" aria-hidden="true">
          <span />
          <span />
        </div>
        <p>{error || status}</p>
      </main>
    )
  }

  const selected = design.glyphs[selectedGlyph]
  const selectedCharacter = Array.from(design.text)[selectedGlyph] ?? ''
  const selectedStoredFont = storedFonts.find((candidate) => candidate.id === design.fontId)
  const tightBounds = getDesignBounds(design, font)
  const proofRenderId = ++proofRenderSequence
  const lightMarkup = proofMarkup(design, font, `light-${proofRenderId}`)
  const darkMarkup = proofMarkup(design, font, `dark-${proofRenderId}`)
  const smallMarkup = proofMarkup(design, font, `small-${proofRenderId}`)

  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="brand" href="/" aria-label="Logo Lab home">
          <span className="brand-mark" aria-hidden="true">
            <span />
            <span />
          </span>
          <span>
            <strong>Logo Lab</strong>
            <small>Outline composition studio</small>
          </span>
        </a>
        <p className="privacy-note">
          <span aria-hidden="true">●</span> Runs entirely in your browser
        </p>
      </header>

      <main>
        <section className="intro" aria-labelledby="page-title">
          <div>
            <p className="eyebrow">Design with the real shapes</p>
            <h1 id="page-title">Compose a wordmark, one outline at a time.</h1>
          </div>
          <p>
            Position native font glyphs, then color only the exact intersections
            between adjacent letters. Nothing is uploaded.
          </p>
        </section>

        <div className="workspace">
          <section className="canvas-column" aria-label="Logo proof workspace">
            <div className="canvas-toolbar">
              <div className="segmented" aria-label="Glyph movement mode">
                <button
                  className={moveMode === 'single' ? 'is-active' : ''}
                  aria-pressed={moveMode === 'single'}
                  onClick={() => setMoveMode('single')}
                >
                  Move one
                </button>
                <button
                  className={moveMode === 'following' ? 'is-active' : ''}
                  aria-pressed={moveMode === 'following'}
                  onClick={() => setMoveMode('following')}
                >
                  Move with following
                </button>
              </div>
              <div className="view-actions" aria-label="Proof view">
                <button onClick={() => zoom(0.8)} aria-label="Zoom in">+</button>
                <button onClick={() => zoom(1.25)} aria-label="Zoom out">−</button>
                <button onClick={fitProof}>Fit</button>
              </div>
            </div>
            <LogoStage
              design={design}
              font={font}
              viewBox={viewBox}
              background={design.lightBackground}
              selectedGlyph={selectedGlyph}
              moveMode={moveMode}
              onSelect={setSelectedGlyph}
              onMove={handleMove}
              onViewBoxChange={setViewBox}
            />
            <p className="canvas-help">
              Drag a letter to move it. Hold Space and drag to pan. Arrow keys
              nudge by 1 unit; hold Shift for 10.
            </p>

            <section className="proof-section" aria-labelledby="proof-title">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Synchronized output</p>
                  <h2 id="proof-title">Proofs</h2>
                </div>
                <span>{Math.round(tightBounds.width)} × {Math.round(tightBounds.height)} units</span>
              </div>
              <div className="proof-grid">
                <figure>
                  <div
                    className="proof proof-large"
                    style={{ background: design.lightBackground }}
                    dangerouslySetInnerHTML={{ __html: lightMarkup }}
                  />
                  <figcaption>Light</figcaption>
                </figure>
                <figure>
                  <div
                    className="proof proof-large"
                    style={{ background: design.darkBackground }}
                    dangerouslySetInnerHTML={{ __html: darkMarkup }}
                  />
                  <figcaption>Dark</figcaption>
                </figure>
                <figure>
                  <div
                    className="proof proof-small"
                    style={{
                      background: design.lightBackground,
                      height: `${design.smallProofPx}px`,
                    }}
                    data-testid="small-proof"
                    dangerouslySetInnerHTML={{ __html: smallMarkup }}
                  />
                  <figcaption>Exact {design.smallProofPx}px</figcaption>
                </figure>
              </div>
            </section>
          </section>

          <aside className="inspector" aria-label="Design controls">
            <section>
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Document</p>
                  <h2>Set the word</h2>
                </div>
              </div>
              <form className="text-form" onSubmit={submitText}>
                <label htmlFor="logo-text">Text · 1–12 characters</label>
                <div className="input-action">
                  <input
                    id="logo-text"
                    value={textDraft}
                    maxLength={24}
                    spellCheck={false}
                    onChange={(event) => setTextDraft(event.target.value)}
                  />
                  <button type="submit" disabled={isBusy}>Apply</button>
                </div>
              </form>
              <label htmlFor="font-select">Font</label>
              <select
                id="font-select"
                value={design.fontId}
                disabled={isBusy}
                onChange={(event) => {
                  const spec = fontSpecs.find((candidate) => candidate.id === event.target.value)
                  if (spec) {
                    void openDesign(spec, design.text)
                  }
                }}
              >
                <optgroup label="Built in · ExtraBold">
                  {BUILT_IN_FONTS.map((spec) => (
                    <option key={spec.id} value={spec.id}>{spec.name}</option>
                  ))}
                </optgroup>
                {storedFonts.length > 0 && (
                  <optgroup label="Local fonts">
                    {storedFonts.map((spec) => (
                      <option key={spec.id} value={spec.id}>{spec.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
              <label className="file-button">
                Add local TTF or OTF
                <input
                  type="file"
                  accept=".ttf,.otf,font/ttf,font/otf"
                  disabled={isBusy}
                  onChange={(event) => void uploadFont(event)}
                />
              </label>
              <p className="microcopy">Font data stays on this device.</p>
            </section>

            <section>
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Position</p>
                  <h2>Glyphs</h2>
                </div>
              </div>
              <div className="glyph-tabs" role="list" aria-label="Select a glyph">
                {Array.from(design.text).map((character, index) => (
                  <button
                    key={`${character}-${index}`}
                    className={selectedGlyph === index ? 'is-active' : ''}
                    aria-pressed={selectedGlyph === index}
                    onClick={() => setSelectedGlyph(index)}
                  >
                    {character === ' ' ? 'space' : character}
                  </button>
                ))}
              </div>
              {selected && (
                <div className="coordinate-grid">
                  <label>
                    X
                    <input
                      aria-label={`${selectedCharacter} X position`}
                      type="number"
                      step="1"
                      value={Math.round(selected.x * 100) / 100}
                      onChange={(event) => {
                        const x = Number(event.target.value)
                        if (Number.isFinite(x)) {
                          updateDesign((current) =>
                            withUpdatedTime({
                              ...current,
                              glyphs: current.glyphs.map((glyph, index) =>
                                index === selectedGlyph ? { ...glyph, x } : glyph,
                              ),
                            }),
                          )
                        }
                      }}
                    />
                  </label>
                  <label>
                    Y
                    <input
                      aria-label={`${selectedCharacter} Y position`}
                      type="number"
                      step="1"
                      value={Math.round(selected.y * 100) / 100}
                      onChange={(event) => {
                        const y = Number(event.target.value)
                        if (Number.isFinite(y)) {
                          updateDesign((current) =>
                            withUpdatedTime({
                              ...current,
                              glyphs: current.glyphs.map((glyph, index) =>
                                index === selectedGlyph ? { ...glyph, y } : glyph,
                              ),
                            }),
                          )
                        }
                      }}
                    />
                  </label>
                  <label className="color-field">
                    Base
                    <input
                      aria-label={`${selectedCharacter} base color`}
                      type="color"
                      value={selected.color}
                      onChange={(event) => {
                        const color = event.target.value
                        updateDesign((current) =>
                          withUpdatedTime({
                            ...current,
                            glyphs: current.glyphs.map((glyph, index) =>
                              index === selectedGlyph ? { ...glyph, color } : glyph,
                            ),
                          }),
                        )
                      }}
                    />
                  </label>
                </div>
              )}
            </section>

            <section>
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Exact intersections</p>
                  <h2>Adjacent overlaps</h2>
                </div>
              </div>
              <div className="pair-list">
                {design.pairs.map((pair, index) => {
                  const characters = Array.from(design.text)
                  const left = characters[index] ?? ''
                  const right = characters[index + 1] ?? ''
                  const suggestion = suggestOverlapColor(
                    design.glyphs[index]?.color ?? '#000000',
                    design.glyphs[index + 1]?.color ?? '#000000',
                  )
                  return (
                    <div className="pair-row" key={`${left}-${right}-${index}`}>
                      <div>
                        <strong>{left}–{right}</strong>
                        <span>{Math.round(horizontalOverlap(design, font, index))} units</span>
                      </div>
                      <input
                        aria-label={`${left} ${right} overlap color`}
                        type="color"
                        value={pair.color}
                        onChange={(event) => {
                          const color = event.target.value
                          updateDesign((current) =>
                            withUpdatedTime({
                              ...current,
                              pairs: current.pairs.map((candidate, pairIndex) =>
                                pairIndex === index ? { color } : candidate,
                              ),
                            }),
                          )
                        }}
                      />
                      <button
                        className="suggest-button"
                        style={{ '--suggestion': suggestion } as React.CSSProperties}
                        onClick={() =>
                          updateDesign((current) =>
                            withUpdatedTime({
                              ...current,
                              pairs: current.pairs.map((candidate, pairIndex) =>
                                pairIndex === index ? { color: suggestion } : candidate,
                              ),
                            }),
                          )
                        }
                      >
                        Suggest
                      </button>
                    </div>
                  )
                })}
              </div>
            </section>

            <section>
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Context</p>
                  <h2>Proof settings</h2>
                </div>
              </div>
              <div className="coordinate-grid proof-settings">
                <label className="color-field">
                  Light
                  <input
                    aria-label="Light proof background"
                    type="color"
                    value={design.lightBackground}
                    onChange={(event) =>
                      updateDesign((current) =>
                        withUpdatedTime({ ...current, lightBackground: event.target.value }),
                      )
                    }
                  />
                </label>
                <label className="color-field">
                  Dark
                  <input
                    aria-label="Dark proof background"
                    type="color"
                    value={design.darkBackground}
                    onChange={(event) =>
                      updateDesign((current) =>
                        withUpdatedTime({ ...current, darkBackground: event.target.value }),
                      )
                    }
                  />
                </label>
                <label>
                  Small px
                  <input
                    aria-label="Small proof size"
                    type="number"
                    min="8"
                    max="256"
                    value={design.smallProofPx}
                    onChange={(event) => {
                      const smallProofPx = Math.min(256, Math.max(8, Number(event.target.value)))
                      updateDesign((current) =>
                        withUpdatedTime({ ...current, smallProofPx }),
                      )
                    }}
                  />
                </label>
              </div>
            </section>

            <section>
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Take it with you</p>
                  <h2>Export</h2>
                </div>
              </div>
              <div className="export-actions">
                <button className="primary" onClick={() => downloadSvg(design, font)}>
                  Transparent SVG
                </button>
                <button
                  onClick={() => {
                    void downloadPng(design, font).catch((caught: unknown) => {
                      setError(caught instanceof Error ? caught.message : 'PNG export failed.')
                    })
                  }}
                >
                  High-res PNG
                </button>
                <button onClick={() => downloadDesign(design, selectedStoredFont)}>
                  Design JSON
                </button>
                <label className="file-button subtle">
                  Import JSON
                  <input
                    type="file"
                    accept=".json,application/json"
                    disabled={isBusy}
                    onChange={(event) => void importDesign(event)}
                  />
                </label>
              </div>
            </section>

            <div className="status-area">
              {error && <p className="error-message" role="alert">{error}</p>}
              <p className="save-status" role="status" aria-live="polite">{status}</p>
            </div>
          </aside>
        </div>
      </main>

      <footer>
        <p>Logo Lab · Open source under MIT</p>
        <p>Bundled fonts are licensed under SIL OFL 1.1.</p>
      </footer>
    </div>
  )
}

export default App
