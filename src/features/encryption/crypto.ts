import type { EncryptedPayload } from './types.ts'

const TEXT_ENCODER = new TextEncoder()
const TEXT_DECODER = new TextDecoder()

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''

  bytes.forEach((value) => {
    binary += String.fromCharCode(value)
  })

  return btoa(binary)
}

function base64ToBytes(base64: string) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}

export async function createEncryptionKey() {
  return crypto.subtle.generateKey(
    {
      name: 'AES-GCM',
      length: 256,
    },
    true,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptText(text: string, key: CryptoKey): Promise<EncryptedPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = TEXT_ENCODER.encode(text)
  const encrypted = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
    },
    key,
    encoded,
  )

  return {
    version: 1,
    algorithm: 'AES-GCM',
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
  }
}

export async function decryptText(payload: EncryptedPayload, key: CryptoKey) {
  const decrypted = await crypto.subtle.decrypt(
    {
      name: payload.algorithm,
      iv: base64ToBytes(payload.iv),
    },
    key,
    base64ToBytes(payload.ciphertext),
  )

  return TEXT_DECODER.decode(decrypted)
}
