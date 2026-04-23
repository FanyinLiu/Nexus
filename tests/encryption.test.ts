import { webcrypto } from 'node:crypto'
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

if (!globalThis.crypto) globalThis.crypto = webcrypto as unknown as Crypto

import { createEncryptionKey, encryptText, decryptText } from '../src/features/encryption/crypto.ts'
import {
  getEncryptionKey,
  setEncryptionKey,
  clearEncryptionKey,
} from '../src/features/encryption/keyManager.ts'

describe('crypto', () => {
  it('createEncryptionKey returns a CryptoKey', async () => {
    const key = await createEncryptionKey()
    assert.equal(key.constructor.name, 'CryptoKey')
    assert.equal(key.algorithm.name, 'AES-GCM')
    assert.deepEqual(key.usages, ['encrypt', 'decrypt'])
  })

  it('encryptText produces a non-empty payload', async () => {
    const key = await createEncryptionKey()
    const payload = await encryptText('hello', key)

    assert.equal(payload.version, 1)
    assert.equal(payload.algorithm, 'AES-GCM')
    assert.ok(payload.iv.length > 0)
    assert.ok(payload.ciphertext.length > 0)
  })

  it('decryptText round-trips correctly', async () => {
    const key = await createEncryptionKey()
    const original = 'round-trip test 🚀'
    const payload = await encryptText(original, key)
    const result = await decryptText(payload, key)

    assert.equal(result, original)
  })

  it('decryptText with wrong key throws', async () => {
    const key1 = await createEncryptionKey()
    const key2 = await createEncryptionKey()
    const payload = await encryptText('secret', key1)

    await assert.rejects(() => decryptText(payload, key2))
  })
})

describe('keyManager', () => {
  beforeEach(() => {
    clearEncryptionKey()
  })

  it('getEncryptionKey returns a CryptoKey', async () => {
    const key = await getEncryptionKey()
    assert.equal(key.constructor.name, 'CryptoKey')
  })

  it('setEncryptionKey stores and getEncryptionKey retrieves it', async () => {
    const key = await createEncryptionKey()
    setEncryptionKey(key)
    const retrieved = await getEncryptionKey()

    assert.equal(retrieved, key)
  })

  it('clearEncryptionKey resets state so a new key is generated', async () => {
    const key1 = await getEncryptionKey()
    clearEncryptionKey()
    const key2 = await getEncryptionKey()

    assert.notEqual(key1, key2)
  })
})
