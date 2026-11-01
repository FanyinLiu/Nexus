// Verifies the detached Ed25519 signature on the electron-updater channel
// manifest before any update bytes are downloaded. Every failure mode returns
// `{ ok: false, reason }`; the caller must not download unless `ok === true`.
//
// The manifest is fetched from the same GitHub release tag electron-updater
// used, and parsed by a deliberately small reader: only version and file
// sha512 values matter, so unexpected YAML shapes fail closed instead of
// being interpreted.

import { createPublicKey, verify } from 'node:crypto'

import { UPDATE_SIGNING_PUBLIC_KEY_PEM } from './updateSigningKey.js'

/** Maximum accepted manifest size. Real channel files are a few KiB. */
export const UPDATE_MANIFEST_MAX_BYTES = 1024 * 1024

/** Maximum accepted base64 signature size. An Ed25519 signature is 88 chars. */
export const UPDATE_SIGNATURE_MAX_BYTES = 16 * 1024

/** Network deadline for each manifest download. */
export const UPDATE_MANIFEST_TIMEOUT_MS = 10_000

/** GitHub Releases asset root for the Nexus updater channel. */
export const UPDATE_MANIFEST_BASE_URL = 'https://github.com/FanyinLiu/Nexus/releases/download'

const RELEASE_TAG_PATTERN = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$/
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$/
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/

/**
 * Map the running platform/arch to the channel file electron-updater reads.
 * Windows has historically used `latest.yml` without an arch suffix; Linux
 * adds `-linux` for x64 and `-linux-<arch>` for other architectures.
 * @param {{ platform?: string, arch?: string }} [options]
 * @returns {string | null} Manifest filename, or null when out of scope.
 */
export function resolveUpdateManifestName({ platform = process.platform, arch = process.arch } = {}) {
  if (platform === 'win32') return 'latest.yml'
  if (platform !== 'linux') return null
  const normalizedArch = typeof arch === 'string' ? arch.trim() : ''
  if (!normalizedArch || normalizedArch === 'x64') return 'latest-linux.yml'
  if (!/^[0-9A-Za-z_]+$/.test(normalizedArch)) return null
  return `latest-linux-${normalizedArch}.yml`
}

/**
 * Convert bytes-like input to a Buffer without accepting arbitrary objects.
 * @param {unknown} value
 * @returns {Buffer | null}
 */
function toBuffer(value) {
  if (Buffer.isBuffer(value)) return value
  if (value instanceof Uint8Array) return Buffer.from(value)
  if (value instanceof ArrayBuffer) return Buffer.from(value)
  return null
}

/**
 * Parse a PEM/SPKI public key and require Ed25519.
 * @param {unknown} publicKeyPem
 * @returns {import('node:crypto').KeyObject | null}
 */
function loadEd25519PublicKey(publicKeyPem) {
  if (typeof publicKeyPem !== 'string') return null
  const text = publicKeyPem.trim()
  if (!text || !text.includes('-----BEGIN PUBLIC KEY-----')) return null
  if (/PLACEHOLDER|YOUR_|REPLACE_|BEGIN PRIVATE KEY/i.test(text)) return null
  try {
    const key = createPublicKey({ key: text, format: 'pem' })
    return key.asymmetricKeyType === 'ed25519' ? key : null
  } catch {
    return null
  }
}

/**
 * Decode the single-line base64 signature file. Ed25519 signatures are
 * exactly 64 bytes, so any other length is rejected before verification.
 * @param {unknown} signatureBase64
 * @returns {Buffer | null}
 */
function decodeSignature(signatureBase64) {
  if (typeof signatureBase64 !== 'string') return null
  const text = signatureBase64.trim()
  if (!text || text.length % 4 !== 0 || !BASE64_PATTERN.test(text)) return null
  const signature = Buffer.from(text, 'base64')
  return signature.byteLength === 64 ? signature : null
}

