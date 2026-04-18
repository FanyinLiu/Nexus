/**
 * Pure-Node model downloader — reused by both the in-app runtime (modelManager.js)
 * and the dev-time CLI script (scripts/download-models.mjs).
 *
 * No Electron imports. Caller supplies the target directory. Progress is
 * reported through a callback so the same code can drive either a progress
 * bar in the UI or stdout dots in the terminal.
 */

import { existsSync, mkdirSync, createWriteStream, rmSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { get as httpsGet } from 'node:https'
import { get as httpGet } from 'node:http'
import { execSync } from 'node:child_process'

// ── Network probe (HuggingFace vs ModelScope fallback) ─────────────────

let _canReachHF = null

export async function canReachHuggingFace() {
  if (_canReachHF !== null) return _canReachHF
  return new Promise((resolve) => {
    const req = httpsGet('https://huggingface.co', { timeout: 5000 }, () => {
      req.destroy()
      _canReachHF = true
      resolve(true)
    })
    req.on('error', () => { _canReachHF = false; resolve(false) })
    req.on('timeout', () => { req.destroy(); _canReachHF = false; resolve(false) })
  })
}

// ── HTTP download with redirect following ──────────────────────────────

function downloadFile(url, destPath, onProgress, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error('Too many redirects'))

    const getter = url.startsWith('https') ? httpsGet : httpGet
    const req = getter(url, { timeout: 120_000 }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        req.destroy()
        return downloadFile(res.headers.location, destPath, onProgress, maxRedirects - 1)
          .then(resolve)
          .catch(reject)
      }

      if (res.statusCode !== 200) {
        req.destroy()
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`))
      }

      mkdirSync(dirname(destPath), { recursive: true })
      const file = createWriteStream(destPath)
      const totalBytes = parseInt(res.headers['content-length'] || '0', 10)
      let downloaded = 0

      res.on('data', (chunk) => {
        downloaded += chunk.length
        if (typeof onProgress === 'function') {
          try {
            onProgress({ downloaded, total: totalBytes })
          } catch { /* swallow — downloader must not die from callback errors */ }
        }
      })

      res.pipe(file)
      file.on('finish', () => {
        file.close()
        resolve()
      })
      file.on('error', (err) => { file.close(); reject(err) })
    })

    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('Download timeout')) })
  })
}

// ── Archive (tar.bz2) download + extract ───────────────────────────────

async function downloadAndExtractArchive(url, parentDir, onProgress) {
  mkdirSync(parentDir, { recursive: true })
  const archivePath = join(parentDir, `_download-${Date.now()}.tar.bz2`)

  try {
    await downloadFile(url, archivePath, onProgress)
  } catch (err) {
    try { rmSync(archivePath, { force: true }) } catch {}
    throw err
  }

  try {
    // -xf (auto-detect compression from magic bytes) works on GNU tar,
    // BSD tar, and the libarchive tar.exe bundled with Windows 10 1803+.
    // `-xjf` hard-codes bzip2 and crashes on some BSD tar variants — auto-
    // detection is both simpler and more portable.
    execSync(`tar -xf "${archivePath}" -C "${parentDir}"`, { stdio: 'pipe' })
  } finally {
    try { rmSync(archivePath, { force: true }) } catch {}
  }
}

// ── File-by-file download (HF resolve/main with ModelScope fallback) ───

async function downloadModelFiles(model, destDir, onProgress) {
  const hfBase = `https://huggingface.co/${model.hfRepo}/resolve/main`
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

    if (existsSync(fileDest)) continue

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
    for (const base of [primaryBase, fallbackBase]) {
      try {
        await downloadFile(`${base}/${fileName}`, fileDest, fileProgress)
        ok = true
        break
      } catch {
        try { rmSync(fileDest, { force: true }) } catch {}
      }
    }

    if (!ok && required.has(fileName)) {
      throw new Error(`Failed to fetch required file ${fileName}`)
    }
  }
}

// ── Standalone single-file download with URL fallback list ─────────────

async function downloadStandalone(file, destPath, onProgress) {
  mkdirSync(dirname(destPath), { recursive: true })
  let lastError = null
  for (const url of file.urls) {
    try {
      await downloadFile(url, destPath, onProgress)
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
    if (model.kind === 'archive') {
      await downloadAndExtractArchive(model.githubArchive, modelsRoot, (p) => {
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
    } else {
      throw new Error(`Unknown model kind: ${model.kind}`)
    }

    emit({ phase: 'done' })
  } catch (error) {
    emit({ phase: 'error', message: error instanceof Error ? error.message : String(error) })
    throw error
  }
}

// ── Inventory: does a model appear installed under any of these roots? ─

/**
 * @param {object} model       catalog entry
 * @param {string[]} roots     candidate sherpa-models/ roots to probe
 * @returns {{present: boolean, location: string | null, sizeBytes: number | null}}
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
      return { present: true, location: root, sizeBytes }
    }
  }
  return { present: false, location: null, sizeBytes: null }
}
