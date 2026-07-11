#!/usr/bin/env node

import { lstatSync, readdirSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const PACKAGED_APP_MAX_BYTES = 550 * 1024 * 1024
export const PACKAGED_DIRECTORY_BUDGETS = [
  { path: 'Contents/Frameworks', maxBytes: 300 * 1024 * 1024 },
  { path: 'Contents/Resources/app.asar', maxBytes: 220 * 1024 * 1024 },
  { path: 'Contents/Resources/app.asar.unpacked', maxBytes: 100 * 1024 * 1024 },
]
const FORBIDDEN_PACKAGE_SEGMENTS = ['/node_modules/onnxruntime-node/']

function findPackagedApp(root, depth = 0) {
  if (depth > 3) return null
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const absolute = join(root, entry.name)
    if (entry.name.endsWith('.app') || entry.name.endsWith('-unpacked')) return absolute
    const nested = findPackagedApp(absolute, depth + 1)
    if (nested) return nested
  }
  return null
}

function measureTree(root, current = root, totals = { bytes: 0, files: 0, forbiddenFiles: [] }) {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const absolute = join(current, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      measureTree(root, absolute, totals)
      continue
    }
    if (!entry.isFile()) continue
    const normalized = `/${relative(root, absolute).replaceAll('\\', '/')}`
    totals.bytes += lstatSync(absolute).size
    totals.files += 1
    if (FORBIDDEN_PACKAGE_SEGMENTS.some((segment) => normalized.includes(segment))) {
      totals.forbiddenFiles.push(normalized)
    }
  }
  return totals
}

function measurePath(absolutePath) {
  const stat = lstatSync(absolutePath)
  if (stat.isFile()) return { bytes: stat.size, files: 1 }
  if (stat.isDirectory()) return measureTree(absolutePath)
  return { bytes: 0, files: 0 }
}

export function buildPackageSizeReport(
  releaseDir,
  { maxBytes = PACKAGED_APP_MAX_BYTES, directoryBudgets = PACKAGED_DIRECTORY_BUDGETS } = {},
) {
  const appPath = findPackagedApp(releaseDir)
  if (!appPath) {
    return {
      releaseDir,
      appPath: null,
      bytes: 0,
      files: 0,
      maxBytes,
      directoryBudgets: [],
      forbiddenFiles: [],
      errors: ['packaged app directory not found'],
      summary: { ok: false, errors: 1, warnings: 0 },
    }
  }

  const metrics = measureTree(appPath)
  const directories = directoryBudgets.flatMap((budget) => {
    const absolutePath = join(appPath, budget.path)
    try {
      const measured = measurePath(absolutePath)
      return [{ path: budget.path, ...measured, maxBytes: budget.maxBytes }]
    } catch (error) {
      if (error?.code === 'ENOENT') return []
      throw error
    }
  })
  const errors = []
  if (metrics.bytes > maxBytes) errors.push(`packaged app exceeds ${maxBytes} bytes`)
  if (metrics.forbiddenFiles.length > 0) errors.push('forbidden packaged dependencies found')
  for (const directory of directories) {
    if (directory.bytes > directory.maxBytes) {
      errors.push(`${directory.path} exceeds ${directory.maxBytes} bytes`)
    }
  }
  const warnings = Number(metrics.bytes >= maxBytes * 0.9)
    + directories.filter((directory) => directory.bytes >= directory.maxBytes * 0.9).length
  return {
    releaseDir,
    appPath,
    ...metrics,
    maxBytes,
    directoryBudgets: directories,
    errors,
    summary: { ok: errors.length === 0, errors: errors.length, warnings },
  }
}

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}

function main(argv) {
  const releaseArg = argv.find((arg) => arg.startsWith('--release-dir='))?.slice('--release-dir='.length)
  const releaseDir = resolve(ROOT, releaseArg || process.env.PACKAGED_SMOKE_RELEASE_DIR || 'release-smoke')
  const report = buildPackageSizeReport(releaseDir)
  if (argv.includes('--json') || argv.includes('--format=json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } else {
    console.log('Package size audit')
    console.log(`- app: ${report.appPath ? basename(report.appPath) : 'not found'}`)
    console.log(`- files: ${report.files}`)
    console.log(`- size: ${formatBytes(report.bytes)} / ${formatBytes(report.maxBytes)}`)
    for (const directory of report.directoryBudgets) {
      console.log(`- ${directory.path}: ${formatBytes(directory.bytes)} / ${formatBytes(directory.maxBytes)}`)
    }
    console.log(`- forbidden files: ${report.forbiddenFiles.length}`)
    console.log(`Summary: ok=${report.summary.ok} errors=${report.summary.errors} warnings=${report.summary.warnings}`)
  }
  if (!report.summary.ok) process.exit(1)
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null
if (invokedPath && resolve(fileURLToPath(import.meta.url)) === invokedPath) main(process.argv.slice(2))