/**
 * Verify a detached Ed25519 signature over raw manifest bytes.
 * @param {{
 *   manifestBytes: Buffer | Uint8Array | ArrayBuffer,
 *   signatureBase64: string,
 *   publicKeyPem?: unknown,
 * }} input
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function verifyDetachedManifestSignature({
  manifestBytes,
  signatureBase64,
  publicKeyPem = UPDATE_SIGNING_PUBLIC_KEY_PEM,
} = /** @type {any} */ ({})) {
  const bytes = toBuffer(manifestBytes)
  if (!bytes || bytes.byteLength === 0) return { ok: false, reason: 'empty-manifest' }
  const key = loadEd25519PublicKey(publicKeyPem)
  if (!key) return { ok: false, reason: 'invalid-public-key' }
  const signature = decodeSignature(signatureBase64)
  if (!signature) return { ok: false, reason: 'invalid-signature' }
  try {
    if (verify(null, bytes, key, signature) !== true) return { ok: false, reason: 'signature-mismatch' }
  } catch {
    return { ok: false, reason: 'signature-mismatch' }
  }
  return { ok: true }
}

/**
 * Split `key: value` while preserving any additional colons in the value.
 * @param {string} content
 * @returns {{ key: string, value: string | null } | null}
 */
function parseKeyLine(content) {
  const match = /^([A-Za-z][0-9A-Za-z_-]*):(.*)$/.exec(content)
  if (!match) return null
  const rawValue = match[2].trim()
  if (!rawValue) return { key: match[1], value: null }
  if (rawValue.startsWith("'")) {
    if (rawValue.length < 2 || !rawValue.endsWith("'")) return null
    return { key: match[1], value: rawValue.slice(1, -1).replace(/''/g, "'") }
  }
  if (rawValue.startsWith('"')) {
    if (rawValue.length < 2 || !rawValue.endsWith('"')) return null
    try {
      const parsed = JSON.parse(rawValue)
      return typeof parsed === 'string' ? { key: match[1], value: parsed } : null
    } catch {
      return null
    }
  }
  return { key: match[1], value: rawValue }
}

/**
 * Read only the fields the signature check needs. Unknown top-level blocks
 * (for example `releaseNotes: |`) are ignored; unknown shapes under `files`
 * still fail closed.
 * @param {string} text
 * @returns {{
 *   version: string | null,
 *   path: string | null,
 *   sha512: string | null,
 *   files: Array<{ url: string | null, sha512: string | null }>,
 * } | null}
 */
export function parseUpdateManifest(text) {
  if (typeof text !== 'string' || !text.trim()) return null
  const manifest = {
    version: /** @type {string | null} */ (null),
    path: /** @type {string | null} */ (null),
    sha512: /** @type {string | null} */ (null),
    files: /** @type {Array<{ url: string | null, sha512: string | null }>} */ ([]),
  }
  const seen = new Set()
  let inFiles = false
  let currentFile = null

  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.trim()) continue
    if (rawLine.trimStart().startsWith('#')) continue
    if (rawLine.includes('\t')) return null
    const indent = rawLine.length - rawLine.trimStart().length
    const content = rawLine.trim()

    if (indent === 0) {
      inFiles = false
      currentFile = null
      const parsed = parseKeyLine(content)
      if (!parsed) return null
      if (parsed.key === 'files') {
        if (seen.has('files')) return null
        seen.add('files')
        if (parsed.value === null) {
          inFiles = true
          continue
        }
        if (parsed.value === '[]') continue
        return null
      }
      if (parsed.key !== 'version' && parsed.key !== 'path' && parsed.key !== 'sha512') continue
      if (seen.has(parsed.key) || parsed.value === null) return null
      seen.add(parsed.key)
      if (parsed.key === 'version') manifest.version = parsed.value
      else if (parsed.key === 'path') manifest.path = parsed.value
      else manifest.sha512 = parsed.value
      continue
    }

    if (!inFiles) continue
    if (content.startsWith('-')) {
      if (indent < 2) return null
      currentFile = { url: null, sha512: null }
      manifest.files.push(currentFile)
      const rest = content.slice(1).trim()
      if (!rest) continue
      const parsed = parseKeyLine(rest)
      if (!parsed || parsed.value === null) return null
      if (parsed.key === 'url' || parsed.key === 'sha512') currentFile[parsed.key] = parsed.value
      continue
    }

    if (!currentFile) return null
    const parsed = parseKeyLine(content)
    if (!parsed) return null
    if (parsed.key !== 'url' && parsed.key !== 'sha512') continue
    if (parsed.value === null) return null
    currentFile[parsed.key] = parsed.value
  }

  return manifest
}

