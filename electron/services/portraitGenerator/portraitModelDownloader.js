/**
 * First-use downloader for the portrait models in `shared/portraitModels.js`.
 *
 * - Every hop (including redirects) goes through the shared model-download
 *   allowlist; the final file must match the catalog's byte size + SHA-256
 *   before it is moved into place.
 * - Interrupted downloads resume from `<file>.partial` with an HTTP Range
 *   request (the bytes already on disk are re-hashed first); a server that
 *   ignores Range restarts the file. Network errors, stalls and 5xx/429 are
 *   retried with backoff; a hash mismatch discards the partial file and
 *   retries once from zero.
 * - Errors are `PortraitModelDownloadError` with a stable `code` and never
 *   carry paths or URLs.
 * - Refuses to run while `PORTRAIT_MODEL_RELEASE.published` is false.
 */

import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'

import {
  PORTRAIT_MODEL_CATALOG,
  PORTRAIT_MODEL_RELEASE,
  describePortraitModel,
  selectPortraitModels,
} from '../../../shared/portraitModels.js'
import {
  resolveModelDownloadRedirect,
  validateModelDownloadUrl,
  validateModelIntegrity,
} from '../modelDownloadSecurity.js'
import { inspectLandmarkModels, rememberVerifiedModelFile, sha256File } from './landmarkModels.js'

export const PORTRAIT_MODEL_DOWNLOAD_ERRORS = Object.freeze({
  RELEASE_UNPUBLISHED: 'release_unpublished',
  HTTP_STATUS: 'http_status',
  NETWORK: 'network',
  STALLED: 'stalled',
  SIZE_MISMATCH: 'size_mismatch',
  HASH_MISMATCH: 'hash_mismatch',
  ABORTED: 'aborted',
  DISK: 'disk',
  UNSAFE_URL: 'unsafe_url',
})

const E = PORTRAIT_MODEL_DOWNLOAD_ERRORS
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const PROGRESS_STEP_BYTES = 1 << 20
const DISK_ERROR_CODES = new Set(['ENOSPC', 'EACCES', 'EPERM', 'EIO', 'EROFS', 'EDQUOT', 'EFBIG', 'EISDIR', 'ENOTDIR', 'ENOENT', 'EMFILE', 'ENFILE', 'EBADF'])

/** Download failure with a stable `code` (and optional numeric `status`). */
export class PortraitModelDownloadError extends Error {
  constructor(code, status = null) {
    super(`Portrait model download failed: ${code}`)
    this.name = 'PortraitModelDownloadError'
    this.code = code
    this.status = status
  }
}

const fail = (code, status) => new PortraitModelDownloadError(code, status)
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function fileSize(filePath) {
  try {
    return (await fs.stat(filePath)).size
  } catch {
    return 0
  }
}

function hashExisting(filePath, hash) {
  return new Promise((resolve, reject) => {
    createReadStream(filePath).on('error', reject).on('data', (chunk) => hash.update(chunk)).on('end', resolve)
  })
}

async function fetchFollowingRedirects(fetchImpl, url, headers, signal) {
  let current
  try {
    current = validateModelDownloadUrl(url).toString()
  } catch {
    throw fail(E.UNSAFE_URL)
  }
  for (let hop = 0; hop <= 5; hop += 1) {
    const response = await fetchImpl(current, { headers, redirect: 'manual', signal })
    if (!REDIRECT_STATUSES.has(response.status)) return response
    try {
      current = resolveModelDownloadRedirect(current, response.headers.get('location'))
    } catch {
      throw fail(E.UNSAFE_URL)
    } finally {
      await response.body?.cancel?.().catch(() => {})
    }
  }
  throw fail(E.HTTP_STATUS, 310)
}

/**
 * One attempt: resume or restart `<dest>.partial`, then verify and move it.
 * @returns {Promise<void>}
 */
