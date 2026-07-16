import { createHash } from 'node:crypto'
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { extractFile, statFile } from '@electron/asar'

import { MODEL_CATALOG } from '../electron/services/modelDefinitions.js'

export const BROWSER_VAD_ASAR_PATH = 'dist/vendor/vad/silero_vad_v5.onnx'
export const BROWSER_VAD_WORKLET_ASAR_PATH = 'dist/vendor/vad/vad.worklet.bundle.min.js'

const BROWSER_VAD_WORKLET_INTEGRITY = Object.freeze({
  // @ricky0123/vad-web 0.0.30, pinned by package-lock.json.
  sizeBytes: 2_480,
  sha256: '8a48fdc7429948a2fde3d29a84bb1a64c1f67b4ba578ccaa7548b7f989f06a74',
})

const REQUIRED_MODELS = Object.freeze(MODEL_CATALOG.filter((model) => model.required))
const VAD_MODEL = REQUIRED_MODELS.find((model) => model.id === 'vad')

const TRANSIENT_MODEL_DIRECTORY_PATTERN = /^\.nexus-.+/
const PARTIAL_MODEL_ARTIFACT_PATTERN = /\.partial(?:-|$)/i
const TAR_MODEL_ARCHIVE_PATTERN = /(?:\.tar(?:\.[a-z0-9]+)*|\.(?:tgz|tbz2?|txz))$/i

function readDirectoryEntries(directory) {
  return readdirSync(directory, { withFileTypes: true })
}

function transientArtifactReason(name, kind) {
  if ((kind === 'directory' || kind === 'symlink') && TRANSIENT_MODEL_DIRECTORY_PATTERN.test(name)) {
    return 'temporary model download directory'
  }
  if (PARTIAL_MODEL_ARTIFACT_PATTERN.test(name)) return 'partial model download artifact'
  if (kind === 'file' && TAR_MODEL_ARCHIVE_PATTERN.test(name)) return 'model download archive'
  return ''
}

export function inspectPackagedModelTree(modelsRoot, options = {}) {
  const {
    pathExists = existsSync,
    readDirectory = readDirectoryEntries,
  } = options
  const errors = []

  if (!pathExists(modelsRoot)) return { ok: true, errors, artifacts: [] }

  const artifacts = []
  const visit = (directory, relativeSegments) => {
    const entries = readDirectory(directory)
    if (!Array.isArray(entries)) {
      throw new Error(`directory reader returned an ambiguous result for ${relativeSegments.join('/') || 'sherpa-models'}`)
    }

    for (const entry of entries) {
      const name = typeof entry?.name === 'string' ? entry.name : ''
      if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\') || name.includes('\0')) {
        throw new Error(`directory reader returned an invalid entry under ${relativeSegments.join('/') || 'sherpa-models'}`)
      }
      if (typeof entry.isSymbolicLink !== 'function'
        || typeof entry.isDirectory !== 'function'
        || typeof entry.isFile !== 'function') {
        throw new Error(`directory reader returned an ambiguous entry: ${[...relativeSegments, name].join('/')}`)
      }

      const isSymbolicLink = entry.isSymbolicLink()
      const isDirectory = entry.isDirectory()
      const isFile = entry.isFile()
      const kind = isSymbolicLink ? 'symlink' : isDirectory ? 'directory' : isFile ? 'file' : 'other'
      const relativePath = [...relativeSegments, name].join('/')
      const reason = transientArtifactReason(name, kind)
      if (reason) artifacts.push({ path: relativePath, reason })

      // readdir Dirent metadata lets us identify links without resolving them.
      // Check the link's own name above, but never recurse through its target.
      if (isSymbolicLink) continue
      if (isDirectory) visit(join(directory, name), [...relativeSegments, name])
    }
  }

  try {
    visit(modelsRoot, ['sherpa-models'])
  } catch (error) {
    errors.push(`failed to inspect packaged sherpa-models tree: ${error instanceof Error ? error.message : String(error)}`)
  }

  for (const artifact of artifacts) {
    errors.push(`transient packaged model artifact must not be included: ${artifact.path} (${artifact.reason})`)
  }

  return { ok: errors.length === 0, errors, artifacts }
}

