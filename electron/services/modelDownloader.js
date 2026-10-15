/**
 * Pure-Node model downloader — reused by both the in-app runtime (modelManager.js)
 * and the dev-time CLI script (scripts/download-models.mjs).
 *
 * No Electron imports. Caller supplies the target directory. Progress is
 * reported through a callback so the same code can drive either a progress
 * bar in the UI or stdout dots in the terminal.
 */

import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statfsSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { get as httpsGet } from 'node:https'
import { spawn } from 'node:child_process'
import { getRedactedErrorMessage } from './errorRedaction.js'
import {
  resolveModelDownloadRedirect,
  validateModelArchiveListing,
  validateModelDownloadUrl,
  validateModelIntegrity,
} from './modelDownloadSecurity.js'

// ── Network probe (HuggingFace vs ModelScope fallback) ─────────────────

// Cache the probe with a 5-minute TTL so a long-running app adapts when the
// network comes back (or drops out) — previously the result was cached for
// the entire process lifetime, leaving China-network users stuck on the
// ModelScope path even after a VPN came up.
const HF_PROBE_TTL_MS = 5 * 60 * 1_000
let _canReachHF = null
let _canReachHFCheckedAt = 0

export async function canReachHuggingFace() {
  const now = Date.now()
  if (_canReachHF !== null && now - _canReachHFCheckedAt < HF_PROBE_TTL_MS) {
    return _canReachHF
  }
  return new Promise((resolve) => {
    const req = httpsGet('https://huggingface.co', { timeout: 5000 }, () => {
      req.destroy()
      _canReachHF = true
      _canReachHFCheckedAt = Date.now()
      resolve(true)
    })
    req.on('error', () => {
      _canReachHF = false
      _canReachHFCheckedAt = Date.now()
      resolve(false)
    })
    req.on('timeout', () => {
      req.destroy()
      _canReachHF = false
      _canReachHFCheckedAt = Date.now()
      resolve(false)
    })
  })
}

// ── HTTP download with redirect following ──────────────────────────────

function replaceFile(tempPath, destPath) {
  const backupPath = `${destPath}.backup-${process.pid}-${Date.now()}`
  const hadDestination = existsSync(destPath)
  try {
    if (hadDestination) renameSync(destPath, backupPath)
    renameSync(tempPath, destPath)
    if (hadDestination) rmSync(backupPath, { force: true })
  } catch (error) {
    if (!existsSync(destPath) && hadDestination && existsSync(backupPath)) {
      try { renameSync(backupPath, destPath) } catch {}
    }
    throw error
  }
}

/** Extra free space kept beside the file so a resume partial can finish. */
export const MODEL_DOWNLOAD_DISK_MARGIN_BYTES = 32 * 1024 * 1024

/**
 * Bytes still to fetch. `presentFiles` names catalog files whose on-disk
 * size already matches the integrity manifest.
 * @param {object} model
 * @param {Set<string>} [presentFiles]
 */
export function modelDownloadBytesNeeded(model, presentFiles = new Set()) {
  if (model.kind === 'files') {
    return model.files.reduce((sum, name) => {
      if (presentFiles.has(name)) return sum
      const size = model.integrity?.files?.[name]?.sizeBytes
      return sum + (Number.isSafeInteger(size) ? size : 0)
    }, 0)
  }
  if (model.kind === 'archive') return model.integrity?.archive?.sizeBytes ?? 0
  if (model.kind === 'standalone') return model.standalone?.integrity?.sizeBytes ?? 0
  return 0
}

/**
 * Reject a download before the first byte when the volume cannot hold it.
 * The message matches the renderer disk-space humanizer.
 * @param {number} availableBytes
 * @param {number} neededBytes
 */
export function assertModelDownloadDiskSpace(availableBytes, neededBytes) {
  if (!Number.isSafeInteger(neededBytes) || neededBytes <= 0) return
  const required = neededBytes + MODEL_DOWNLOAD_DISK_MARGIN_BYTES
  if (!Number.isSafeInteger(availableBytes) || availableBytes < required) {
    const error = new Error('Not enough disk space for the model download')
    error.code = 'ENOSPC'
    throw error
  }
}