async function attemptDownload(model, dest, context) {
  if (context.signal?.aborted) throw fail(E.ABORTED)
  const expected = validateModelIntegrity(model)
  const partial = `${dest}.partial`
  let offset = await fileSize(partial)
  if (offset >= expected.sizeBytes) {
    await fs.rm(partial, { force: true })
    offset = 0
  }
  let hash = createHash('sha256')
  if (offset > 0) await hashExisting(partial, hash)

  const stall = new AbortController()
  const onAbort = () => stall.abort()
  context.signal?.addEventListener('abort', onAbort, { once: true })
  let stalled = false
  let stallTimer = null
  let response
  const armStall = () => {
    clearTimeout(stallTimer)
    stallTimer = setTimeout(() => { stalled = true; stall.abort() }, context.stallMs)
  }

  try {
    // The signal may have changed while the existing partial file was hashed.
    if (context.signal?.aborted) throw fail(E.ABORTED)
    armStall()
    const headers = offset > 0 ? { Range: `bytes=${offset}-` } : {}
    response = await fetchFollowingRedirects(context.fetchImpl, model.url, headers, stall.signal)
    if (response.status === 200 && offset > 0) {
      offset = 0
      hash = createHash('sha256')
    } else if (response.status === 206) {
      const start = Number(/bytes (\d+)-/.exec(response.headers.get('content-range') ?? '')?.[1])
      if (start !== offset) {
        await fs.rm(partial, { force: true })
        throw fail(E.HTTP_STATUS, 206)
      }
    } else if (response.status === 416) {
      await fs.rm(partial, { force: true })
      throw fail(E.HTTP_STATUS, 416)
    } else if (response.status !== 200) {
      throw fail(E.HTTP_STATUS, response.status)
    }
    const remaining = expected.sizeBytes - offset
    const contentLength = Number(response.headers.get('content-length') ?? NaN)
    if (Number.isFinite(contentLength) && contentLength !== remaining) throw fail(E.SIZE_MISMATCH)

    let received = offset
    let reported = offset
    const out = createWriteStream(partial, { flags: offset > 0 ? 'a' : 'w' })
    // Pipeline observes asynchronous open/write/close errors even when every
    // chunk fits in the buffer, and waits for the file handle before rename.
    await pipeline(response.body, async function* (source) {
      for await (const chunk of source) {
        // Do not rely on the fetch implementation erroring the body on abort.
        if (stall.signal.aborted) throw new Error('aborted')
        armStall()
        received += chunk.length
        if (received > expected.sizeBytes) throw fail(E.SIZE_MISMATCH)
        hash.update(chunk)
        yield chunk
        if (received - reported >= PROGRESS_STEP_BYTES || received === expected.sizeBytes) {
          reported = received
          context.emit({ phase: 'downloading', modelId: model.id, receivedBytes: received, totalBytes: expected.sizeBytes })
        }
      }
    }, out, { signal: stall.signal })
    if (context.signal?.aborted) throw fail(E.ABORTED)
    if (received !== expected.sizeBytes) throw fail(E.NETWORK)
    context.emit({ phase: 'verifying', modelId: model.id })
    if (hash.digest('hex') !== expected.sha256) {
      await fs.rm(partial, { force: true })
      throw fail(E.HASH_MISMATCH)
    }
    try {
      await fs.rename(partial, dest)
      rememberVerifiedModelFile(dest, await fs.stat(dest), expected.sha256)
    } catch {
      throw fail(E.DISK)
    }
  } catch (error) {
    if (error instanceof PortraitModelDownloadError) throw error
    if (context.signal?.aborted) throw fail(E.ABORTED)
    if (stalled) throw fail(E.STALLED)
    if (DISK_ERROR_CODES.has(error?.code)) throw fail(E.DISK)
    throw fail(E.NETWORK)
  } finally {
    clearTimeout(stallTimer)
    context.signal?.removeEventListener('abort', onAbort)
    // Header/status failures never enter pipeline, which otherwise owns body cleanup.
    if (response && !response.bodyUsed) await response.body?.cancel?.().catch(() => {})
  }
}

function isRetryable(error, hashRetried) {
  if (error.code === E.NETWORK || error.code === E.STALLED) return true
  if (error.code === E.HASH_MISMATCH) return !hashRetried
  if (error.code === E.HTTP_STATUS) return error.status === 206 || error.status === 416 || error.status === 429 || error.status >= 500
  return false
}

async function alreadyInstalled(model, dest, hashFile) {
  try {
    const stat = await fs.stat(dest)
    if (stat.size !== model.sizeBytes) return false
    if ((await hashFile(dest)) !== model.sha256) return false
    rememberVerifiedModelFile(dest, stat, model.sha256)
    return true
  } catch {
    return false
  }
}

