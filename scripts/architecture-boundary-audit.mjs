#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']

const LAYER_RULES = [
  {
    from: 'lib',
    blocked: ['app', 'components', 'hooks'],
    reason: 'shared library code must not depend on UI/app composition',
  },
  {
    from: 'features',
    blocked: ['app'],
    reason: 'feature modules must stay reusable below app composition',
  },
  {
    from: 'hooks',
    blocked: ['app', 'components'],
    reason: 'hooks must not depend on view composition',
  },
  {
    from: 'components',
    blocked: ['app'],
    reason: 'components must not import app orchestration',
  },
  {
    from: 'core',
    blocked: ['app', 'components', 'hooks', 'features'],
    reason: 'core code must stay independent from UI and feature surfaces',
  },
  {
    from: 'types',
    blocked: ['app', 'components', 'hooks', 'features'],
    reason: 'type contracts must not depend on runtime surfaces',
  },
]

function walkFiles(root, directory, predicate) {
  const base = join(root, directory)
  const files = []
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    const fullPath = join(base, entry.name)
    const rel = relative(root, fullPath)
    if (entry.isDirectory()) {
      files.push(...walkFiles(root, rel, predicate))
    } else if (entry.isFile() && predicate(rel)) {
      files.push(rel)
    }
  }
  return files
}

function normalizePath(path) {
  return path.split('\\').join('/')
}

function classifyLayer(file) {
  const normalized = normalizePath(file)
  const parts = normalized.split('/')
  if (parts[0] !== 'src') return 'external'
  return parts[1] ?? 'src-root'
}

function sourceExists(path) {
  if (!existsSync(path)) return false
  return statSync(path).isFile()
}

function resolveSourceImport(root, fromFile, specifier) {
  if (!specifier.startsWith('.')) return null

  const base = resolve(root, dirname(fromFile), specifier)
  const candidates = []
  candidates.push(base)
  for (const extension of SOURCE_EXTENSIONS) candidates.push(`${base}${extension}`)
  for (const extension of SOURCE_EXTENSIONS) candidates.push(join(base, `index${extension}`))

  for (const candidate of candidates) {
    if (!sourceExists(candidate)) continue
    if (!SOURCE_EXTENSIONS.includes(extname(candidate))) continue
    const rel = normalizePath(relative(root, candidate))
    return rel.startsWith('src/') ? rel : null
  }

  return null
}

function readImportSpecifiers(source) {
  const specifiers = []
  const patterns = [
    /\bimport\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bexport\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.push(match[1])
  }

  return specifiers
}

function findLayerRuleViolation(fromLayer, toLayer) {
  const rule = LAYER_RULES.find((item) => item.from === fromLayer)
  if (!rule || !rule.blocked.includes(toLayer)) return null
  return rule
}

export function buildArchitectureBoundaryReport(root = ROOT) {
  const files = walkFiles(root, 'src', (file) => /\.(ts|tsx)$/.test(file))
  const layerViolations = []
  const layerCounts = {}
  let relativeImports = 0
  let resolvedImports = 0
  let unresolvedSourceImports = 0

  for (const file of files) {
    const fromLayer = classifyLayer(file)
    layerCounts[fromLayer] = (layerCounts[fromLayer] ?? 0) + 1
    const source = readFileSync(join(root, file), 'utf8')

    for (const specifier of readImportSpecifiers(source)) {
      if (!specifier.startsWith('.')) continue
      relativeImports += 1

      const target = resolveSourceImport(root, file, specifier)
      if (!target) {
        unresolvedSourceImports += 1
        continue
      }
      resolvedImports += 1

      const toLayer = classifyLayer(target)
      const rule = findLayerRuleViolation(fromLayer, toLayer)
      if (rule) {
        layerViolations.push({
          file,
          imports: target,
          fromLayer,
          toLayer,
          reason: rule.reason,
        })
      }
    }
  }

  const errors = { layerViolations }
  const errorCount = Object.values(errors).reduce((sum, list) => sum + list.length, 0)

  return {
    checkedFiles: files.length,
    relativeImports,
    resolvedImports,
    unresolvedSourceImports,
    layerCounts,
    rules: LAYER_RULES.map((rule) => ({
      from: rule.from,
      blocked: rule.blocked,
      reason: rule.reason,
    })),
    errors,
    summary: {
      ok: errorCount === 0,
      errors: errorCount,
    },
    privacy: {
      readsUserStorage: false,
      readsStoredValues: false,
      staticSourceOnly: true,
    },
  }
}

function formatHumanReport(report) {
  const lines = ['Architecture boundary audit']
  lines.push(`- checked source files: ${report.checkedFiles}`)
  lines.push(`- resolved relative imports: ${report.resolvedImports}/${report.relativeImports}`)
  lines.push(`- layer counts: ${JSON.stringify(report.layerCounts)}`)
  lines.push(`- rules: ${report.rules.length}`)
  lines.push('')
  for (const [name, items] of Object.entries(report.errors)) {
    lines.push(`ERROR ${name}: ${items.length}`)
    if (items.length) {
      lines.push(`  ${items.slice(0, 8).map((item) => `${item.file} -> ${item.imports}`).join(', ')}`)
    }
  }
  lines.push('')
  lines.push(`Summary: ok=${report.summary.ok} errors=${report.summary.errors}`)
  return lines.join('\n')
}

function main(argv) {
  const report = buildArchitectureBoundaryReport(ROOT)
  const json = argv.includes('--json') || argv.includes('--format=json')
  process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : `${formatHumanReport(report)}\n`)
  if (!report.summary.ok) process.exit(1)
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null
if (invokedPath && resolve(fileURLToPath(import.meta.url)) === invokedPath) {
  main(process.argv.slice(2))
}
