import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  parseSignUpdateManifestArgs,
  readSigningKeyFromEnv,
  signManifestBytes,
  signManifestFile,
  UPDATE_SIGNING_KEY_ENV,
  verifyManifestFile,
} from '../scripts/sign-update-manifest.mjs'
import {
  resolveUpdateManifestName,
  verifyUpdateManifestSignature,
} from '../electron/services/updateManifestSignature.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASE_URL = 'https://github.com/FanyinLiu/Nexus/releases/download'

function createKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  }
}

function manifestText({ version = '0.4.8', sha512, url = 'Nexus Setup 0.4.8.exe' } = {}) {
  const digest = sha512 ?? createHash('sha512').update(`${url}:${version}`).digest('base64')
  return [
    `version: ${version}`,
    'files:',
    `  - url: ${JSON.stringify(url)}`,
    `    sha512: ${digest}`,
    '    size: 128',
    `path: ${JSON.stringify(url)}`,
    `sha512: ${digest}`,
    "releaseDate: '2026-10-30T00:00:00.000Z'",
    '',
  ].join('\n')
}

function updateInfoFor(manifest) {
  const digest = /^ {4}sha512: (.+)$/m.exec(manifest)?.[1] ?? ''
  return {
    version: /^version: (.+)$/m.exec(manifest)?.[1] ?? '0.4.8',
    tag: 'v0.4.8',
    files: [{ url: 'Nexus Setup 0.4.8.exe', sha512: digest }],
    sha512: digest,
  }
}

function signatureOf(manifest, privateKeyPem) {
  return signManifestBytes(Buffer.from(manifest, 'utf8'), privateKeyPem)
}

function fakeResponse(status, body) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body ?? '')
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name) => (String(name).toLowerCase() === 'content-length' ? String(bytes.byteLength) : null),
    },
    arrayBuffer: async () => Uint8Array.from(bytes).buffer,
  }
}

function fakeFetch(responses) {
  const calls = []
  return {
    calls,
    fetchImpl: async (url) => {
      calls.push(url)
      const entry = responses[url]
      if (entry === undefined) return fakeResponse(404, '')
      if (entry instanceof Error) throw entry
      if (typeof entry === 'function') return entry()
      return fakeResponse(200, entry)
    },
  }
}

function manifestUrl(manifestName, tag = 'v0.4.8') {
  return `${BASE_URL}/${tag}/${manifestName}`
}

function baseInput(overrides = {}) {
  const keys = createKeyPair()
  const manifest = manifestText()
  const signature = signatureOf(manifest, keys.privateKeyPem)
  const manifestName = 'latest.yml'
  const url = manifestUrl(manifestName)
  const fetch = fakeFetch({ [url]: manifest, [`${url}.sig`]: `${signature}\n` })
  return {
    keys,
    manifest,
    signature,
    url,
    updateInfo: updateInfoFor(manifest),
    input: {
      updateInfo: updateInfoFor(manifest),
      tag: 'v0.4.8',
      platform: 'win32',
      arch: 'x64',
      publicKeyPem: keys.publicKeyPem,
      fetchImpl: fetch.fetchImpl,
      ...overrides,
    },
    fetch,
  }
}

test('a valid detached signature over the exact manifest bytes passes', async () => {
  const base = baseInput()
  const result = await verifyUpdateManifestSignature(base.input)

  assert.deepEqual(result, { ok: true, version: '0.4.8', manifestName: 'latest.yml' })
  assert.deepEqual(base.fetch.calls, [base.url, `${base.url}.sig`])
})

test('a tampered manifest fails even when the original signature is present', async () => {
  const base = baseInput()
  const tampered = base.manifest.replace('size: 128', 'size: 129')
  const fetch = fakeFetch({ [base.url]: tampered, [`${base.url}.sig`]: base.signature })

  const result = await verifyUpdateManifestSignature({ ...base.input, fetchImpl: fetch.fetchImpl })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'signature-mismatch')
})

test('a missing signature file fails closed', async () => {
  const base = baseInput()
  const fetch = fakeFetch({ [base.url]: base.manifest })

  const result = await verifyUpdateManifestSignature({ ...base.input, fetchImpl: fetch.fetchImpl })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'missing-signature')
})

test('a signature made with a different key fails closed', async () => {
  const base = baseInput()
  const otherKeys = createKeyPair()
  const fetch = fakeFetch({
    [base.url]: base.manifest,
    [`${base.url}.sig`]: signatureOf(base.manifest, otherKeys.privateKeyPem),
  })

  const result = await verifyUpdateManifestSignature({ ...base.input, fetchImpl: fetch.fetchImpl })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'signature-mismatch')
})

test('a signed manifest for another version fails closed', async () => {
  const base = baseInput()
  const input = {
    ...base.input,
    updateInfo: { ...base.input.updateInfo, version: '0.4.9' },
  }

  const result = await verifyUpdateManifestSignature(input)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'version-mismatch')
})

test('an UpdateInfo sha512 that the signed manifest does not list fails closed', async () => {
  const base = baseInput()
  const wrongDigest = createHash('sha512').update('different payload').digest('base64')
  const input = {
    ...base.input,
    updateInfo: { ...base.input.updateInfo, files: [{ url: 'Nexus Setup 0.4.8.exe', sha512: wrongDigest }] },
  }

  const result = await verifyUpdateManifestSignature(input)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'sha512-mismatch')
})