function sha256File(filePath) {
  const hash = createHash('sha256')
  const descriptor = openSync(filePath, 'r')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  try {
    let bytesRead = 0
    do {
      bytesRead = readSync(descriptor, buffer, 0, buffer.length, null)
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead))
    } while (bytesRead > 0)
  } finally {
    closeSync(descriptor)
  }
  return hash.digest('hex')
}

function inspectAsarFile(asarPath, relativePath) {
  const entry = statFile(asarPath, relativePath, false)
  if ('files' in entry || 'link' in entry || entry.unpacked) {
    throw new Error(`${relativePath} must be a packed regular file`)
  }
  const contents = extractFile(asarPath, relativePath, false)
  return {
    sizeBytes: contents.byteLength,
    sha256: createHash('sha256').update(contents).digest('hex'),
  }
}

export function requiredPackagedResources(resourcesRoot) {
  return [
    { modelId: 'app-asar', path: join(resourcesRoot, 'app.asar') },
    ...REQUIRED_MODELS.map((model) => ({
      modelId: model.id,
      path: model.kind === 'standalone'
        ? join(resourcesRoot, model.standalone.dest)
        : join(resourcesRoot, 'sherpa-models', model.directory, model.checkFile),
    })),
  ]
}

export function verifyPackagedResources(resourcesRoot, options = {}) {
  const {
    pathExists = existsSync,
    fileSize = (filePath) => statSync(filePath).size,
    fileSha256 = sha256File,
    inspectPackedFile = inspectAsarFile,
    readDirectory = readDirectoryEntries,
  } = options
  const errors = []
  const requiredResources = requiredPackagedResources(resourcesRoot)

  const modelTreeReport = inspectPackagedModelTree(join(resourcesRoot, 'sherpa-models'), {
    pathExists,
    readDirectory,
  })
  errors.push(...modelTreeReport.errors)

  for (const resource of requiredResources) {
    if (!pathExists(resource.path)) {
      errors.push(`required packaged resource is missing: ${resource.modelId}`)
      continue
    }
    try {
      if (fileSize(resource.path) <= 0) errors.push(`required packaged resource is empty: ${resource.modelId}`)
    } catch (error) {
      errors.push(`failed to inspect packaged resource ${resource.modelId}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const externalVad = requiredResources.find((resource) => resource.modelId === 'vad')
  const expectedVad = VAD_MODEL?.standalone?.integrity
  if (!expectedVad?.sizeBytes || !expectedVad.sha256) {
    errors.push('required VAD integrity contract is missing from the model catalog')
  } else if (externalVad && pathExists(externalVad.path)) {
    try {
      if (fileSize(externalVad.path) !== expectedVad.sizeBytes) {
        errors.push('required packaged resource size mismatch: vad')
      }
      if (fileSha256(externalVad.path) !== expectedVad.sha256) {
        errors.push('required packaged resource sha256 mismatch: vad')
      }
    } catch (error) {
      errors.push(`failed to verify packaged VAD integrity: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const appAsar = requiredResources.find((resource) => resource.modelId === 'app-asar')
  if (appAsar && pathExists(appAsar.path) && expectedVad?.sizeBytes && expectedVad.sha256) {
    const browserAssets = [
      { label: 'browser VAD', path: BROWSER_VAD_ASAR_PATH, integrity: expectedVad },
      { label: 'browser VAD worklet', path: BROWSER_VAD_WORKLET_ASAR_PATH, integrity: BROWSER_VAD_WORKLET_INTEGRITY },
    ]
    for (const asset of browserAssets) {
      try {
        const inspected = inspectPackedFile(appAsar.path, asset.path)
        if (!inspected || inspected.sizeBytes !== asset.integrity.sizeBytes) {
          errors.push(`${asset.label} in app.asar has the wrong size`)
        }
        if (!inspected || inspected.sha256 !== asset.integrity.sha256) {
          errors.push(`${asset.label} in app.asar has the wrong sha256`)
        }
      } catch (error) {
        errors.push(`${asset.label} is missing or unreadable in app.asar: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    resourcesRoot,
    requiredResources: requiredResources.map((resource) => resource.modelId),
    transientModelArtifacts: modelTreeReport.artifacts,
    browserVadPath: BROWSER_VAD_ASAR_PATH,
    browserVadWorkletPath: BROWSER_VAD_WORKLET_ASAR_PATH,
  }
}
