// @ts-nocheck
import fs from 'node:fs/promises'
import path from 'node:path'
import { summarizeCubismDeclaredResources } from '../../shared/live2dModelResources.js'
import { readJsonFile } from './fsUtils.js'

const LIVE2D_OPTIONAL_FILE_REFERENCES = [
  ['Physics', 'optional'],
  ['Pose', 'optional'],
  ['UserData', 'optional'],
  ['DisplayInfo', 'optional'],
]

function isObject(value) {
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

function isUnsafeDeclaredPath(resourcePath, modelDirectory) {
  if (
    typeof resourcePath !== 'string'
    || !resourcePath.trim()
    || path.isAbsolute(resourcePath)
    || /^[a-z][a-z0-9+.-]*:/i.test(resourcePath)
  ) {
    return true
  }

  return !isPathInsideDirectory(modelDirectory, path.resolve(modelDirectory, resourcePath))
}

function collectDeclaredResources(modelFile) {
  const references = isObject(modelFile?.FileReferences) ? modelFile.FileReferences : {}
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

  if (isObject(references.Motions)) {
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

function createCompatibilitySummary(declared) {
  return {
    textureCount: declared.textureCount,
    motionCount: declared.motionCount,
    expressionCount: declared.expressionCount,
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
  if (isUnsafeDeclaredPath(resource.path, modelDirectory)) {
    return 'unsafe'
  }

  try {
    const realTargetPath = await fs.realpath(path.resolve(modelDirectory, resource.path))
    if (!isPathInsideDirectory(realModelDirectory, realTargetPath)) {
      return 'unsafe'
    }
    const stats = await fs.stat(realTargetPath)
    if (!stats.isFile()) return 'unsafe'
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
 * resource paths to renderer callers. Motion Sound is not an activation
 * requirement — this app never plays model-baked audio.
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
        summary: createCompatibilitySummary(summarizeCubismDeclaredResources(null)),
      },
    }
  }

  if (!isObject(modelFile) || !isObject(modelFile.FileReferences)) {
    return {
      modelFile,
      compatibility: {
        status: 'blocked',
        errors: ['invalid-model-file'],
        warnings: [],
        summary: createCompatibilitySummary(summarizeCubismDeclaredResources(modelFile)),
      },
    }
  }

  const declaredSummary = summarizeCubismDeclaredResources(modelFile)
  const summary = createCompatibilitySummary(declaredSummary)
  const errors = new Set()
  const warnings = new Set()
  const references = modelFile.FileReferences
  const hasMalformedMotions = references.Motions !== undefined && (
    !isObject(references.Motions)
    || Object.values(references.Motions).some((group) => (
      !Array.isArray(group)
      || group.some((motion) => (
        !isObject(motion)
        || typeof motion.File !== 'string'
        || !motion.File.trim()
        || (motion.Sound !== undefined && typeof motion.Sound !== 'string')
      ))
    ))
  )
  const hasMalformedExpressions = references.Expressions !== undefined && (
    !Array.isArray(references.Expressions)
    || references.Expressions.some((expression) => (
      !isObject(expression)
      || typeof expression.Name !== 'string'
      || !expression.Name.trim()
      || typeof expression.File !== 'string'
      || !expression.File.trim()
    ))
  )

  if (typeof references.Moc !== 'string' || !references.Moc.trim()) {
    errors.add('missing-moc')
    summary.missingMocCount += 1
  }
  if (!Array.isArray(references.Textures) || references.Textures.length === 0) {
    errors.add('missing-texture')
    summary.missingTextureCount += 1
  }
  if (hasMalformedMotions || hasMalformedExpressions) {
    errors.add('invalid-model-file')
  }
  if (!isObject(references.Motions) || summary.motionCount === 0) {
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

  if (isObject(references.Motions)) {
    for (const group of Object.values(references.Motions)) {
      if (!Array.isArray(group)) continue
      for (const motion of group) {
        if (typeof motion?.Sound !== 'string' || !motion.Sound.trim()) continue
        if (isUnsafeDeclaredPath(motion.Sound, modelDirectory)) {
          errors.add('unsafe-resource-path')
          summary.unsafeResourceCount += 1
        }
      }
    }
  }

  for (const resource of collectDeclaredResources(modelFile)) {
    const state = await inspectDeclaredResource(modelDirectory, realModelDirectory, resource)
    if (state === 'ready') continue
    if (state === 'unsafe') {
      errors.add('unsafe-resource-path')
      summary.unsafeResourceCount += 1
      continue
    }

    const missingCode = missingCodeForKind(resource.kind)
    if (!missingCode) continue
    errors.add(missingCode)
    incrementMissingCount(summary, resource.kind)
  }

  return {
    modelFile,
    compatibility: {
      status: errors.size ? 'blocked' : declaredSummary.status,
      errors: [...errors],
      warnings: [...warnings],
      summary,
    },
  }
}