test('missing UpdateInfo sha512 data fails closed instead of skipping the binding check', async () => {
  const base = baseInput()

  const empty = await verifyUpdateManifestSignature({
    ...base.input,
    updateInfo: { version: '0.4.8', tag: 'v0.4.8', files: [] },
  })
  assert.equal(empty.ok, false)
  assert.equal(empty.reason, 'missing-sha512')

  const missingFileDigest = await verifyUpdateManifestSignature({
    ...base.input,
    updateInfo: {
      version: '0.4.8',
      tag: 'v0.4.8',
      files: [{ url: 'Nexus Setup 0.4.8.exe' }],
      sha512: base.input.updateInfo.sha512,
    },
  })
  assert.equal(missingFileDigest.ok, false)
  assert.equal(missingFileDigest.reason, 'missing-sha512')
})

test('network errors, timeouts, and oversized responses fail closed', async () => {
  const base = baseInput()

  const failingFetch = async () => {
    throw new Error('network down')
  }
  const failed = await verifyUpdateManifestSignature({ ...base.input, fetchImpl: failingFetch })
  assert.equal(failed.ok, false)
  assert.equal(failed.reason, 'fetch-failed')

  const hangingFetch = (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('aborted')))
  })
  const timedOut = await verifyUpdateManifestSignature({ ...base.input, fetchImpl: hangingFetch, timeoutMs: 10 })
  assert.equal(timedOut.ok, false)
  assert.equal(timedOut.reason, 'fetch-failed')

  const oversized = await verifyUpdateManifestSignature({ ...base.input, maxBytes: 16 })
  assert.equal(oversized.ok, false)
  assert.equal(oversized.reason, 'response-too-large')

  const insecure = await verifyUpdateManifestSignature({
    ...base.input,
    fetchImpl: async () => ({
      ...fakeResponse(200, base.manifest),
      url: 'http://example.com/latest.yml',
    }),
  })
  assert.equal(insecure.ok, false)
  assert.equal(insecure.reason, 'insecure-final-url')
})

test('empty, placeholder, and non-Ed25519 public keys fail before any fetch', async () => {
  const base = baseInput()
  for (const publicKeyPem of ['', 'YOUR_PUBLIC_KEY_HERE', '-----BEGIN PUBLIC KEY-----\nnot-a-key\n-----END PUBLIC KEY-----']) {
    const fetch = fakeFetch({})
    const result = await verifyUpdateManifestSignature({
      ...base.input,
      publicKeyPem,
      fetchImpl: fetch.fetchImpl,
    })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'invalid-public-key')
    assert.deepEqual(fetch.calls, [])
  }
})

test('the Linux manifest name follows electron-updater arch suffixes', () => {
  assert.equal(resolveUpdateManifestName({ platform: 'win32', arch: 'x64' }), 'latest.yml')
  assert.equal(resolveUpdateManifestName({ platform: 'linux', arch: 'x64' }), 'latest-linux.yml')
  assert.equal(resolveUpdateManifestName({ platform: 'linux', arch: 'arm64' }), 'latest-linux-arm64.yml')
  assert.equal(resolveUpdateManifestName({ platform: 'darwin', arch: 'arm64' }), null)
})

test('an invalid release tag is rejected before any fetch', async () => {
  const base = baseInput()
  const fetch = fakeFetch({})
  const result = await verifyUpdateManifestSignature({
    ...base.input,
    updateInfo: { ...base.input.updateInfo, tag: 'v0.4.8/../../evil' },
    tag: 'v0.4.8/../../evil',
    fetchImpl: fetch.fetchImpl,
  })

  assert.equal(result.ok, false)
  assert.equal(result.reason, 'invalid-release-tag')
  assert.deepEqual(fetch.calls, [])
})

test('the sign script round-trips raw manifest bytes and refuses an empty secret', () => {
  const keys = createKeyPair()
  const manifest = manifestText()
  const signature = signManifestBytes(Buffer.from(manifest, 'utf8'), keys.privateKeyPem)
  assert.equal(Buffer.from(signature, 'base64').byteLength, 64)

  assert.throws(
    () => readSigningKeyFromEnv({}),
    /NEXUS_UPDATE_SIGNING_KEY is missing or empty/,
  )
  assert.deepEqual(parseSignUpdateManifestArgs(['--verify', 'release/latest.yml']), {
    verify: true,
    manifests: ['release/latest.yml'],
  })
  assert.throws(() => parseSignUpdateManifestArgs([]), /at least one manifest path/)

  const directory = mkdtempSync(join(tmpdir(), 'nexus-update-sign-'))
  try {
    const manifestPath = join(directory, 'latest.yml')
    writeFileSync(manifestPath, manifest)
    const signingKey = readSigningKeyFromEnv({ [UPDATE_SIGNING_KEY_ENV]: keys.privateKeyPem })
    const signed = signManifestFile(manifestPath, signingKey)
    assert.equal(signed.signature, signature)
    assert.deepEqual(verifyManifestFile(manifestPath, keys.publicKeyPem), { ok: true })

    writeFileSync(manifestPath, `${manifest}tampered\n`)
    assert.equal(verifyManifestFile(manifestPath, keys.publicKeyPem).ok, false)

    rmSync(`${manifestPath}.sig`)
    assert.deepEqual(verifyManifestFile(manifestPath, keys.publicKeyPem), {
      ok: false,
      reason: 'missing-signature',
    })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }

  assert.equal(readFileSync(join(ROOT, 'electron/services/updateSigningKey.js'), 'utf8').includes(
    'MCowBQYDK2VwAyEAMgtx3YDuBlFTDZeghX/XptItmIkPR5ZAv7Z6mkrNXds=',
  ), true)
})
