import { posix } from 'node:path'

const EXACT_ALLOWED_HOSTS = new Set([
  'github.com',
  'huggingface.co',
  'modelscope.cn',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'www.modelscope.cn',
])

const ALLOWED_HOST_SUFFIXES = [
  '.hf.co',
  '.oss-cn-beijing.aliyuncs.com',
]

function isAllowedHost(hostname) {
  return EXACT_ALLOWED_HOSTS.has(hostname)
    || ALLOWED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
}

export function validateModelDownloadUrl(value) {
  let parsed
  try {
    parsed = new URL(String(value ?? ''))
  } catch {
    throw new Error('Model download URL is invalid')
  }

  if (parsed.protocol !== 'https:') throw new Error('Model downloads require HTTPS')
  if (parsed.username || parsed.password) throw new Error('Model download URL must not contain credentials')
  if (parsed.port && parsed.port !== '443') throw new Error('Model download URL uses an untrusted port')
  if (!isAllowedHost(parsed.hostname)) throw new Error('Model download host is not allowlisted')
  return parsed
}

export function resolveModelDownloadRedirect(currentUrl, location) {
  const next = new URL(String(location ?? ''), validateModelDownloadUrl(currentUrl))
  return validateModelDownloadUrl(next).toString()
}

export function validateModelIntegrity(integrity) {
  const sizeBytes = Number(integrity?.sizeBytes)
  const sha256 = String(integrity?.sha256 ?? '').toLowerCase()
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
    throw new Error('Model integrity metadata has an invalid size')
  }
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error('Model integrity metadata has an invalid SHA-256')
  }
  return { sizeBytes, sha256 }
}

function normalizeArchiveEntry(entry) {
  const raw = String(entry ?? '').replaceAll('\\', '/').replace(/^\.\/+/, '')
  if (!raw || raw.includes('\0')) throw new Error('Model archive contains an invalid entry')
  if (raw.startsWith('/') || /^[a-zA-Z]:\//.test(raw)) {
    throw new Error('Model archive contains an absolute path')
  }
  const normalized = posix.normalize(raw)
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new Error('Model archive attempts path traversal')
  }
  return normalized
}

export function validateModelArchiveListing(entries, verboseLines, expectedDirectory) {
  const expected = String(expectedDirectory ?? '').trim()
  if (!expected || expected.includes('/') || expected.includes('\\')) {
    throw new Error('Model archive expected directory is invalid')
  }
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('Model archive is empty')
  }

  for (const entry of entries) {
    const normalized = normalizeArchiveEntry(entry)
    if (normalized.split('/')[0] !== expected) {
      throw new Error('Model archive contains files outside its expected directory')
    }
  }

  for (const line of verboseLines ?? []) {
    const type = String(line ?? '').trimStart()[0]
    if (type === 'l' || type === 'h') {
      throw new Error('Model archive contains links')
    }
  }
}