/**
 * How to treat an existing `.partial` sibling.
 * @param {number} partialSize
 * @param {number} expectedSize
 * @returns {{ mode: 'fresh' | 'discard' | 'verify' | 'resume', offset: number }}
 */
export function planFileResume(partialSize, expectedSize) {
  if (!Number.isSafeInteger(partialSize) || partialSize <= 0) return { mode: 'fresh', offset: 0 }
  if (!Number.isSafeInteger(expectedSize) || expectedSize <= 0 || partialSize > expectedSize) {
    return { mode: 'discard', offset: 0 }
  }
  if (partialSize === expectedSize) return { mode: 'verify', offset: partialSize }
  return { mode: 'resume', offset: partialSize }
}

function readAvailableDiskBytes(directory) {
  const stats = statfsSync(directory)
  return stats.bavail * stats.bsize
}

function hashFileRange(filePath, byteLength) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    if (byteLength <= 0) {
      resolve(hash)
      return
    }
    const stream = createReadStream(filePath, { start: 0, end: byteLength - 1 })
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash))
  })
}

function downloadFile(url, destPath, onProgress, integrity, maxRedirects = 5, options = {}) {
  const safeUrl = validateModelDownloadUrl(url).toString()
  const expected = validateModelIntegrity(integrity)
  const resumeOffset = Number.isSafeInteger(options.resumeOffset) ? options.resumeOffset : 0
  const keepPartial = options.keepPartial === true
  return new Promise((resolve, reject) => {
    if (maxRedirects < 0) return reject(new Error('Too many model download redirects'))

    const headers = resumeOffset > 0 ? { Range: `bytes=${resumeOffset}-` } : undefined
    const req = httpsGet(safeUrl, { timeout: 120_000, headers }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        req.destroy()
        let redirectUrl
        try {
          redirectUrl = resolveModelDownloadRedirect(safeUrl, res.headers.location)
        } catch (error) {
          reject(error)
          return
        }
        return downloadFile(redirectUrl, destPath, onProgress, expected, maxRedirects - 1, options)
          .then(resolve)
          .catch(reject)
      }

      const ranged = resumeOffset > 0 && res.statusCode === 206
      if (res.statusCode === 416 && keepPartial) {
        req.destroy()
        try { rmSync(destPath, { force: true }) } catch {}
        return reject(new Error('Model download failed with HTTP 416'))
      }
      if (!ranged && res.statusCode !== 200) {
        req.destroy()
        return reject(new Error(`Model download failed with HTTP ${res.statusCode}`))
      }

      // A 200 after a Range request means the server ignored the offset.
      // Truncate and treat the body as the whole file.
      const offset = ranged ? resumeOffset : 0
      res.pause()
      void hashFileRange(ranged ? destPath : '', ranged ? offset : 0).then((hash) => {
        mkdirSync(dirname(destPath), { recursive: true })
        const tempPath = keepPartial ? destPath : `${destPath}.partial-${process.pid}-${Date.now()}`
        const file = createWriteStream(tempPath, { flags: ranged ? 'a' : 'w' })
        const contentLength = Number.parseInt(res.headers['content-length'] || '0', 10)
        const expectedBody = expected.sizeBytes - offset
        let downloaded = 0
        let settled = false

        const fail = (error, discardPartial = false) => {
          if (settled) return
          settled = true
          res.unpipe(file)
          res.destroy()
          file.destroy()
          if (!keepPartial || discardPartial) {
            try { rmSync(tempPath, { force: true }) } catch {}
          }
          reject(error)
        }

        if (contentLength > 0 && contentLength !== expectedBody) {
          fail(new Error('Model download size does not match its integrity manifest'), true)
          return
        }

        res.on('data', (chunk) => {
          downloaded += chunk.length
          if (offset + downloaded > expected.sizeBytes) {
            fail(new Error('Model download exceeded its integrity size limit'), true)
            return
          }
          hash.update(chunk)
          if (typeof onProgress === 'function') {
            try {
              onProgress({ downloaded: offset + downloaded, total: expected.sizeBytes })
            } catch { /* swallow — downloader must not die from callback errors */ }
          }
        })

        res.pipe(file)
        res.resume()
        file.on('finish', () => {
          file.close(() => {
            if (settled) return
            if (offset + downloaded !== expected.sizeBytes) {
              fail(new Error('Model download ended before the expected size'))
              return
            }
            const digest = hash.digest('hex')
            if (digest !== expected.sha256) {
              fail(new Error('Model download SHA-256 verification failed'), true)
              return
            }
            try {
              if (!keepPartial) replaceFile(tempPath, destPath)
              settled = true
              resolve({ sizeBytes: expected.sizeBytes, sha256: digest })
            } catch (error) {
              fail(error)
            }
          })
        })
        file.on('error', (error) => fail(error))
        res.on('aborted', () => fail(new Error('Model download response was aborted')))
        res.on('error', (error) => fail(error))
      }).catch((error) => {
        res.destroy()
        reject(error)
      })
    })

    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('Download timeout')) })
  })
}

