import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

async function waitForReady(page: Page) {
  await expect(page.getByTestId('workbench-shell')).toBeVisible()
  await expect(page.getByTestId('editor-stage')).toBeVisible()
  await expect(page.getByLabel('Logo text', { exact: true })).toHaveValue('LogoLab')
  await expect(page.locator('.font-picker summary')).toContainText('Rubik')
  await expect(page.getByLabel('L X position')).toHaveValue('314.93')
}

async function expectArtworkFits(page: Page) {
  const fits = await page.getByTestId('editor-stage').evaluate((stage) => {
    const stageRect = stage.getBoundingClientRect()
    const visibleGlyphs = Array.from(stage.querySelectorAll<SVGPathElement>('[data-glyph]'))
      .map((glyph) => glyph.getBoundingClientRect())
      .filter((bounds) => bounds.width > 0 && bounds.height > 0)
    return visibleGlyphs.length > 0 && visibleGlyphs.every(
      (bounds) =>
        bounds.left >= stageRect.left - 1 &&
        bounds.right <= stageRect.right + 1 &&
        bounds.top >= stageRect.top - 1 &&
        bounds.bottom <= stageRect.bottom + 1,
    )
  })
  expect(fits).toBe(true)
}

async function setText(page: Page, text: string) {
  await page.getByLabel('Logo text', { exact: true }).fill(text)
  await expect(page.locator('.glyph-tabs button')).toHaveCount(Array.from(text).length)
  await expect(page.getByTestId('editor-stage').locator('svg')).toHaveAttribute(
    'aria-label',
    new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} logo proof`),
  )
}

async function selectFont(page: Page, name: string) {
  const picker = page.locator('.font-picker')
  if (!(await picker.evaluate((element) => element.hasAttribute('open')))) {
    await picker.locator('summary').click()
  }
  await picker.getByRole('option', { name, exact: true }).click()
  await expect(picker.locator('summary')).toContainText(name)
  await expect(page.getByTestId('editor-stage').locator('svg')).toHaveAttribute(
    'aria-label',
    new RegExp(`in ${name}$`),
  )
  if (await picker.evaluate((element) => element.hasAttribute('open'))) {
    await picker.locator('summary').click()
  }
}

async function selectGlyph(page: Page, index: number) {
  await page.locator('.glyph-tabs button').nth(index).click()
}

async function expectSmallProofHeight(page: Page, pixels: number) {
  await expect(page.getByTestId('small-proof').locator('.proof-artwork svg')).toHaveCSS(
    'height',
    `${pixels}px`,
  )
}

async function paintedCenterOffset(page: Page, hostSelector: string) {
  return page.locator(hostSelector).evaluate((host) => {
    const painted = Array.from(
      host.querySelectorAll<SVGGraphicsElement>('svg > path[data-glyph]'),
    )
      .map((element) => element.getBoundingClientRect())
      .filter(({ width, height }) => width > 0 && height > 0)
    const hostBounds = host.getBoundingClientRect()
    const left = Math.min(...painted.map(({ left: value }) => value))
    const right = Math.max(...painted.map(({ right: value }) => value))
    const top = Math.min(...painted.map(({ top: value }) => value))
    const bottom = Math.max(...painted.map(({ bottom: value }) => value))
    return {
      x: (left + right) / 2 - (hostBounds.left + hostBounds.right) / 2,
      y: (top + bottom) / 2 - (hostBounds.top + hostBounds.bottom) / 2,
    }
  })
}

async function setSelectedX(page: Page, value: number) {
  const input = page.locator('.coordinate-grid input[type="number"]').first()
  await input.fill(String(value))
  await input.blur()
}

function translatePosition(value: string | null) {
  const match = value?.match(/^translate\((-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)\)$/)
  if (!match) {
    throw new Error(`Unexpected glyph transform: ${value}`)
  }
  return { x: Number(match[1]), y: Number(match[2]) }
}

async function downloadSvg(page: Page): Promise<string> {
  const trigger = page.getByRole('button', { name: 'Export', exact: true })
  const popover = page.locator('#export-popover')
  if (!(await popover.isVisible())) {
    await trigger.click()
  }
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'SVG', exact: true }).click()
  const download = await downloadPromise
  const filePath = await download.path()
  expect(filePath).not.toBeNull()
  await expect(popover).toBeHidden()
  return readFile(filePath ?? '', 'utf8')
}

test.beforeEach(async ({ page }) => {
  await page.goto('./')
  await page.evaluate(async () => {
    localStorage.clear()
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase('logolab')
      request.onsuccess = () => resolve()
      request.onerror = () => resolve()
      request.onblocked = () => resolve()
    })
  })
  await page.reload()
  await waitForReady(page)
})

test('self-hosts the normalized Figtree UI without changing font previews', async ({ page }) => {
  await page.evaluate(() => document.fonts.ready)
  await page.locator('.font-picker summary').click()
  const typography = await page.evaluate(() => {
    const style = (selector: string) => getComputedStyle(document.querySelector(selector)!)
    const resources = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
    const localOrigin = location.origin
    return {
      uiFamily: style('.app-shell').fontFamily,
      shellWeight: style('.app-shell').fontWeight,
      labelSize: style('.coordinate-grid label').fontSize,
      labelWeight: style('.coordinate-grid label').fontWeight,
      controlSize: style('.view-actions button').fontSize,
      controlWeight: style('.view-actions button').fontWeight,
      fontValueSize: style('.font-picker summary strong').fontSize,
      fontValueWeight: style('.font-picker summary strong').fontWeight,
      glyphSize: style('.glyph-tabs button strong').fontSize,
      pairSize: style('.pair-row strong').fontSize,
      metadataSize: style('.glyph-tabs button > span').fontSize,
      metadataWeight: style('.glyph-tabs button > span').fontWeight,
      previewFamily: style('.font-options [role="option"]').fontFamily,
      figtreeLoaded: document.fonts.check('400 13px "Figtree UI"'),
      fontResources: resources.filter((url) => /\.woff2(?:$|\?)/.test(url)),
      externalResources: resources.filter((url) => new URL(url).origin !== localOrigin),
    }
  })

  expect(typography).toMatchObject({
    shellWeight: '400',
    labelSize: '12px',
    labelWeight: '500',
    controlSize: '13px',
    controlWeight: '500',
    fontValueSize: '14px',
    fontValueWeight: '600',
    glyphSize: '13px',
    pairSize: '13px',
    metadataSize: '11px',
    metadataWeight: '400',
    figtreeLoaded: true,
    externalResources: [],
  })
  expect(typography.uiFamily).toContain('Figtree UI')
  expect(typography.previewFamily).toContain('LogoLab Archivo')
  expect(typography.fontResources).toHaveLength(1)
  expect(typography.fontResources[0]).toMatch(/Figtree-Variable[^/]*\.woff2/)
  await expect(page.locator('.ui-type-preview')).toHaveCount(0)
})

test('opens directly on the captured Rubik LogoLab preset at desktop and narrow widths', async ({ page }) => {
  const expectDesktopTopology = async (width: number, height: number) => {
    await page.setViewportSize({ width, height })
    const geometry = await page.evaluate(() => {
      const rect = (selector: string) => {
        const { x, y, width: elementWidth, height: elementHeight } =
          document.querySelector(selector)!.getBoundingClientRect()
        return { x, y, width: elementWidth, height: elementHeight }
      }
      return {
        viewport: {
          width: document.documentElement.clientWidth,
          height: document.documentElement.clientHeight,
        },
        canvas: rect('.canvas-column'),
        proofs: rect('.proof-grid'),
        layers: rect('.layer-rail'),
        inspector: rect('.inspector'),
        documentHeight: document.documentElement.scrollHeight,
      }
    })
    expect(geometry.layers.x).toBeLessThan(geometry.canvas.x)
    expect(geometry.layers.x + geometry.layers.width).toBeLessThanOrEqual(geometry.canvas.x)
    expect(geometry.inspector.x).toBeGreaterThanOrEqual(
      geometry.canvas.x + geometry.canvas.width,
    )
    expect(geometry.canvas.width).toBeGreaterThan(width === 1254 ? 840 : 980)
    expect(geometry.canvas.width / geometry.viewport.width).toBeGreaterThan(0.66)
    expect(geometry.layers.width).toBeLessThanOrEqual(190)
    expect(geometry.inspector.width).toBeLessThanOrEqual(240)
    expect(geometry.layers.height).toBeLessThan(geometry.viewport.height * 0.72)
    expect(geometry.inspector.height).toBeLessThan(geometry.viewport.height * 0.72)
    expect(geometry.documentHeight).toBeLessThanOrEqual(geometry.viewport.height + 80)
    expect(await page.locator('body').evaluate((body) => body.scrollWidth)).toBe(width)
  }

  await expectDesktopTopology(1254, 964)
  await expect(
    page.locator('h1, h2, footer, .app-glyph, .intro, .privacy-note, .save-status'),
  ).toHaveCount(0)
  await expectArtworkFits(page)
  await expect(page.locator('[data-overlap]')).not.toHaveCount(0)
  const desktopChrome = await page.evaluate(() => {
    const style = (selector: string) => getComputedStyle(document.querySelector(selector)!)
    return {
      headerCount: document.querySelectorAll('.app-header').length,
      railBorder: style('.layer-rail').borderRightWidth,
      railBackground: style('.layer-rail').backgroundColor,
      inspectorBorder: style('.inspector').borderLeftWidth,
      inspectorBackground: style('.inspector').backgroundColor,
      coordinateBorder: style('.coordinate-grid').borderBottomWidth,
      glyphBorder: style('.glyph-tabs button').borderBottomWidth,
      glyphSelectionBackground: style('.glyph-tabs button.is-selected').backgroundColor,
      pairBorder: style('.pair-row').borderBottomWidth,
      pairBackground: style('.pair-row').backgroundColor,
      canvasBorder: style('.editor-stage').borderWidth,
      proofBorder: style('.proof').borderWidth,
    }
  })
  expect(desktopChrome).toEqual({
    headerCount: 0,
    railBorder: '0px',
    railBackground: 'rgba(0, 0, 0, 0)',
    inspectorBorder: '0px',
    inspectorBackground: 'rgba(0, 0, 0, 0)',
    coordinateBorder: '0px',
    glyphBorder: '0px',
    glyphSelectionBackground: 'rgba(0, 0, 0, 0)',
    pairBorder: '0px',
    pairBackground: 'rgba(0, 0, 0, 0)',
    canvasBorder: '1px',
    proofBorder: '1px',
  })

  await expectDesktopTopology(1440, 900)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByTestId('editor-stage')).toBeVisible()
  await expectArtworkFits(page)
  expect(await page.locator('body').evaluate((body) => body.scrollWidth)).toBe(390)
  const stageBox = await page.getByTestId('editor-stage').boundingBox()
  const textBox = await page.getByLabel('Logo text', { exact: true }).boundingBox()
  expect((stageBox?.y ?? 0) < (textBox?.y ?? 0)).toBe(true)
  const narrowChrome = await page.evaluate(() => {
    const style = (selector: string) => getComputedStyle(document.querySelector(selector)!)
    return {
      layerTop: style('.layer-rail').borderTopWidth,
      layerBackground: style('.layer-rail').backgroundColor,
      inspectorTop: style('.inspector').borderTopWidth,
      inspectorBackground: style('.inspector').backgroundColor,
      glyphRight: style('.glyph-tabs button').borderRightWidth,
      glyphLayout: style('.glyph-tabs').display,
      glyphWrap: style('.glyph-tabs').flexWrap,
    }
  })
  expect(narrowChrome).toEqual({
    layerTop: '0px',
    layerBackground: 'rgba(0, 0, 0, 0)',
    inspectorTop: '0px',
    inspectorBackground: 'rgba(0, 0, 0, 0)',
    glyphRight: '0px',
    glyphLayout: 'flex',
    glyphWrap: 'wrap',
  })
})

test('uses direct, accessible controls without redundant chrome', async ({ page }) => {
  for (const title of ['Move following', 'Text', 'Font', 'Light', 'Dark', 'Small']) {
    await expect(page.getByText(title, { exact: true })).toHaveCount(0)
  }

  await expect(page.getByLabel('Logo text', { exact: true })).toBeVisible()
  const typefacePicker = page.getByLabel('Typeface, Rubik', { exact: true })
  await expect(typefacePicker).toBeVisible()
  const chevron = typefacePicker.locator('svg.chevron-icon')
  await expect(chevron).toHaveCount(1)
  await expect(chevron).toHaveAttribute('aria-hidden', 'true')
  await expect(chevron.locator('path')).toHaveAttribute('d', 'm3.5 6 4.5 4 4.5-4')
  const collapsedTransform = await chevron.evaluate((element) => getComputedStyle(element).transform)
  await typefacePicker.click()
  await expect(page.locator('.font-picker')).toHaveAttribute('open', '')
  const expandedTransform = await chevron.evaluate((element) => getComputedStyle(element).transform)
  expect(expandedTransform).not.toBe(collapsedTransform)
  await typefacePicker.click()
  await expect(page.locator('.font-picker')).not.toHaveAttribute('open', '')

  const linkedMove = page.getByRole('button', {
    name: 'Select L and following glyphs',
    exact: true,
  })
  await expect(linkedMove).toHaveAttribute(
    'title',
    'Select L and following glyphs',
  )
  const chainLink = linkedMove.locator('svg.chain-link-icon')
  await expect(chainLink).toHaveCount(1)
  await expect(chainLink).toHaveAttribute('aria-hidden', 'true')
  await expect(chainLink).toHaveAttribute('viewBox', '0 0 24 24')
  await expect(chainLink.locator('path')).toHaveCount(2)
  await expect(chainLink).toHaveCSS('fill', 'none')
  expect(await chainLink.evaluate((element) => getComputedStyle(element).stroke)).toBe(
    await linkedMove.evaluate((element) => getComputedStyle(element).color),
  )
  await expect(page.locator('.coordinate-grid')).toContainText('X')
  await expect(page.locator('.coordinate-grid')).toContainText('Y')
  await expect(page.locator('.coordinate-grid')).toContainText('Base')
  await expect(page.locator('.coordinate-grid').locator('.following-toggle')).toHaveCount(1)

  const proofControls = [
    {
      input: page.getByLabel('Change light proof background', { exact: true }),
      proof: page.locator('.proof-light'),
      color: '#fefefe',
      rgb: 'rgb(254, 254, 254)',
    },
    {
      input: page.getByLabel('Change dark proof background', { exact: true }),
      proof: page.locator('.proof-dark'),
      color: '#101827',
      rgb: 'rgb(16, 24, 39)',
    },
  ]
  for (const { input, proof, color, rgb } of proofControls) {
    await expect(input).toHaveAttribute('title', /Change .* proof background/)
    const inputBox = await input.boundingBox()
    const proofBox = await proof.boundingBox()
    expect(inputBox).not.toBeNull()
    expect(proofBox).not.toBeNull()
    expect(Math.abs((inputBox?.width ?? 0) - (proofBox?.width ?? 0))).toBeLessThanOrEqual(2)
    expect(Math.abs((inputBox?.height ?? 0) - (proofBox?.height ?? 0))).toBeLessThanOrEqual(2)
    await input.focus()
    expect(await proof.evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe('none')
    await input.fill(color)
    await expect(proof).toHaveCSS('background-color', rgb)
  }

  const smallProof = page.getByTestId('small-proof')
  const smallSize = page.getByLabel('Small proof size', { exact: true })
  await expect(smallProof.locator('input[aria-label="Small proof size"]')).toHaveCount(1)
  await expect(smallProof).not.toHaveClass(/(?:^|\s)proof(?:\s|$)/)
  await expect(smallProof).not.toHaveAttribute('role')
  await expect(smallSize).toHaveAttribute('title', 'Small proof size, 8 to 64 pixels')
  const expectActualSizeProof = async (expectedPixels: number) => {
    const smallBox = await smallProof.boundingBox()
    const largeBox = await page.locator('.proof-light').boundingBox()
    const artworkBox = await smallProof.locator('.proof-artwork svg').boundingBox()
    const sizeBox = await smallProof.locator('.small-proof-size').boundingBox()
    const inputBox = await smallSize.boundingBox()
    const suffixBox = await smallProof.locator('.small-proof-size span').boundingBox()
    expect(smallBox).not.toBeNull()
    expect(largeBox).not.toBeNull()
    expect(artworkBox).not.toBeNull()
    expect(sizeBox).not.toBeNull()
    expect(inputBox).not.toBeNull()
    expect(suffixBox).not.toBeNull()
    expect(await smallProof.evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        border: style.borderStyle,
        background: style.backgroundColor,
      }
    })).toEqual({
      border: 'none',
      background: 'rgba(0, 0, 0, 0)',
    })
    expect(artworkBox?.height).toBe(expectedPixels)
    expect(smallBox?.height ?? Infinity).toBeLessThanOrEqual(largeBox?.height ?? 0)
    expect(inputBox?.width ?? 0).toBeGreaterThanOrEqual(38)
    expect((inputBox?.x ?? 0) + (inputBox?.width ?? 0)).toBeLessThanOrEqual(
      (suffixBox?.x ?? 0) + 1,
    )
    expect(sizeBox?.x ?? 0).toBeGreaterThanOrEqual(
      (artworkBox?.x ?? 0) + (artworkBox?.width ?? 0),
    )
    expect((smallBox?.x ?? 0)).toBeGreaterThanOrEqual(0)
    expect((smallBox?.x ?? 0) + (smallBox?.width ?? 0)).toBeLessThanOrEqual(
      await page.evaluate(() => document.documentElement.clientWidth),
    )
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
      await page.evaluate(() => document.documentElement.clientWidth),
    )
  }

  await expect(smallSize).toHaveValue('32')
  await expectActualSizeProof(32)
  await smallSize.focus()
  expect(
    await smallSize.evaluate(
      (element) => getComputedStyle(element).boxShadow,
    ),
  ).not.toBe('none')

  await page.setViewportSize({ width: 390, height: 844 })
  await expectActualSizeProof(32)
  await page.setViewportSize({ width: 1440, height: 1000 })

  const stage = page.getByTestId('editor-stage')
  const firstGlyph = stage.locator('[data-glyph="0"]')
  const secondGlyph = stage.locator('[data-glyph="1"]')
  const before = {
    first: await firstGlyph.getAttribute('transform'),
    second: await secondGlyph.getAttribute('transform'),
  }
  await linkedMove.click()
  await expect(page.locator('.glyph-tabs [role="option"][aria-selected="true"]')).toHaveCount(7)
  await stage.focus()
  await page.keyboard.press('ArrowRight')
  const linked = {
    first: await firstGlyph.getAttribute('transform'),
    second: await secondGlyph.getAttribute('transform'),
  }
  expect(linked.first).not.toBe(before.first)
  expect(linked.second).not.toBe(before.second)

  await page.keyboard.press('Escape')
  await selectGlyph(page, 0)
  await expect(page.locator('.glyph-tabs [role="option"][aria-selected="true"]')).toHaveCount(1)
  await stage.focus()
  await page.keyboard.press('ArrowRight')
  expect(await firstGlyph.getAttribute('transform')).not.toBe(linked.first)
  expect(await secondGlyph.getAttribute('transform')).toBe(linked.second)
})

test('multi-selects letters and keeps group movement visible and precise', async ({ page }) => {
  await setText(page, 'AB')
  const layerList = page.getByRole('listbox', { name: 'Glyph layers' })
  const options = layerList.getByRole('option')
  await expect(layerList).toHaveAttribute('aria-multiselectable', 'true')
  await options.nth(0).click()
  await options.nth(1).click({ modifiers: ['Shift'] })
  await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true')
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect(options.nth(0)).toHaveAttribute('aria-label', '01 A')
  await expect(options.nth(1)).toHaveAttribute('aria-label', '02 B primary')
  await options.nth(0).click()
  await expect(options.nth(0)).toHaveAttribute('aria-label', '01 A primary')
  await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true')
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true')
  await options.nth(1).click()

  const stage = page.getByTestId('editor-stage')
  await expect(stage.locator('[data-selected="true"]')).toHaveCount(2)
  await expect(stage.locator('[data-primary="true"]')).toHaveAttribute('data-glyph-hit', '1')
  const firstGlyph = stage.locator('[data-glyph="0"]')
  const secondGlyph = stage.locator('[data-glyph="1"]')
  const positions = async () => ({
    first: translatePosition(await firstGlyph.getAttribute('transform')),
    second: translatePosition(await secondGlyph.getAttribute('transform')),
  })

  const before = await positions()
  await stage.focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  const afterNudge = await positions()
  expect(afterNudge.first.x - before.first.x).toBe(2)
  expect(afterNudge.second.x - before.second.x).toBe(2)
  await expect(page.getByLabel('B X position')).toHaveValue(String(afterNudge.second.x))

  await page.getByLabel('B X position').fill(String(afterNudge.second.x + 10))
  const afterCoordinate = await positions()
  expect(afterCoordinate.first.x - afterNudge.first.x).toBe(10)
  expect(afterCoordinate.second.x - afterNudge.second.x).toBe(10)

  const hit = stage.locator('[data-glyph-hit="1"]')
  const hitBox = await hit.boundingBox()
  expect(hitBox).not.toBeNull()
  const dragStart = {
    x: (hitBox?.x ?? 0) + (hitBox?.width ?? 0) / 2,
    y: (hitBox?.y ?? 0) + (hitBox?.height ?? 0) / 2,
  }
  const beforeDrag = await positions()
  await page.mouse.move(dragStart.x, dragStart.y)
  await page.mouse.down()
  await page.mouse.move(dragStart.x + 24, dragStart.y + 6)
  await page.mouse.up()
  const afterDrag = await positions()
  expect(afterDrag.first.x - beforeDrag.first.x).toBeCloseTo(
    afterDrag.second.x - beforeDrag.second.x,
    4,
  )
  expect(afterDrag.first.y - beforeDrag.first.y).toBeCloseTo(
    afterDrag.second.y - beforeDrag.second.y,
    4,
  )
  expect(afterDrag.second.x).not.toBe(beforeDrag.second.x)
})

test('uses roving keyboard focus for the glyph layer list', async ({ page }) => {
  await setText(page, 'ABC')
  const options = page.getByRole('listbox', { name: 'Glyph layers' }).getByRole('option')
  await options.nth(0).focus()
  await page.keyboard.press('ArrowRight')
  await expect(options.nth(1)).toBeFocused()
  await page.keyboard.press('Shift+Space')
  await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true')
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Enter')
  await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true')
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect(options.nth(1)).toHaveAttribute('aria-label', '02 B primary')
  await page.keyboard.press('End')
  await expect(options.nth(2)).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(options.nth(0)).toHaveAttribute('aria-selected', 'false')
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'false')
  await expect(options.nth(2)).toHaveAttribute('aria-selected', 'true')
})

test('keeps selection and layer focus valid after importing a shorter design', async ({ page }) => {
  await setText(page, 'A')
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Design JSON', exact: true }).click()
  const download = await downloadPromise
  const filePath = await download.path()
  expect(filePath).not.toBeNull()
  expect(download.suggestedFilename()).toBe('A.logolab.json')
  const importedDesign = await readFile(filePath ?? '')
  expect(JSON.parse(importedDesign.toString())).toMatchObject({ kind: 'logolab-design' })

  await setText(page, 'ABC')
  await selectGlyph(page, 2)
  await page.getByLabel('Import JSON').setInputFiles({
    name: 'shorter.logolab.json',
    mimeType: 'application/json',
    buffer: importedDesign,
  })

  await expect(page.getByLabel('Logo text', { exact: true })).toHaveValue('A')
  const importedOption = page.getByRole('listbox', { name: 'Glyph layers' }).getByRole('option')
  await expect(importedOption).toHaveCount(1)
  await expect(importedOption).toHaveAttribute('aria-selected', 'true')
  await expect(importedOption).toHaveAttribute('tabindex', '0')
})

test('light-dismisses the export popover and restores focus on Escape', async ({ page }) => {
  const trigger = page.getByRole('button', { name: 'Export', exact: true })
  const popover = page.locator('#export-popover')
  await trigger.click()
  await expect(popover).toBeVisible()
  await page.getByTestId('editor-stage').click({ position: { x: 8, y: 8 } })
  await expect(popover).toBeHidden()

  await trigger.click()
  await popover.getByRole('button', { name: 'SVG', exact: true }).focus()
  await page.keyboard.press('Escape')
  await expect(popover).toBeHidden()
  await expect(trigger).toBeFocused()
})

test('edits the actual-size proof through normal number-field states', async ({ page }) => {
  const size = page.getByLabel('Small proof size', { exact: true })
  const errorText = 'Small proof size must be a whole number from 8 to 64 px.'

  await size.focus()
  await page.keyboard.press('Control+A')
  await page.keyboard.press('Backspace')
  await expect(size).toHaveValue('')
  await expectSmallProofHeight(page, 32)
  await page.keyboard.type('4')
  await expect(size).toHaveValue('4')
  await expectSmallProofHeight(page, 32)
  await page.keyboard.type('9')
  await expect(size).toHaveValue('49')
  await expectSmallProofHeight(page, 49)
  await size.blur()
  await expect(size).toHaveValue('49')

  await size.focus()
  await page.keyboard.press('Backspace')
  await expect(size).toHaveValue('4')
  await expectSmallProofHeight(page, 49)
  await page.keyboard.type('2')
  await expect(size).toHaveValue('42')
  await expectSmallProofHeight(page, 42)
  await size.blur()

  await size.focus()
  await page.keyboard.press('Control+A')
  await page.keyboard.press('Backspace')
  await expect(size).toHaveValue('')
  await size.blur()
  await expect(size).toHaveValue('42')
  await expect(page.getByRole('alert')).toContainText(errorText)
  await page.getByRole('button', { name: 'Dismiss error' }).click()

  await size.focus()
  await page.keyboard.press('Control+A')
  await page.keyboard.type('65')
  await expect(size).toHaveValue('65')
  await expectSmallProofHeight(page, 42)
  await size.blur()
  await expect(size).toHaveValue('42')
  await expect(page.getByRole('alert')).toContainText(errorText)
  await page.getByRole('button', { name: 'Dismiss error' }).click()

  await size.focus()
  await page.keyboard.press('Control+A')
  await page.keyboard.type('50')
  await page.keyboard.press('Enter')
  await expect(size).toHaveValue('50')
  await expectSmallProofHeight(page, 50)

  await size.focus()
  await page.keyboard.press('Control+A')
  await page.keyboard.type('48')
  await expectSmallProofHeight(page, 48)
  await page.keyboard.press('Escape')
  await expect(size).toHaveValue('50')
  await expectSmallProofHeight(page, 50)

  await size.focus()
  await page.keyboard.press('ArrowUp')
  await expect(size).toHaveValue('51')
  await expectSmallProofHeight(page, 51)
  await page.keyboard.press('ArrowDown')
  await expect(size).toHaveValue('50')
  await expectSmallProofHeight(page, 50)
})

test('keeps light and dark proofs fixed while actual-size artwork changes', async ({ page }) => {
  const size = page.getByLabel('Small proof size', { exact: true })
  const proofGeometry = () =>
    page.evaluate(() => {
      const geometry = (selector: string) => {
        const { x, y, width, height } =
          document.querySelector(selector)!.getBoundingClientRect()
        return { x, y, width, height }
      }
      return {
        light: geometry('.proof-light'),
        dark: geometry('.proof-dark'),
      }
    })

  for (const viewport of [
    { width: 1254, height: 964 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport)
    await size.fill('8')
    await expectSmallProofHeight(page, 8)
    const baseline = await proofGeometry()

    for (const pixels of [32, 64]) {
      await size.fill(String(pixels))
      await expectSmallProofHeight(page, pixels)
      const current = await proofGeometry()
      for (const proof of ['light', 'dark'] as const) {
        expect(current[proof].x).toBeCloseTo(baseline[proof].x, 1)
        expect(current[proof].y).toBeCloseTo(baseline[proof].y, 1)
        expect(current[proof].width).toBeCloseTo(baseline[proof].width, 1)
        expect(current[proof].height).toBeCloseTo(baseline[proof].height, 1)
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
        viewport.width,
      )
    }
  }
})

test('centers painted bounds without changing coordinates or pointer mapping', async ({ page }) => {
  await setText(page, 'A ')
  await selectGlyph(page, 0)
  await setSelectedX(page, -475)
  const yInput = page.locator('.coordinate-grid input[type="number"]').nth(1)
  await yInput.fill('190')
  await yInput.blur()
  const expectedCoordinates = {
    x: await page.getByLabel('A X position').inputValue(),
    y: await page.getByLabel('A Y position').inputValue(),
  }

  for (const viewport of [
    { width: 1254, height: 964 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport)
    await page.getByRole('button', { name: 'Fit', exact: true }).click()
    for (const selector of [
      '.editor-stage',
      '.proof-light',
      '.proof-dark',
      '.proof-small',
    ]) {
      const offset = await paintedCenterOffset(page, selector)
      expect(Math.abs(offset.x)).toBeLessThanOrEqual(0.5)
      expect(Math.abs(offset.y)).toBeLessThanOrEqual(0.5)
    }
    await expect(page.getByLabel('A X position')).toHaveValue(expectedCoordinates.x)
    await expect(page.getByLabel('A Y position')).toHaveValue(expectedCoordinates.y)

    const stage = page.getByTestId('editor-stage')
    const svg = stage.locator('svg')
    const hit = svg.locator('[data-glyph-hit="0"]')
    await expect(hit).toBeVisible()
    const hitBox = await hit.evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
    })
    expect(hitBox.width).toBeGreaterThan(0)
    expect(hitBox.height).toBeGreaterThan(0)
    const start = {
      x: hitBox.x + hitBox.width * 0.3,
      y: hitBox.y + hitBox.height * 0.7,
    }
    const end = { x: start.x + 24, y: start.y + 12 }
    const scale = await stage.evaluate((element) => {
      const svgElement = element.querySelector('svg')
      const viewBox = svgElement?.getAttribute('viewBox')?.split(/\s+/).map(Number)
      const viewBoxWidth = viewBox?.[2]
      const viewBoxHeight = viewBox?.[3]
      if (!svgElement || !viewBoxWidth || !viewBoxHeight) {
        throw new Error('The SVG framing is unavailable.')
      }
      const bounds = svgElement.getBoundingClientRect()
      return Math.min(bounds.width / viewBoxWidth, bounds.height / viewBoxHeight)
    })
    const expectedDelta = {
      x: (end.x - start.x) / scale,
      y: (end.y - start.y) / scale,
    }
    const before = {
      x: Number(await page.getByLabel('A X position').inputValue()),
      y: Number(await page.getByLabel('A Y position').inputValue()),
    }
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y)
    await page.mouse.up()
    const after = {
      x: Number(await page.getByLabel('A X position').inputValue()),
      y: Number(await page.getByLabel('A Y position').inputValue()),
    }
    expect(after.x - before.x).toBeCloseTo(expectedDelta.x, 1)
    expect(after.y - before.y).toBeCloseTo(expectedDelta.y, 1)
    await page.getByLabel('A X position').fill(expectedCoordinates.x)
    await page.getByLabel('A X position').blur()
    await page.getByLabel('A Y position').fill(expectedCoordinates.y)
    await page.getByLabel('A Y position').blur()
  }
})

test('normalizes all coordinates once without changing the rendered composition', async ({
  page,
}) => {
  const normalize = page.getByRole('button', { name: 'Normalize coordinates' })
  const recalculate = page.getByRole('button', { name: 'Recalculate' })
  await expect(normalize).toHaveText('Normalize')
  await expect(normalize).toHaveAttribute(
    'title',
    'Set the selected glyph to 0,0 without changing relative placement',
  )
  await expect(page.locator('.overlap-action-buttons button')).toHaveText([
    'Recalculate',
    'Normalize',
  ])

  await selectGlyph(page, 2)
  const inputs = page.locator('.coordinate-grid input[type="number"]')
  await inputs.nth(0).fill('1325')
  await inputs.nth(0).blur()
  await inputs.nth(1).fill('-275')
  await inputs.nth(1).blur()
  await recalculate.click()

  const renderedState = () => page.locator('.proof-light').evaluate((proof) => {
    const parseTranslation = (value: string | null) => {
      const match = value?.match(/translate\(([-\d.]+) ([-\d.]+)\)/)
      return { x: Number(match?.[1]), y: Number(match?.[2]) }
    }
    return {
      viewBox: proof.querySelector('svg')?.getAttribute('viewBox') ?? '',
      glyphs: Array.from(proof.querySelectorAll('svg > path[data-glyph]')).map((glyph) =>
        parseTranslation(glyph.getAttribute('transform'))),
      clips: Array.from(proof.querySelectorAll('clipPath path')).map((clip) =>
        clip.getAttribute('transform')),
      overlaps: Array.from(proof.querySelectorAll('[data-overlap]')).map((overlap) => ({
        key: overlap.getAttribute('data-overlap'),
        fill: overlap.getAttribute('fill'),
        path: overlap.getAttribute('d'),
      })),
    }
  })
  const before = await renderedState()
  const beforePairRows = await page.locator('.pair-row').allTextContents()
  const beforePixels = await page.locator('.proof-light').screenshot()
  const beforeSvg = await downloadSvg(page)

  await normalize.click()
  await expect(page.getByText('Coordinates normalized to 0,0.', { exact: true })).toBeVisible()
  await expect(page.locator('.glyph-tabs button').nth(2)).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(inputs.nth(0)).toHaveValue('0')
  await expect(inputs.nth(1)).toHaveValue('0')
  await expect(page.getByText('Stale', { exact: true })).toHaveCount(0)

  const after = await renderedState()
  const commonTranslation = {
    x: after.glyphs[0]!.x - before.glyphs[0]!.x,
    y: after.glyphs[0]!.y - before.glyphs[0]!.y,
  }
  for (const [index, glyph] of after.glyphs.entries()) {
    expect(glyph.x - before.glyphs[index]!.x).toBeCloseTo(commonTranslation.x, 6)
    expect(glyph.y - before.glyphs[index]!.y).toBeCloseTo(commonTranslation.y, 6)
  }
  for (let index = 1; index < after.glyphs.length; index += 1) {
    expect(after.glyphs[index]!.x - after.glyphs[index - 1]!.x).toBeCloseTo(
      before.glyphs[index]!.x - before.glyphs[index - 1]!.x,
      6,
    )
    expect(after.glyphs[index]!.y - after.glyphs[index - 1]!.y).toBeCloseTo(
      before.glyphs[index]!.y - before.glyphs[index - 1]!.y,
      6,
    )
  }
  expect(after.viewBox.split(/\s+/).slice(0, 2).map(Number)).toEqual(
    before.viewBox
      .split(/\s+/)
      .slice(0, 2)
      .map((value, index) => Number(value) + (index === 0
        ? commonTranslation.x
        : commonTranslation.y)),
  )
  expect(after.clips).toEqual(before.clips)
  expect(after.overlaps).toEqual(before.overlaps)
  expect(await page.locator('.pair-row').allTextContents()).toEqual(beforePairRows)
  expect(Buffer.compare(await page.locator('.proof-light').screenshot(), beforePixels)).toBe(0)

  const afterSvg = await downloadSvg(page)
  const svgViewBox = (svg: string): [number, number, number, number] => {
    const values = svg.match(/viewBox="([^"]+)"/)?.[1]?.split(/\s+/).map(Number)
    if (!values || values.length !== 4) {
      throw new Error('Exported SVG viewBox is unavailable.')
    }
    return [values[0]!, values[1]!, values[2]!, values[3]!]
  }
  const beforeExportBounds = svgViewBox(beforeSvg)
  const afterExportBounds = svgViewBox(afterSvg)
  expect(afterExportBounds[0] - beforeExportBounds[0]).toBeCloseTo(
    commonTranslation.x,
    6,
  )
  expect(afterExportBounds[1] - beforeExportBounds[1]).toBeCloseTo(
    commonTranslation.y,
    6,
  )
  expect(afterExportBounds.slice(2)).toEqual(beforeExportBounds.slice(2))
  const clipTransforms = (svg: string) =>
    (svg.match(/<clipPath[\s\S]*?<\/clipPath>/g) ?? [])
      .flatMap((clip) => [...clip.matchAll(/transform="([^"]+)"/g)].map((match) => match[1]))
  expect(clipTransforms(afterSvg)).toEqual(clipTransforms(beforeSvg))

  const firstNormalizedState = await renderedState()
  await normalize.click()
  await expect(
    page.getByText('Coordinates are already normalized to 0,0.', { exact: true }),
  ).toBeVisible()
  expect(await renderedState()).toEqual(firstNormalizedState)
  await page.getByTestId('editor-stage').focus()
  await page.keyboard.press('Escape')
  await expect(normalize).toBeDisabled()

  for (const viewport of [
    { width: 1254, height: 964 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport)
    const geometry = await page.locator('.overlap-actions').evaluate((actions) => {
      const [first, second] = Array.from(actions.querySelectorAll('button'))
        .map((button) => button.getBoundingClientRect())
      return {
        actionWidth: actions.getBoundingClientRect().width,
        scrollWidth: actions.scrollWidth,
        first: first ? { right: first.right, y: first.y } : null,
        second: second ? { left: second.left, y: second.y } : null,
        documentOverflow: document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      }
    })
    expect(geometry.first).not.toBeNull()
    expect(geometry.second).not.toBeNull()
    expect(geometry.second?.left ?? 0).toBeGreaterThan(geometry.first?.right ?? 0)
    expect(geometry.second?.y).toBeCloseTo(geometry.first?.y ?? 0, 1)
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.actionWidth + 1)
    expect(geometry.documentOverflow).toBeLessThanOrEqual(1)
  }
})

test('renders every bundled font and isolates autosave by font and text', async ({ page }) => {
  const families = [
    'Archivo',
    'Bricolage Grotesque',
    'Figtree',
    'Fraunces',
    'Manrope',
    'Plus Jakarta Sans',
    'Rubik',
    'Sora',
    'Space Grotesk',
    'Syne',
    'Unbounded',
    'Work Sans',
  ]
  await setSelectedX(page, 123)
  for (const family of families) {
    await selectFont(page, family)
    await expect(page.getByTestId('editor-stage').locator('[data-glyph]')).toHaveCount(7)
  }

  await selectFont(page, 'Figtree')
  await setSelectedX(page, 456)
  await selectFont(page, 'Rubik')
  await expect(page.getByLabel('L X position')).toHaveValue('123')
  await setText(page, 'Lab')
  await setSelectedX(page, 789)
  await setText(page, 'LogoLab')
  await expect(page.getByLabel('L X position')).toHaveValue('123')
  await selectFont(page, 'Figtree')
  await expect(page.getByLabel('L X position')).toHaveValue('456')
})

test('keeps the pending text draft when switching fonts', async ({ page }) => {
  await page.evaluate(() => document.fonts.ready)
  let releaseFontRequest: (() => void) | undefined
  let markFontRequestStarted: (() => void) | undefined
  const fontRequestStarted = new Promise<void>((resolve) => {
    markFontRequestStarted = resolve
  })
  await page.route(
    '**/fonts/Figtree-Black.ttf',
    async (route) => {
      markFontRequestStarted?.()
      await new Promise<void>((resolve) => {
        releaseFontRequest = resolve
      })
      await route.continue()
    },
    { times: 1 },
  )
  await page.getByLabel('Text').fill('Mark')
  const picker = page.locator('.font-picker')
  await picker.locator('summary').click()
  await picker.getByRole('option', { name: 'Figtree', exact: true }).click()
  await fontRequestStarted
  await page.getByLabel('Text').fill('Fresh')
  await page.getByLabel('Text').fill('Mark')
  releaseFontRequest?.()

  await expect(page.getByLabel('Text')).toHaveValue('Mark')
  await expect(picker.locator('summary')).toContainText('Figtree')
  await expect(page.locator('.glyph-tabs button')).toHaveCount(4)
})

test('blocks export while an explicit font switch is loading', async ({ page }) => {
  await page.evaluate(() => document.fonts.ready)
  let releaseFontRequest: (() => void) | undefined
  let markFontRequestStarted: (() => void) | undefined
  const fontRequestStarted = new Promise<void>((resolve) => {
    markFontRequestStarted = resolve
  })
  await page.route(
    '**/fonts/Figtree-Black.ttf',
    async (route) => {
      markFontRequestStarted?.()
      await new Promise<void>((resolve) => {
        releaseFontRequest = resolve
      })
      await route.continue()
    },
    { times: 1 },
  )
  let downloads = 0
  page.on('download', () => {
    downloads += 1
  })

  const picker = page.locator('.font-picker')
  await picker.locator('summary').click()
  await picker.getByRole('option', { name: 'Figtree', exact: true }).click()
  await fontRequestStarted
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await page.getByRole('button', { name: 'SVG', exact: true }).click()

  await expect(page.getByRole('alert')).toContainText(
    'Wait for the current font operation to finish, then export again.',
  )
  expect(downloads).toBe(0)
  releaseFontRequest?.()
  await expect(picker.locator('summary')).toContainText('Figtree')
  await expect(page.locator('.glyph-tabs button')).toHaveCount(7)
})

test('cancels export without overwriting edits made while its font loads', async ({ page }) => {
  let releaseFontRequest: (() => void) | undefined
  let markFontRequestStarted: (() => void) | undefined
  const fontRequestStarted = new Promise<void>((resolve) => {
    markFontRequestStarted = resolve
  })
  let intercepted = false
  await page.route('**/fonts/Rubik-Black.ttf', async (route) => {
    if (intercepted) {
      await route.continue()
      return
    }
    intercepted = true
    markFontRequestStarted?.()
    await new Promise<void>((resolve) => {
      releaseFontRequest = resolve
    })
    await route.continue()
  })
  let downloads = 0
  page.on('download', () => {
    downloads += 1
  })

  await page.getByLabel('Text').fill('Atomic')
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await page.getByRole('button', { name: 'SVG', exact: true }).click()
  await fontRequestStarted
  await page.getByLabel('Text').fill('Latest')
  releaseFontRequest?.()

  await expect(page.getByRole('alert')).toContainText(
    'The text changed while export was preparing. Export again.',
  )
  await expect(page.getByLabel('Text')).toHaveValue('Latest')
  expect(downloads).toBe(0)
  await expect(page.locator('.glyph-tabs button')).toHaveCount(6)
  await expect(page.getByTestId('editor-stage').locator('svg')).toHaveAttribute(
    'aria-label',
    /^Latest logo proof/,
  )
})

test('keeps in-memory work and contains localStorage quota failures', async ({ page }) => {
  const pageErrors: Error[] = []
  page.on('pageerror', (caught) => pageErrors.push(caught))
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('Storage quota exceeded.', 'QuotaExceededError')
    }
  })

  await page.getByLabel('Text').fill('Quota')
  const picker = page.locator('.font-picker')
  await picker.locator('summary').click()
  await picker.getByRole('option', { name: 'Figtree', exact: true }).click()

  await expect(page.getByRole('alert')).toContainText(
    'Could not save locally. Free browser storage or export JSON, then try again.',
  )
  await expect(page.getByLabel('Text')).toHaveValue('Quota')
  await expect(picker.locator('summary')).toContainText('Rubik')
  await expect(page.locator('.glyph-tabs button')).toHaveCount(7)
  expect(pageErrors).toEqual([])
})

test('keeps the workbench usable when browser storage access is blocked', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: () => {
        throw new DOMException('Storage is blocked.', 'SecurityError')
      },
    })
  })
  await page.reload()

  await expect(page.getByTestId('workbench-shell')).toBeVisible()
  await expect(page.getByRole('alert')).toContainText(
    'Could not save locally. Free browser storage or export JSON, then try again.',
  )
  await expect(page.getByLabel('Text')).toHaveValue('LogoLab')
})

test('letter drag, empty click, Escape, and Space-pan remain distinct', async ({ page }) => {
  const stage = page.getByTestId('editor-stage')
  const svg = stage.locator('svg')
  const hit = svg.locator('[data-glyph-hit="0"]')
  const hitBox = await hit.boundingBox()
  expect(hitBox).not.toBeNull()
  const beforeX = Number(await page.getByLabel('L X position').inputValue())
  const beforeViewBox = await svg.getAttribute('viewBox')
  const glyphPoint = {
    x: (hitBox?.x ?? 0) + (hitBox?.width ?? 0) * 0.1,
    y: (hitBox?.y ?? 0) + (hitBox?.height ?? 0) * 0.5,
  }
  await page.mouse.move(glyphPoint.x, glyphPoint.y)
  await page.mouse.down()
  await page.mouse.move(glyphPoint.x + 35, glyphPoint.y + 10)
  await page.mouse.up()
  const afterLetterX = Number(await page.getByLabel('L X position').inputValue())
  expect(afterLetterX).not.toBe(beforeX)
  await expect(svg).toHaveAttribute('viewBox', beforeViewBox ?? '')
  await expect(page.getByText('Stale', { exact: true })).toBeVisible()

  const stageBox = await stage.boundingBox()
  expect(stageBox).not.toBeNull()
  const empty = { x: (stageBox?.x ?? 0) + 8, y: (stageBox?.y ?? 0) + 8 }
  await page.mouse.click(empty.x, empty.y)
  await expect(svg.locator('[data-selected="true"]')).toHaveCount(0)
  await expect(page.locator('.coordinate-grid')).toHaveCount(0)

  await selectGlyph(page, 0)
  await expect(svg.locator('[data-selected="true"]')).toHaveCount(1)
  await stage.focus()
  await page.keyboard.press('Escape')
  await expect(svg.locator('[data-selected="true"]')).toHaveCount(0)

  await selectGlyph(page, 0)
  await stage.focus()
  await page.keyboard.down('Space')
  await page.mouse.move(empty.x, empty.y)
  await page.mouse.down()
  await page.mouse.move(empty.x + 50, empty.y + 20)
  await page.mouse.up()
  await page.keyboard.up('Space')
  await expect(svg).not.toHaveAttribute('viewBox', beforeViewBox ?? '')
  await expect(page.getByLabel('L X position')).toHaveValue(
    String(Math.round(afterLetterX * 100) / 100),
  )
})

test('export recalculates stale overlaps and writes nested pair-relative SVG clips', async ({ page }) => {
  await setText(page, 'ABC')
  const placements = [
    { x: 125, y: 40 },
    { x: 475, y: -35 },
    { x: 650, y: 25 },
  ]
  for (const [index, placement] of placements.entries()) {
    await selectGlyph(page, index)
    await setSelectedX(page, placement.x)
    const yInput = page.locator('.coordinate-grid input[type="number"]').nth(1)
    await yInput.fill(String(placement.y))
    await yInput.blur()
  }
  await page.getByRole('button', { name: 'Recalculate' }).click()
  const firstColor = page.locator('.pair-row input[type="color"]').first()
  await firstColor.fill('#abcdef')
  await selectGlyph(page, 1)
  await setSelectedX(page, 500)
  await expect(page.getByText('Stale', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Zoom in' }).click()
  const editorViewBox = await page.getByTestId('editor-stage').locator('svg').getAttribute('viewBox')

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await page.getByRole('button', { name: 'SVG', exact: true }).click()
  const download = await downloadPromise
  const filePath = await download.path()
  expect(filePath).not.toBeNull()
  const svg = await readFile(filePath ?? '', 'utf8')
  const clipPaths = svg.match(/<clipPath[\s\S]*?<\/clipPath>/g)?.join('') ?? ''
  expect(svg).toContain('clipPathUnits="userSpaceOnUse"')
  expect(clipPaths).toContain('transform="translate(375 -75)"')
  expect(clipPaths).not.toContain('transform="translate(500 -35)"')
  expect(svg).toContain('fill="#abcdef"')
  expect(svg).not.toContain(`viewBox="${editorViewBox ?? ''}"`)
  await expect(page.getByText('Stale', { exact: true })).toHaveCount(0)
})

test('dynamic pair and N-way overlap colors all appear in rasterized Edge pixels', async ({ page }) => {
  await setText(page, 'MMMM')
  for (const [index, x] of [0, 260, 520, 780].entries()) {
    await selectGlyph(page, index)
    await setSelectedX(page, x)
  }
  await page.getByRole('button', { name: 'Recalculate' }).click()
  await expect(page.locator('[data-overlap="0-1-2"]')).not.toHaveCount(0)

  const inputs = page.locator('.pair-row input[type="color"]')
  const overlapCount = await inputs.count()
  expect(overlapCount).toBeGreaterThan(3)
  const palette = [
    '#0b84f3', '#e0522d', '#24a66a', '#8957d7', '#df2f77',
    '#9a6b00', '#008a9a', '#b33b3b', '#5b7f00', '#6a51b5',
  ]
  const colors = palette.slice(0, overlapCount)
  for (const [index, color] of colors.entries()) {
    await inputs.nth(index).fill(color)
  }

  const counts = await page.locator('.proof').first().locator('svg').evaluate(
    async (svg, expectedColors) => {
      const source = new XMLSerializer().serializeToString(svg)
      const image = new Image()
      const loaded = new Promise<void>((resolve, reject) => {
        image.onload = () => resolve()
        image.onerror = () => reject(new Error('Could not rasterize proof SVG.'))
      })
      image.src = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' }))
      await loaded
      const canvas = document.createElement('canvas')
      canvas.width = 1600
      canvas.height = 700
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) {
        throw new Error('Canvas is unavailable.')
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(image.src)
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
      return expectedColors.map((color) => {
        const red = Number.parseInt(color.slice(1, 3), 16)
        const green = Number.parseInt(color.slice(3, 5), 16)
        const blue = Number.parseInt(color.slice(5, 7), 16)
        let count = 0
        for (let index = 0; index < pixels.length; index += 4) {
          if (
            pixels[index] === red &&
            pixels[index + 1] === green &&
            pixels[index + 2] === blue &&
            pixels[index + 3] === 255
          ) {
            count += 1
          }
        }
        return count
      })
    },
    colors,
  )
  expect(counts.every((count) => count > 0)).toBe(true)
})

test('adds and confirms removal of a local font and its saved variants', async ({ page }) => {
  const fontPath = path.resolve('public/fonts/Figtree-Black.ttf')
  await page.locator('input[type="file"][accept*=".ttf"]').setInputFiles(fontPath)
  await expect(page.locator('.font-picker summary')).toContainText('Figtree')
  await setSelectedX(page, 321)
  await setText(page, 'Local')
  await setSelectedX(page, 654)
  await setText(page, 'LogoLab')

  await page.locator('.font-picker summary').click()
  const localRemove = page.getByRole('button', { name: /Remove Figtree/ })
  page.once('dialog', (dialog) => dialog.accept())
  await localRemove.click()
  await expect(page.locator('.font-picker summary')).toContainText('Rubik')
  await page.waitForTimeout(400)
  const localKeys = await page.evaluate(() =>
    Object.keys(localStorage).filter((key) => key.startsWith('logolab:design:local-')),
  )
  expect(localKeys).toEqual([])
})

test('keeps selection and layer focus valid when a font upload uses shorter pending text', async ({
  page,
}) => {
  await selectGlyph(page, 6)
  await page.getByLabel('Logo text', { exact: true }).fill('A')
  await page
    .locator('input[type="file"][accept*=".ttf"]')
    .setInputFiles(path.resolve('public/fonts/Figtree-Black.ttf'))

  await expect(page.locator('.font-picker summary')).toContainText('Figtree')
  await expect(page.getByLabel('Logo text', { exact: true })).toHaveValue('A')
  const option = page.getByRole('listbox', { name: 'Glyph layers' }).getByRole('option')
  await expect(option).toHaveCount(1)
  await expect(option).toHaveAttribute('aria-selected', 'true')
  await expect(option).toHaveAttribute('tabindex', '0')
})

test('keeps active work accessible without recreating variants if removal fallback fails', async ({
  page,
}) => {
  const fontPath = path.resolve('public/fonts/Figtree-Black.ttf')
  await page.locator('input[type="file"][accept*=".ttf"]').setInputFiles(fontPath)
  await expect(page.locator('.font-picker summary')).toContainText('Figtree')
  await setSelectedX(page, 612)
  await page.route('**/fonts/Rubik-Black.ttf', (route) =>
    route.fulfill({ status: 503, body: 'Unavailable' }),
  )

  await page.locator('.font-picker summary').click()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: /Remove Figtree/ }).click()

  await expect(page.getByTestId('workbench-shell')).toBeVisible()
  await expect(page.locator('.font-picker summary')).toContainText('Figtree')
  await expect(page.getByLabel('L X position')).toHaveValue('612')
  await setText(page, 'Kept')
  await setSelectedX(page, 713)
  await page.waitForTimeout(400)
  const localKeys = await page.evaluate(() =>
    Object.keys(localStorage).filter((key) => key.startsWith('logolab:design:local-')),
  )
  expect(localKeys).toEqual([])
})

test('supports PNG presets and a custom validated longest side', async ({ page }) => {
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const preset = page.getByLabel('PNG longest side preset')
  await preset.selectOption('1024')
  await expect(preset).toHaveValue('1024')
  await preset.selectOption('custom')
  await page.getByLabel('Custom PNG longest side').fill('1536')
  await expect(page.getByLabel('Custom PNG longest side')).toHaveValue('1536')
})

test('accepts pasted hex codes everywhere a color can be set', async ({ page }) => {
  await selectGlyph(page, 0)
  const baseHex = page.getByLabel('L base color hex')
  await expect(baseHex).toHaveValue('#1b6ef3')

  await baseHex.fill('E3008C')
  await expect(page.getByLabel('L base color', { exact: true })).toHaveValue('#e3008c')
  await expect(page.getByTestId('editor-stage').locator('[data-glyph="0"]')).toHaveAttribute(
    'fill',
    '#e3008c',
  )

  await baseHex.fill('not a color')
  await baseHex.blur()
  await expect(baseHex).toHaveValue('#e3008c')
  await expect(page.getByLabel('L base color', { exact: true })).toHaveValue('#e3008c')

  await baseHex.fill('#0f0')
  await expect(page.getByLabel('L base color', { exact: true })).toHaveValue('#00ff00')

  await page.waitForTimeout(400)
  const stored = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((candidate) =>
      candidate.startsWith('logolab:design:'),
    )
    return key ? (JSON.parse(localStorage.getItem(key) ?? '{}') as { glyphs?: { color: string }[] }) : null
  })
  expect(stored?.glyphs?.[0]?.color).toBe('#00ff00')

  const lightHex = page.getByLabel('Light proof background hex')
  await expect(lightHex).toHaveValue('#f7f9fc')
  await lightHex.fill('#eee')
  await expect(page.locator('.proof-light')).toHaveCSS('background-color', 'rgb(238, 238, 238)')

  const darkHex = page.getByLabel('Dark proof background hex')
  await darkHex.fill('1a1a1a')
  await expect(page.locator('.proof-dark')).toHaveCSS('background-color', 'rgb(26, 26, 26)')
})

test('typing an overlap hex switches that overlap off mixed mode', async ({ page }) => {
  await setText(page, 'MM')
  await selectGlyph(page, 0)
  await setSelectedX(page, 0)
  await selectGlyph(page, 1)
  await setSelectedX(page, 260)
  await page.getByRole('button', { name: 'Recalculate' }).click()

  const row = page.locator('.pair-row').first()
  const mix = row.getByRole('button', { name: 'Mix' })
  await mix.click()
  await expect(mix).toHaveAttribute('aria-pressed', 'true')

  const overlapHex = row.locator('input.hex-text')
  await overlapHex.fill('#e3008c')

  await expect(mix).toHaveAttribute('aria-pressed', 'false')
  await expect(row.locator('input[type="color"]')).toHaveValue('#e3008c')

  await page.getByRole('button', { name: 'Recalculate' }).click()
  await expect(page.locator('.pair-row').first().locator('input[type="color"]')).toHaveValue(
    '#e3008c',
  )
})
