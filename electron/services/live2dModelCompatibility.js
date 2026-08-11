import fs from 'node:fs/promises'
import path from 'node:path'
import { readJsonFile } from './fsUtils.js'

const LIVE2D_OPTIONAL_FILE_REFERENCES = [
  ['Physics', 'optional'],
  ['Pose', 'optional'],
  ['UserData', 'optional'],
  ['DisplayInfo', 'optional'],
]

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isPathInsideDirectory(directoryPath, targetPath) {
  const relativePath = path.relative(directoryPath, targetPath)
  return relativePath === '' || (
    !relativePath.startsWith(`..${path.sep}`)
    && relativePath !== '..'
    && !path.isAbsolute(relativePath)
  )
}

function collectDeclaredResources(modelFile) {
  const references = isRecord(modelFile?.FileReferences) ? modelFile.FileReferences : {}
  const resources = []

  if (typeof references.Moc === 'string' && references.Moc.trim()) {
    resources.push({ kind: 'moc', path: references.Moc })
  }

  if (Array.isArray(references.Textures)) {
    for (const texturePath of references.Textures) {
      resources.push({ kind: 'texture', path: texturePath })
    }
  }

  if (Array.isArray(references.Expressions)) {
    for (const expression of references.Expressions) {
      resources.push({ kind: 'expression', path: expression?.File })
    }
  }

  if (isRecord(references.Motions)) {
    for (const motionGroup of Object.values(references.Motions)) {
      if (!Array.isArray(motionGroup)) continue
      for (const motion of motionGroup) {
        resources.push({ kind: 'motion', path: motion?.File })
      }
    }
  }

  for (const [field, kind] of LIVE2D_OPTIONAL_FILE_REFERENCES) {
    if (references[field] !== undefined) {
      resources.push({ kind, path: references[field] })
    }
  }

  return resources
}

function createCompatibilitySummary(modelFile) {
  const references = isRecord(modelFile?.FileReferences) ? modelFile.FileReferences : {}
  const motions = isRecord(references.Motions)
    ? Object.values(references.Motions).reduce((count, group) => (
      count + (Array.isArray(group) ? group.length : 0)
    ), 0)
    : 0

  return {
    textureCount: Array.isArray(references.Textures) ? references.Textures.length : 0,
    motionCount: motions,
    expressionCount: Array.isArray(references.Expressions) ? references.Expressions.length : 0,
    missingMocCount: 0,
    missingTextureCount: 0,
    missingMotionCount: 0,
    missingExpressionCount: 0,
    missingOptionalCount: 0,
    unsafeResourceCount: 0,
  }
}

function missingCodeForKind(kind) {
  return {
    moc: 'missing-moc',
    texture: 'missing-texture',
    motion: 'missing-motion',
    expression: 'missing-expression',
    optional: 'missing-optional-resource',
  }[kind]
}

function incrementMissingCount(summary, kind) {
  const field = {
    moc: 'missingMocCount',
    texture: 'missingTextureCount',
    motion: 'missingMotionCount',
    expression: 'missingExpressionCount',
    optional: 'missingOptionalCount',
  }[kind]

  if (field) summary[field] += 1
}

async function inspectDeclaredResource(modelDirectory, realModelDirectory, resource) {
  if (
    typeof resource.path !== 'string'
    || !resource.path.trim()
    || path.isAbsolute(resource.path)
    || /^[a-z][a-z0-9+.-]*:/i.test(resource.path)
  ) {
    return 'unsafe'
  }

  const targetPath = path.resolve(modelDirectory, resource.path)
  if (!isPathInsideDirectory(modelDirectory, targetPath)) {
    return 'unsafe'
  }

  try {
    const [stats, realTargetPath] = await Promise.all([
      fs.stat(targetPath),
      fs.realpath(targetPath),
    ])
    if (!stats.isFile() || !isPathInsideDirectory(realModelDirectory, realTargetPath)) {
      return 'unsafe'
    }
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      return 'missing'
    }
    return 'unsafe'
  }

  return 'ready'
}

/**
 * Inspect a Cubism model and all local files it declares without exposing
 * resource paths to renderer callers.
 */
export async function inspectLive2dModelFile(filePath) {
  let modelFile

  try {
    modelFile = await readJsonFile(filePath)
  } catch {
    return {
      modelFile: null,
      compatibility: {
        status: 'blocked',
        errors: ['invalid-model-file'],
        warnings: [],
        summary: createCompatibilitySummary(null),
      },
    }
  }

  if (!isRecord(modelFile) || !isRecord(modelFile.FileReferences)) {
    return {
      modelFile,
      compatibility: {
        status: 'blocked',
        errors: ['invalid-model-file'],
        warnings: [],
        summary: createCompatibilitySummary(modelFile),
      },
    }
  }

  const summary = createCompatibilitySummary(modelFile)
  const errors = new Set()
  const warnings = new Set()
  const references = modelFile.FileReferences

  if (typeof references.Moc !== 'string' || !references.Moc.trim()) {
    errors.add('missing-moc')
    summary.missingMocCount += 1
  }
  if (!Array.isArray(references.Textures) || references.Textures.length === 0) {
    errors.add('missing-texture')
    summary.missingTextureCount += 1
  }
  if (
    (references.Motions !== undefined && !isRecord(references.Motions))
    || (isRecord(references.Motions) && Object.values(references.Motions).some((group) => !Array.isArray(group)))
    || (references.Expressions !== undefined && !Array.isArray(references.Expressions))
  ) {
    errors.add('invalid-model-file')
  }
  if (!isRecord(references.Motions) || summary.motionCount === 0) {
    warnings.add('no-motions')
  }
  if (!Array.isArray(references.Expressions) || summary.expressionCount === 0) {
    warnings.add('no-expressions')
  }

  const modelDirectory = path.dirname(path.resolve(filePath))
  let realModelDirectory
  try {
    realModelDirectory = await fs.realpath(modelDirectory)
  } catch {
    errors.add('invalid-model-file')
    realModelDirectory = modelDirectory
  }

  for (const resource of collectDeclaredResources(modelFile)) {
    const state = await inspectDeclaredResource(modelDirectory, realModelDirectory, resource)
    if (state === 'ready') continue
    if (state === 'unsafe') {
      errors.add('unsafe-resource-path')
      summary.unsafeResourceCount += 1
      continue
    }

    errors.add(missingCodeForKind(resource.kind))
    incrementMissingCount(summary, resource.kind)
  }

  return {
    modelFile,
    compatibility: {
      status: errors.size ? 'blocked' : (warnings.size ? 'limited' : 'ready'),
      errors: [...errors],
      warnings: [...warnings],
      summary,
    },
  }
}