// ── Archive (tar.bz2) download + extract ───────────────────────────────

function runTar(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('tar', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
      if (stdout.length > 5_000_000) child.kill()
    })
    child.stderr?.on('data', (chunk) => { stderr += String(chunk) })
    child.on('error', (err) => reject(err))
    child.on('close', (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(`tar exited with code ${code}${stderr ? `: ${stderr.trim()}` : ''}`))
    })
  })
}

async function extractTarArchive(archivePath, parentDir, expectedDirectory) {
  const names = (await runTar(['-tf', archivePath])).split(/\r?\n/).filter(Boolean)
  const verboseLines = (await runTar(['-tvf', archivePath])).split(/\r?\n/).filter(Boolean)
  validateModelArchiveListing(names, verboseLines, expectedDirectory)
  await runTar(['-xf', archivePath, '-C', parentDir])
}

function writeModelReceipt(model, directory, checkFilePath) {
  const receipt = {
    schemaVersion: 1,
    modelId: model.id,
    installedAt: new Date().toISOString(),
    checkFileSize: statSync(checkFilePath).size,
    integrity: model.integrity,
  }
  writeFileSync(join(directory, '.nexus-model.json'), `${JSON.stringify(receipt, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
}

function replaceDirectory(sourceDir, destDir) {
  const backupDir = `${destDir}.backup-${process.pid}-${Date.now()}`
  const hadDestination = existsSync(destDir)
  try {
    if (hadDestination) renameSync(destDir, backupDir)
    renameSync(sourceDir, destDir)
    if (hadDestination) rmSync(backupDir, { recursive: true, force: true })
  } catch (error) {
    if (!existsSync(destDir) && hadDestination && existsSync(backupDir)) {
      try { renameSync(backupDir, destDir) } catch {}
    }
    throw error
  }
}

async function downloadAndExtractArchive(model, parentDir, onProgress) {
  mkdirSync(parentDir, { recursive: true })
  const installRoot = mkdtempSync(join(parentDir, `.nexus-${model.id}-`))
  const archivePath = join(installRoot, 'model.tar.bz2')

  try {
    await downloadFile(model.githubArchive, archivePath, onProgress, model.integrity.archive)
    await extractTarArchive(archivePath, installRoot, model.directory)
    const extractedDir = join(installRoot, model.directory)
    const checkFilePath = join(extractedDir, model.checkFile)
    if (!existsSync(checkFilePath)) throw new Error('Model archive is missing its required check file')
    writeModelReceipt(model, extractedDir, checkFilePath)
    replaceDirectory(extractedDir, join(parentDir, model.directory))
  } finally {
    try { rmSync(installRoot, { recursive: true, force: true }) } catch {}
  }
}

// ── File-by-file download (HF resolve/main with ModelScope fallback) ───

/**
 * Download one catalog file, resuming a sibling `.partial` when the server
 * honors Range. A network failure leaves the partial in place for the next try.
 */
async function downloadCatalogFile(url, fileDest, partialPath, onProgress, integrity) {
  const expected = validateModelIntegrity(integrity)
  let plan = { mode: 'fresh', offset: 0 }
  if (existsSync(partialPath)) {
    plan = planFileResume(statSync(partialPath).size, expected.sizeBytes)
    if (plan.mode === 'discard') {
      rmSync(partialPath, { force: true })
      plan = { mode: 'fresh', offset: 0 }
    } else if (plan.mode === 'verify') {
      const hash = await hashFileRange(partialPath, plan.offset)
      if (hash.digest('hex') === expected.sha256) {
        replaceFile(partialPath, fileDest)
        if (typeof onProgress === 'function') onProgress({ downloaded: expected.sizeBytes, total: expected.sizeBytes })
        return
      }
      rmSync(partialPath, { force: true })
      plan = { mode: 'fresh', offset: 0 }
    }
  }

  const request = (resumeOffset) => downloadFile(url, partialPath, onProgress, expected, 5, {
    keepPartial: true,
    resumeOffset,
  })

  try {
    await request(plan.mode === 'resume' ? plan.offset : 0)
  } catch (error) {
    // The partial was longer than the server still accepts. One clean retry.
    if (!String(error?.message ?? '').includes('HTTP 416')) throw error
    await request(0)
  }
  replaceFile(partialPath, fileDest)
}

async function downloadModelFiles(model, destDir, onProgress) {
  const hfBase = `https://huggingface.co/${model.hfRepo}/resolve/${model.revision}`
  const msBase = `https://modelscope.cn/models/${model.hfRepo}/resolve/master`

  const useHfFirst = await canReachHuggingFace()
  const [primaryBase, fallbackBase] = useHfFirst ? [hfBase, msBase] : [msBase, hfBase]

  mkdirSync(destDir, { recursive: true })

  const required = new Set(
    model.files.filter(f => (
      f === model.checkFile
      || f === 'tokens.txt'
      || f.includes('encoder')
      || f.includes('decoder')
      || f.includes('joiner')
    )),
  )

  const totalFiles = model.files.length
  let fileIndex = 0

  for (const fileName of model.files) {
    fileIndex += 1
    const fileDest = join(destDir, fileName)
    const expected = model.integrity.files[fileName]
    if (existsSync(fileDest) && statSync(fileDest).size === expected.sizeBytes) continue

    const partialPath = `${fileDest}.partial`
    const fileProgress = (p) => {
      if (typeof onProgress === 'function') {
        onProgress({
          ...p,
          fileName,
          fileIndex,
          totalFiles,
        })
      }
    }

    let ok = false
    let lastError = null
    for (const base of [primaryBase, fallbackBase]) {
      try {
        await downloadCatalogFile(`${base}/${fileName}`, fileDest, partialPath, fileProgress, expected)
        ok = true
        break
      } catch (error) {
        lastError = error
      }
    }

    if (!ok && required.has(fileName)) {
      throw lastError ?? new Error(`Failed to fetch required file ${fileName}`)
    }
  }

  const checkFilePath = join(destDir, model.checkFile)
  if (!existsSync(checkFilePath)) throw new Error('Model download is missing its required check file')
  writeModelReceipt(model, destDir, checkFilePath)
}

// ── Standalone single-file download with URL fallback list ─────────────

async function downloadStandalone(file, destPath, onProgress) {
  mkdirSync(dirname(destPath), { recursive: true })
  let lastError = null
  for (const url of file.urls) {
    try {
      await downloadFile(url, destPath, onProgress, file.integrity)
      return
    } catch (err) {
      lastError = err
      try { rmSync(destPath, { force: true }) } catch {}
    }
  }
  throw lastError ?? new Error('All standalone URLs failed')
}

// ── Public entry: download one model from the catalog ──────────────────

/**
 * @param {object} model    entry from MODEL_CATALOG (modelDefinitions.js)
 * @param {object} opts
 * @param {string} opts.modelsRoot   absolute path to the target sherpa-models/ dir
 * @param {string} [opts.standaloneRoot]  for 'standalone' models (defaults to modelsRoot)
 * @param {(p: {phase: string, [k: string]: any}) => void} [opts.onProgress]
 */
export async function downloadModel(model, opts) {
  const { modelsRoot, onProgress } = opts
  const standaloneRoot = opts.standaloneRoot ?? modelsRoot

  const emit = (payload) => {
    if (typeof onProgress === 'function') {
      try { onProgress({ modelId: model.id, ...payload }) } catch {}
    }
  }

  emit({ phase: 'start' })

  try {
    mkdirSync(modelsRoot, { recursive: true })
    try {
      const presentFiles = new Set()
      if (model.kind === 'files') {
        const destDir = join(modelsRoot, model.directory)
        for (const fileName of model.files) {
          const filePath = join(destDir, fileName)
          const expectedSize = model.integrity?.files?.[fileName]?.sizeBytes
          if (existsSync(filePath) && statSync(filePath).size === expectedSize) presentFiles.add(fileName)
        }
      }
      assertModelDownloadDiskSpace(
        readAvailableDiskBytes(modelsRoot),
        modelDownloadBytesNeeded(model, presentFiles),
      )
    } catch (error) {
      if (error?.code === 'ENOSPC') throw error
      // statfs can fail on some virtual filesystems. The write path still
      // surfaces a real ENOSPC later, which the same humanizer maps.
    }

    if (model.kind === 'archive') {
      await downloadAndExtractArchive(model, modelsRoot, (p) => {
        emit({ phase: 'downloading', ...p })
      })
    } else if (model.kind === 'files') {
      const destDir = join(modelsRoot, model.directory)
      await downloadModelFiles(model, destDir, (p) => {
        emit({ phase: 'downloading', ...p })
      })
    } else if (model.kind === 'standalone') {
      const destPath = join(standaloneRoot, model.standalone.dest)
      await downloadStandalone(model.standalone, destPath, (p) => {
        emit({ phase: 'downloading', ...p })
      })
      writeModelReceipt(model, dirname(destPath), destPath)
    } else {
      throw new Error(`Unknown model kind: ${model.kind}`)
    }

    emit({ phase: 'done' })
  } catch (error) {
    emit({ phase: 'error', message: getRedactedErrorMessage(error) })
    throw error
  }
}

// ── Inventory: does a model appear installed under any of these roots? ─

/**
 * @param {object} model       catalog entry
 * @param {string[]} roots     candidate sherpa-models/ roots to probe
 * @returns {{present: boolean, verified: boolean, location: string | null, sizeBytes: number | null}}
 */
export function checkModelPresence(model, roots) {
  for (const root of roots) {
    let candidate
    if (model.kind === 'standalone') {
      candidate = join(root, model.checkFile)
    } else {
      candidate = join(root, model.directory, model.checkFile)
    }
    if (existsSync(candidate)) {
      let sizeBytes = null
      try { sizeBytes = statSync(candidate).size } catch {}
      let verified = false
      try {
        const receiptDir = model.kind === 'standalone' ? dirname(candidate) : join(root, model.directory)
        const receipt = JSON.parse(readFileSync(join(receiptDir, '.nexus-model.json'), 'utf8'))
        verified = receipt?.schemaVersion === 1
          && receipt?.modelId === model.id
          && receipt?.checkFileSize === sizeBytes
      } catch {}
      return { present: true, verified, location: root, sizeBytes }
    }
  }
  return { present: false, verified: false, location: null, sizeBytes: null }
}
