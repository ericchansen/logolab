import { getDesignBounds } from './geometry'
import { buildSvgMarkup } from './svg'
import type {
  DesignDocument,
  FontRuntime,
  PortableDesign,
  StoredFont,
} from './types'

function safeFileName(text: string): string {
  const cleaned = text.trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')
  return cleaned || 'logo'
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

export function exportSvg(design: DesignDocument, font: FontRuntime): string {
  return buildSvgMarkup(design, font, {
    renderId: `export-${crypto.randomUUID()}`,
  })
}

export function downloadSvg(design: DesignDocument, font: FontRuntime): void {
  downloadBlob(
    new Blob([exportSvg(design, font)], { type: 'image/svg+xml' }),
    `${safeFileName(design.text)}.svg`,
  )
}

export async function downloadPng(
  design: DesignDocument,
  font: FontRuntime,
): Promise<void> {
  const bounds = getDesignBounds(design, font)
  const maxSide = design.pngLongestSide
  if (!Number.isInteger(maxSide) || maxSide < 64 || maxSide > 8192) {
    throw new Error('PNG longest side must be between 64 and 8192 pixels.')
  }
  const scale = maxSide / Math.max(bounds.width, bounds.height)
  const width = Math.max(1, Math.round(bounds.width * scale))
  const height = Math.max(1, Math.round(bounds.height * scale))
  const markup = exportSvg(design, font)
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }))
  const image = new Image()
  image.src = url
  await image.decode()
  const canvas = document.createElement('canvas')
  if (width * height > 67_108_864) {
    throw new Error('This PNG is too large for a reliable browser export.')
  }
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) {
    URL.revokeObjectURL(url)
    throw new Error('PNG export is not available in this browser.')
  }
  context.drawImage(image, 0, 0, width, height)
  URL.revokeObjectURL(url)
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value) {
        resolve(value)
      } else {
        reject(new Error('The PNG could not be encoded.'))
      }
    }, 'image/png')
  })
  downloadBlob(blob, `${safeFileName(design.text)}-${width}x${height}.png`)
}

export function downloadDesign(
  design: DesignDocument,
  storedFont?: StoredFont,
): void {
  const payload: PortableDesign = {
    kind: 'logo-lab-design',
    schemaVersion: 2,
    design,
    ...(storedFont ? { font: storedFont } : {}),
  }
  downloadBlob(
    new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    }),
    `${safeFileName(design.text)}.logo-lab.json`,
  )
}
