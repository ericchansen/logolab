import { validateDesign } from './design'
import type { DesignDocument, PersistedDesign, StoredFont } from './types'

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

export type SaveDesignResult =
  | { ok: true }
  | { ok: false; error: Error }

function storageError(caught: unknown): Error {
  if (caught instanceof Error) {
    return caught
  }
  const error = new Error(
    typeof caught === 'object' &&
      caught !== null &&
      'message' in caught &&
      typeof caught.message === 'string'
      ? caught.message
      : 'Could not save the design.',
  )
  if (
    typeof caught === 'object' &&
    caught !== null &&
    'name' in caught &&
    typeof caught.name === 'string'
  ) {
    error.name = caught.name
  }
  return error
}

export function trySaveDesign(
  design: DesignDocument,
  storage?: Storage,
): SaveDesignResult {
  try {
    saveDesign(design, storage ?? localStorage)
    return { ok: true }
  } catch (caught) {
    return {
      ok: false,
      error: storageError(caught),
    }
  }
}

export function loadDesign(
  fontId: string,
  text: string,
  storage?: Storage,
): PersistedDesign | null {
  let target: Storage
  let serialized: string | null
  try {
    target = storage ?? localStorage
    serialized = target.getItem(designStorageKey(fontId, text))
  } catch {
    return null
  }
  if (!serialized) {
    return null
  }

  try {
    return validateDesign(JSON.parse(serialized))
  } catch {
    try {
      target.removeItem(designStorageKey(fontId, text))
    } catch {
      return null
    }
    return null
  }
}

export function removeDesignsForFont(
  fontId: string,
  storage: Storage = localStorage,
): void {
  const prefix = `${DESIGN_PREFIX}${encodeURIComponent(fontId)}:`
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
  for (const key of keys) {
    if (key?.startsWith(prefix)) {
      storage.removeItem(key)
    }
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

export async function deleteStoredFont(id: string): Promise<void> {
  const database = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(FONT_STORE, 'readwrite')
    transaction.objectStore(FONT_STORE).delete(id)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Could not remove the local font.'))
  })
  database.close()
}
