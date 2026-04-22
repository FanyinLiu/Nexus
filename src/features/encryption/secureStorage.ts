import { decryptText, encryptText } from './crypto.ts'
import { getEncryptionKey } from './keyManager.ts'

export async function secureSave<T>(key: string, value: T) {
  if (typeof window === 'undefined') {
    return
  }

  const encryptionKey = await getEncryptionKey()
  const payload = await encryptText(JSON.stringify(value), encryptionKey)
  window.localStorage.setItem(key, JSON.stringify(payload))
}

export async function secureLoad<T>(key: string, fallback: T): Promise<T> {
  if (typeof window === 'undefined') {
    return fallback
  }

  const raw = window.localStorage.getItem(key)
  if (!raw) {
    return fallback
  }

  try {
    const encryptionKey = await getEncryptionKey()
    const payload = JSON.parse(raw)
    const decoded = await decryptText(payload, encryptionKey)
    return JSON.parse(decoded) as T
  } catch {
    return fallback
  }
}
