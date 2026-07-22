import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

async function waitForReady(page: Page) {
  await expect(page.getByRole('heading', { name: 'Compose a wordmark, one outline at a time.' })).toBeVisible()
  await expect(page.getByRole('status')).toContainText('Saved locally')
}

async function applyText(page: Page, text: string) {
  await page.getByLabel('Text · 1–12 characters').fill(text)
  await page.getByRole('button', { name: 'Apply' }).click()
  await expect(page.getByRole('status')).toContainText('Saved locally')
}

async function setSelectedX(page: Page, value: number) {
  const input = page.locator('.coordinate-grid input[type="number"]').first()
  await input.fill(String(value))
  await input.blur()
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => {
    localStorage.clear()
    indexedDB.deleteDatabase('logo-lab')
  })
  await page.reload()
  await waitForReady(page)
})

test('isolates autosave by font and text without a switch race', async ({ page }) => {
  await setSelectedX(page, 123)
  await page.route('**/fonts/Figtree-Variable.ttf', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300))
    await route.continue()
  })
  await page.getByLabel('Font').selectOption('figtree-extrabold')
  await expect(page.getByLabel('Add local TTF or OTF')).toBeDisabled()
  await expect(page.getByLabel('Import JSON')).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Apply' })).toBeDisabled()
  await expect(page.getByRole('status')).toContainText('Saved locally')
  await setSelectedX(page, 456)

  await page.getByLabel('Font').selectOption('sora-extrabold')
  await expect(page.getByRole('status')).toContainText('Saved locally')
  await expect(page.locator('.coordinate-grid input[type="number"]').first()).toHaveValue('123')

  await applyText(page, 'Lab')
  await setSelectedX(page, 789)
  await applyText(page, 'Logo')
  await expect(page.locator('.coordinate-grid input[type="number"]').first()).toHaveValue('123')

  await page.getByLabel('Font').selectOption('figtree-extrabold')
  await expect(page.getByRole('status')).toContainText('Saved locally')
  await expect(page.locator('.coordinate-grid input[type="number"]').first()).toHaveValue('456')
})

test('letter drag, background drag, and Space-pan remain distinct', async ({ page }) => {
  const stage = page.getByTestId('editor-stage')
  const svg = stage.locator('svg')
  const hit = svg.locator('[data-glyph-hit="0"]')
  const hitBox = await hit.boundingBox()
  expect(hitBox).not.toBeNull()
  const beforeX = Number(await page.locator('.coordinate-grid input[type="number"]').first().inputValue())
  const beforeViewBox = await svg.getAttribute('viewBox')

  const glyphPoint = {
    x: (hitBox?.x ?? 0) + (hitBox?.width ?? 0) * 0.1,
    y: (hitBox?.y ?? 0) + (hitBox?.height ?? 0) * 0.5,
  }
  await page.mouse.move(glyphPoint.x, glyphPoint.y)
  await page.mouse.down()
  await page.mouse.move(glyphPoint.x + 35, glyphPoint.y + 10)
  await page.mouse.up()
  const afterLetterX = Number(await page.locator('.coordinate-grid input[type="number"]').first().inputValue())
  expect(afterLetterX).not.toBe(beforeX)
  await expect(svg).toHaveAttribute('viewBox', beforeViewBox ?? '')

  const stageBox = await stage.boundingBox()
  expect(stageBox).not.toBeNull()
  const backgroundPoint = {
    x: (stageBox?.x ?? 0) + 8,
    y: (stageBox?.y ?? 0) + 8,
  }
  await page.mouse.move(backgroundPoint.x, backgroundPoint.y)
  await page.mouse.down()
  await page.mouse.move(backgroundPoint.x + 50, backgroundPoint.y + 20)
  await page.mouse.up()
  await expect(svg).toHaveAttribute('viewBox', beforeViewBox ?? '')

  await stage.focus()
  await page.keyboard.down('Space')
  await page.mouse.move(backgroundPoint.x, backgroundPoint.y)
  await page.mouse.down()
  await page.mouse.move(backgroundPoint.x + 50, backgroundPoint.y + 20)
  await page.mouse.up()
  await page.keyboard.up('Space')
  await expect(svg).not.toHaveAttribute('viewBox', beforeViewBox ?? '')
  await expect(page.locator('.coordinate-grid input[type="number"]').first()).toHaveValue(String(Math.round(afterLetterX * 100) / 100))
})

test('SVG export uses pair-relative transforms and explicit colors', async ({ page }) => {
  await applyText(page, 'AB')
  await setSelectedX(page, 125)
  await page.locator('.glyph-tabs button').nth(1).click()
  await setSelectedX(page, 475)
  await page.getByLabel('B Y position').fill('-35')
  await page.getByLabel('B Y position').blur()
  await page.locator('.glyph-tabs button').nth(0).click()
  await page.getByLabel('A Y position').fill('40')
  await page.getByLabel('A Y position').blur()
  await page.getByLabel('A B overlap color').fill('#abcdef')

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Transparent SVG' }).click()
  const download = await downloadPromise
  const filePath = await download.path()
  expect(filePath).not.toBeNull()
  const svg = await readFile(filePath ?? '', 'utf8')
  const clipPath = svg.match(/<clipPath[\s\S]*?<\/clipPath>/)?.[0]
  expect(svg).toContain('clipPathUnits="userSpaceOnUse"')
  expect(clipPath).toContain('transform="translate(350 -75)"')
  expect(clipPath).not.toContain('transform="translate(475 -35)"')
  expect(svg).toContain('fill="#abcdef"')
})

test('all adjacent overlap colors appear in rasterized Edge pixels', async ({ page }) => {
  await applyText(page, 'MMMM')
  const positions = [0, 280, 560, 840]
  for (const [index, x] of positions.entries()) {
    await page.locator('.glyph-tabs button').nth(index).click()
    await setSelectedX(page, x)
  }
  const colors = ['#12a0f4', '#e05d2a', '#2ead73']
  for (const [index, color] of colors.entries()) {
    await page.locator('.pair-row input[type="color"]').nth(index).fill(color)
  }

  const counts = await page.locator('.proof').first().locator('svg').evaluate(
    async (svg, expectedColors) => {
      const source = new XMLSerializer().serializeToString(svg)
      const image = new Image()
      const loaded = new Promise<void>((resolve, reject) => {
        image.onload = () => resolve()
        image.onerror = () => reject(new Error('Could not rasterize proof SVG.'))
      })
      image.src = URL.createObjectURL(
        new Blob([source], { type: 'image/svg+xml' }),
      )
      await loaded
      const canvas = document.createElement('canvas')
      canvas.width = 1200
      canvas.height = 600
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) {
        throw new Error('Canvas is unavailable.')
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(image.src)
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
      return expectedColors.map((color) => {
        const [red, green, blue] = [
          Number.parseInt(color.slice(1, 3), 16),
          Number.parseInt(color.slice(3, 5), 16),
          Number.parseInt(color.slice(5, 7), 16),
        ]
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

test('accepts a local font without network upload and remains usable at narrow width', async ({ page }) => {
  const fontPath = path.resolve('public/fonts/Figtree-Variable.ttf')
  await page.getByLabel('Add local TTF or OTF').setInputFiles(fontPath)
  await expect(page.getByLabel('Font')).toContainText('Figtree')
  await expect(page.getByText('Font data stays on this device.')).toBeVisible()

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByTestId('editor-stage')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Transparent SVG' })).toBeVisible()
  await expect(page.getByTestId('small-proof')).toHaveCSS('height', '32px')
})