/**
 * Download (or resume) the portrait models into `directory`.
 * @param {{
 *   directory: string,
 *   models?: ReturnType<typeof selectPortraitModels>,
 *   release?: { published: boolean },
 *   fetchImpl?: typeof fetch,
 *   onProgress?: (event: object) => void,
 *   signal?: AbortSignal,
 *   maxAttempts?: number,
 *   backoffMs?: number[],
 *   stallMs?: number,
 *   sleep?: (ms: number) => Promise<void>,
 *   hashFile?: (filePath: string) => Promise<string>,
 * }} options
 * @returns {Promise<{ installed: string[], alreadyPresent: string[] }>}
 */
export async function downloadPortraitModels(options) {
  if (options.signal?.aborted) throw fail(E.ABORTED)
  const release = options.release ?? PORTRAIT_MODEL_RELEASE
  if (!release.published) throw fail(E.RELEASE_UNPUBLISHED)
  const models = options.models ?? selectPortraitModels()
  const maxAttempts = options.maxAttempts ?? 4
  const backoffMs = options.backoffMs ?? [1_000, 4_000, 10_000]
  const sleep = options.sleep ?? defaultSleep
  const hashFile = options.hashFile ?? sha256File
  const emit = (event) => {
    try { options.onProgress?.(event) } catch { /* progress listeners must not break the download */ }
  }
  const context = {
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
    signal: options.signal,
    stallMs: options.stallMs ?? 60_000,
    emit,
  }
  try {
    await fs.mkdir(options.directory, { recursive: true })
  } catch {
    throw fail(E.DISK)
  }

  const totalBytes = models.reduce((sum, model) => sum + model.sizeBytes, 0)
  emit({ phase: 'start', totalBytes, models: models.map((model) => model.id) })
  const installed = []
  const alreadyPresent = []
  for (const model of models) {
    if (options.signal?.aborted) throw fail(E.ABORTED)
    const dest = path.join(options.directory, model.fileName)
    const present = await alreadyInstalled(model, dest, hashFile)
    if (options.signal?.aborted) throw fail(E.ABORTED)
    if (present) {
      alreadyPresent.push(model.id)
      emit({ phase: 'installed', modelId: model.id })
      continue
    }
    let hashRetried = false
    for (let attempt = 1; ; attempt += 1) {
      try {
        await attemptDownload(model, dest, context)
        break
      } catch (error) {
        const retry = attempt < maxAttempts && !options.signal?.aborted && isRetryable(error, hashRetried)
        if (!retry) {
          emit({ phase: 'error', modelId: model.id, code: error.code })
          throw error
        }
        if (error.code === E.HASH_MISMATCH) hashRetried = true
        emit({ phase: 'retrying', modelId: model.id, attempt: attempt + 1, code: error.code })
        await sleep(backoffMs[Math.min(attempt - 1, backoffMs.length - 1)])
      }
    }
    installed.push(model.id)
    emit({ phase: 'installed', modelId: model.id })
  }
  emit({ phase: 'done' })
  return { installed, alreadyPresent }
}

/**
 * Verify install state before offering generation, so a same-size corrupt file
 * remains repairable from the download UI. Runtime and UI reuse the hash cache.
 * @param {{ directory: string, release?: { tag: string, published: boolean }, inspect?: typeof inspectLandmarkModels }} options
 */
export async function getPortraitModelStatus(options) {
  const release = options.release ?? PORTRAIT_MODEL_RELEASE
  const inspection = await (options.inspect ?? inspectLandmarkModels)(options.directory, {
    files: Object.fromEntries(PORTRAIT_MODEL_CATALOG.map((model) => [model.id, model])),
  })
  const models = []
  for (const model of PORTRAIT_MODEL_CATALOG) {
    const status = inspection.files[model.id]?.status ?? 'missing'
    const installed = status === 'ok' ? 'present' : status === 'missing' ? 'missing' : 'invalid'
    models.push({ ...describePortraitModel(model), installed })
  }
  const downloadBytes = models
    .filter((model) => model.wired && model.installed !== 'present')
    .reduce((sum, model) => sum + model.sizeBytes, 0)
  return { releaseTag: release.tag, releasePublished: release.published, downloadBytes, models }
}

/**
 * IPC-facing wrapper: never throws, reports a stable error code instead.
 * @param {Parameters<typeof downloadPortraitModels>[0]} options
 * @returns {Promise<{ ok: true, installed: string[], alreadyPresent: string[] } | { ok: false, code: string }>}
 */
export async function runPortraitModelDownload(options) {
  try {
    return { ok: true, ...(await downloadPortraitModels(options)) }
  } catch (error) {
    return { ok: false, code: error instanceof PortraitModelDownloadError ? error.code : E.NETWORK }
  }
}