/**
 * @param {unknown} response
 * @returns {number | null}
 */
function readContentLength(response) {
  const headers = response && typeof response === 'object'
    ? /** @type {{ get?: (name: string) => unknown }} */ (response).headers
    : null
  if (!headers || typeof headers.get !== 'function') return null
  const raw = headers.get('content-length')
  if (typeof raw !== 'string' || !raw.trim()) return null
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : null
}

/**
 * Download a bounded asset over HTTPS. Any transport, HTTP, or size problem
 * is converted to a stable reason instead of throwing.
 * @param {string} url
 * @param {{
 *   fetchImpl: (url: string, init: { signal: AbortSignal }) => Promise<any>,
 *   timeoutMs: number,
 *   maxBytes: number,
 *   notFoundReason: string,
 * }} options
 * @returns {Promise<{ ok: true, bytes: Buffer } | { ok: false, reason: string }>}
 */
async function fetchBounded(url, { fetchImpl, timeoutMs, maxBytes, notFoundReason }) {
  if (typeof fetchImpl !== 'function') return { ok: false, reason: 'missing-fetch' }
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, { signal: controller.signal })
    if (!response || typeof response !== 'object') return { ok: false, reason: 'invalid-response' }
    if (typeof response.url === 'string' && response.url && !/^https:\/\//.test(response.url)) {
      return { ok: false, reason: 'insecure-final-url' }
    }
    if (response.ok !== true) {
      return { ok: false, reason: response.status === 404 ? notFoundReason : 'http-error' }
    }
    const declaredLength = readContentLength(response)
    if (declaredLength !== null && declaredLength > maxBytes) {
      return { ok: false, reason: 'response-too-large' }
    }
    if (typeof response.arrayBuffer !== 'function') return { ok: false, reason: 'invalid-response' }
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.byteLength === 0) return { ok: false, reason: 'empty-response' }
    if (bytes.byteLength > maxBytes) return { ok: false, reason: 'response-too-large' }
    return { ok: true, bytes }
  } catch {
    return { ok: false, reason: 'fetch-failed' }
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * @param {unknown} updateInfo
 * @returns {string[] | null} Null when any advertised file lacks a digest.
 */
function collectExpectedSha512(updateInfo) {
  if (!updateInfo || typeof updateInfo !== 'object') return null
  const info = /** @type {{ files?: unknown, sha512?: unknown }} */ (updateInfo)
  const digests = []
  if (Array.isArray(info.files)) {
    for (const file of info.files) {
      const digest = file && typeof file === 'object'
        ? /** @type {{ sha512?: unknown }} */ (file).sha512
        : null
      if (typeof digest !== 'string' || !digest.trim()) return null
      digests.push(digest.trim())
    }
  } else if (info.files !== undefined) {
    return null
  }
  if (typeof info.sha512 === 'string' && info.sha512.trim()) {
    digests.push(info.sha512.trim())
  } else if (info.sha512 !== undefined) {
    return null
  }
  return [...new Set(digests)]
}

/**
 * @param {ReturnType<typeof parseUpdateManifest>} manifest
 * @returns {Set<string>}
 */
function collectSignedSha512(manifest) {
  const digests = new Set()
  if (manifest && typeof manifest.sha512 === 'string' && manifest.sha512.trim()) {
    digests.add(manifest.sha512.trim())
  }
  for (const file of manifest?.files ?? []) {
    if (typeof file.sha512 === 'string' && file.sha512.trim()) digests.add(file.sha512.trim())
  }
  return digests
}

/**
 * @param {unknown} updateInfo
 * @param {unknown} tag
 * @returns {string | null}
 */
function resolveReleaseTag(updateInfo, tag) {
  const explicit = typeof tag === 'string' ? tag.trim() : ''
  const reported = updateInfo && typeof updateInfo === 'object'
    ? /** @type {{ tag?: unknown }} */ (updateInfo).tag
    : null
  const fromInfo = typeof reported === 'string' ? reported.trim() : ''
  const candidate = explicit || fromInfo
  if (candidate) return RELEASE_TAG_PATTERN.test(candidate) ? candidate : null
  const version = updateInfo && typeof updateInfo === 'object'
    ? /** @type {{ version?: unknown }} */ (updateInfo).version
    : null
  if (typeof version !== 'string') return null
  const trimmed = version.trim()
  if (!VERSION_PATTERN.test(trimmed)) return null
  const derived = `v${trimmed}`
  return RELEASE_TAG_PATTERN.test(derived) ? derived : null
}

/**
 * Verify the signed channel manifest for an update electron-updater is about
 * to download. Fails closed on every unexpected input or network condition.
 * @param {{
 *   updateInfo?: { version?: unknown, tag?: unknown, files?: unknown, sha512?: unknown } | null,
 *   tag?: string | null,
 *   platform?: string,
 *   arch?: string,
 *   publicKeyPem?: unknown,
 *   fetchImpl?: ((url: string, init: { signal: AbortSignal }) => Promise<any>) | null,
 *   baseUrl?: string,
 *   timeoutMs?: number,
 *   maxBytes?: number,
 * }} [input]
 * @returns {Promise<
 *   { ok: true, version: string, manifestName: string } |
 *   { ok: false, reason: string }
 * >}
 */
export async function verifyUpdateManifestSignature({
  updateInfo = null,
  tag = null,
  platform = process.platform,
  arch = process.arch,
  publicKeyPem = UPDATE_SIGNING_PUBLIC_KEY_PEM,
  fetchImpl = typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null,
  baseUrl = UPDATE_MANIFEST_BASE_URL,
  timeoutMs = UPDATE_MANIFEST_TIMEOUT_MS,
  maxBytes = UPDATE_MANIFEST_MAX_BYTES,
} = {}) {
  if (!loadEd25519PublicKey(publicKeyPem)) return { ok: false, reason: 'invalid-public-key' }
  const version = updateInfo && typeof updateInfo.version === 'string' ? updateInfo.version.trim() : ''
  if (!version || !VERSION_PATTERN.test(version)) return { ok: false, reason: 'invalid-version' }
  const manifestName = resolveUpdateManifestName({ platform, arch })
  if (!manifestName) return { ok: false, reason: 'unsupported-platform' }
  const releaseTag = resolveReleaseTag(updateInfo, tag)
  if (!releaseTag) return { ok: false, reason: 'invalid-release-tag' }
  if (typeof baseUrl !== 'string' || !/^https:\/\//.test(baseUrl)) {
    return { ok: false, reason: 'invalid-base-url' }
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return { ok: false, reason: 'invalid-timeout' }
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) return { ok: false, reason: 'invalid-size-limit' }

  const manifestUrl = `${baseUrl.replace(/\/+$/u, '')}/${encodeURIComponent(releaseTag)}/${encodeURIComponent(manifestName)}`
  const manifestResponse = await fetchBounded(manifestUrl, {
    fetchImpl,
    timeoutMs,
    maxBytes,
    notFoundReason: 'manifest-unavailable',
  })
  if (!manifestResponse.ok) return manifestResponse

  const signatureResponse = await fetchBounded(`${manifestUrl}.sig`, {
    fetchImpl,
    timeoutMs,
    maxBytes: UPDATE_SIGNATURE_MAX_BYTES,
    notFoundReason: 'missing-signature',
  })
  if (!signatureResponse.ok) return signatureResponse

  const signatureCheck = verifyDetachedManifestSignature({
    manifestBytes: manifestResponse.bytes,
    signatureBase64: signatureResponse.bytes.toString('utf8'),
    publicKeyPem,
  })
  if (!signatureCheck.ok) return signatureCheck

  const manifest = parseUpdateManifest(manifestResponse.bytes.toString('utf8'))
  if (!manifest) return { ok: false, reason: 'manifest-parse-failed' }
  if (!manifest.version) return { ok: false, reason: 'manifest-missing-version' }
  if (manifest.version.trim() !== version) return { ok: false, reason: 'version-mismatch' }

  const expectedDigests = collectExpectedSha512(updateInfo)
  if (!expectedDigests || expectedDigests.length === 0) return { ok: false, reason: 'missing-sha512' }
  const signedDigests = collectSignedSha512(manifest)
  if (signedDigests.size === 0) return { ok: false, reason: 'manifest-missing-sha512' }
  if (expectedDigests.some((digest) => !signedDigests.has(digest))) {
    return { ok: false, reason: 'sha512-mismatch' }
  }

  return { ok: true, version: manifest.version.trim(), manifestName }
}
