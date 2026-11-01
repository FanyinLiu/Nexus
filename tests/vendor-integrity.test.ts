import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  assertCubismCoreContents,
  assertCubismCoreFile,
  checkCubismCoreContents,
  checkCubismCoreFile,
  CUBISM_CORE_SHA256,
  sha256Contents,
  VendorIntegrityError,
} from '../scripts/lib/vendorIntegrity.mjs'

test('Cubism Core pin is a full lowercase SHA-256', () => {
  assert.match(CUBISM_CORE_SHA256, /^[a-f0-9]{64}$/)
})

test('matching contents pass verification', () => {
  const contents = Buffer.from('verified cubism core bytes')
  const expected = sha256Contents(contents)

  const result = checkCubismCoreContents(contents, expected)
  assert.equal(result.ok, true)
  assert.equal(result.actualSha256, expected)
  assert.deepEqual(assertCubismCoreContents(contents, 'live2dcubismcore.min.js', expected), {
    ok: true,
    actualSha256: expected,
    expectedSha256: expected,
  })
})

test('mismatched contents fail closed with the expected and actual hashes', () => {
  const result = checkCubismCoreContents(Buffer.from('tampered'), CUBISM_CORE_SHA256)
  assert.equal(result.ok, false)
  assert.notEqual(result.actualSha256, CUBISM_CORE_SHA256)

  assert.throws(
    () => assertCubismCoreContents(Buffer.from('tampered'), 'live2dcubismcore.min.js'),
    (error: unknown) => {
      assert.ok(error instanceof VendorIntegrityError)
      assert.equal(error.actualSha256, result.actualSha256)
      assert.match(error.message, /SHA-256 mismatch/)
      assert.match(error.message, /update CUBISM_CORE_SHA256/)
      return true
    },
  )
})

test('existing files are verified and a mismatched existing file is rejected', () => {
  const directory = mkdtempSync(join(tmpdir(), 'nexus-vendor-integrity-'))
  const filePath = join(directory, 'live2dcubismcore.min.js')
  try {
    const contents = Buffer.from('local cubism core copy')
    writeFileSync(filePath, contents)
    const expected = sha256Contents(contents)

    const matching = checkCubismCoreFile(filePath, expected)
    assert.equal(matching.ok, true)
    assert.equal(matching.sizeBytes, contents.byteLength)
    assert.equal(assertCubismCoreFile(filePath, 'live2dcubismcore.min.js', expected).ok, true)

    writeFileSync(filePath, Buffer.from('different local copy'))
    const mismatched = checkCubismCoreFile(filePath, expected)
    assert.equal(mismatched.ok, false)
    assert.throws(
      () => assertCubismCoreFile(filePath, 'live2dcubismcore.min.js', expected),
      VendorIntegrityError,
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
