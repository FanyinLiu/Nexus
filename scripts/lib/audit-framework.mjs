#!/usr/bin/env node

// Shared engine for the surface audit scripts. Every helper here is the
// parameterized form of an implementation that used to be copy-pasted,
// line for line, across the audit scripts. Data tables and audit-specific
// checks stay in each audit script.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function resolveProjectRoot(importMetaUrl) {
  return join(dirname(fileURLToPath(importMetaUrl)), '..')
}

export function readProjectFile(root, file, { normalizeLineEndings = false } = {}) {
  const fullPath = join(root, file)
  if (!existsSync(fullPath)) return null
  const text = readFileSync(fullPath, 'utf8')
  return normalizeLineEndings ? text.replace(/\r\n/g, '\n') : text
}

export function readProjectFiles(root, files, options) {
  return new Map(files.map((file) => [file, readProjectFile(root, file, options)]))
}

// Map-based variant: reports files whose read returned null.
export function findMissingFiles(files) {
  return [...files.entries()]
    .filter(([, text]) => text == null)
    .map(([file]) => file)
}

// On-disk variant: reports entries that do not exist at all (works for
// directories too, which readProjectFile cannot read).
export function findMissingFilesOnDisk(root, files) {
  return files.filter((file) => !existsSync(join(root, file)))
}

export function findMissingContracts(files, contracts) {
  const missing = []
  for (const contract of contracts) {
    const text = files.get(contract.file)
    if (text == null) continue
    const missingPatterns = contract.patterns.filter((pattern) => !text.includes(pattern))
    if (missingPatterns.length) {
      const item = { id: contract.id, file: contract.file }
      if (contract.description !== undefined) item.description = contract.description
      item.missingPatterns = missingPatterns
      missing.push(item)
    }
  }
  return missing
}

// Rules carry either a `files` array or a single `file`. Patterns may be
// plain strings (substring match, reported as-is) or RegExps (test match,
// reported by source). `transformText` lets an audit pre-filter file text
// before matching (e.g. dropping allowlisted lines).
export function findForbiddenPatterns(files, rules, { transformText } = {}) {
  const matches = []
  for (const rule of rules) {
    for (const file of rule.files ?? [rule.file]) {
      let text = files.get(file)
      if (text == null) continue
      if (transformText) text = transformText(text)
      const foundPatterns = rule.patterns
        .filter((pattern) => (pattern instanceof RegExp ? pattern.test(text) : text.includes(pattern)))
        .map((pattern) => (pattern instanceof RegExp ? pattern.source : pattern))
      if (foundPatterns.length) {
        const item = { id: rule.id, file }
        if (rule.description !== undefined) item.description = rule.description
        item.foundPatterns = foundPatterns
        matches.push(item)
      }
    }
  }
  return matches
}

export function countOccurrences(text, fragment) {
  return text.split(fragment).length - 1
}

// Sums the lengths of the given error lists into the shared summary shape.
// Callers pass exactly the lists that count as errors for their audit.
export function buildSummary(errorLists) {
  const errors = Object.values(errorLists).reduce((total, list) => total + list.length, 0)
  return {
    ok: errors === 0,
    errors,
  }
}

export function normalizePath(path) {
  return path.split('\\').join('/')
}

export function walkFiles(root, directory, predicate, { ignoreDirectories } = {}) {
  const base = join(root, directory)
  const files = []
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (ignoreDirectories?.has(entry.name)) continue
    const fullPath = join(base, entry.name)
    const rel = normalizePath(relative(root, fullPath))
    if (entry.isDirectory()) {
      files.push(...walkFiles(root, rel, predicate, { ignoreDirectories }))
    } else if (entry.isFile() && predicate(rel)) {
      files.push(rel)
    }
  }
  return files
}

export function isInvokedAsScript(importMetaUrl) {
  const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null
  return invokedPath !== null && resolve(fileURLToPath(importMetaUrl)) === invokedPath
}

// Shared CLI tail: build the report, print the human format, and map the
// summary onto the process exit code.
export function runAuditCli({ importMetaUrl, root, buildReport, formatReport }) {
  if (!isInvokedAsScript(importMetaUrl)) return
  const report = buildReport(root)
  console.log(formatReport(report))
  process.exitCode = report.summary.ok ? 0 : 1
}
