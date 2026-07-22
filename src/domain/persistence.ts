import { validateDesign } from './design'
import type { DesignDocument, StoredFont } from './types'

const DESIGN_PREFIX = 'logo-lab:design:'
const DATABASE_NAME = 'logo-lab'
const FONT_STORE = 'fonts'
const DATABASE_VERSION = 1

export function designStorageKey(fontId: string, text: string): string {
  return `${DESIGN_PREFIX}${encodeURIComponent(fontId)}:${encodeURIComponent(text)}`
}

export function saveDesign(
  design: DesignDocument,
  storage: Storage = localStorage,
): void {
  storage.setItem(
    designStorageKey(design.fontId, design.text),
    JSON.stringify(design),
  )
}

export function loadDesign(
  fontId: string,
  text: string,
  storage: Storage = localStorage,
): DesignDocument | null {
  const serialized = storage.getItem(designStorageKey(fontId, text))
  if (!serialized) {
    return null
  }
  try {
    return validateDesign(JSON.parse(serialized))
  } catch {
    storage.removeItem(designStorageKey(fontId, text))
    return null
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(FONT_STORE)) {
        request.result.createObjectStore(FONT_STORE, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open font storage.'))
  })
}

export async function putStoredFont(font: StoredFont): Promise<void> {
  const database = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(FONT_STORE, 'readwrite')
    transaction.objectStore(FONT_STORE).put(font)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Could not store the local font.'))
  })
  database.close()
}

export async function getStoredFonts(): Promise<StoredFont[]> {
  const database = await openDatabase()
  const fonts = await new Promise<StoredFont[]>((resolve, reject) => {
    const request = database
      .transaction(FONT_STORE, 'readonly')
      .objectStore(FONT_STORE)
      .getAll()
    request.onsuccess = () => resolve(request.result as StoredFont[])
    request.onerror = () =>
      reject(request.error ?? new Error('Could not read local fonts.'))
  })
  database.close()
  return fonts
}
