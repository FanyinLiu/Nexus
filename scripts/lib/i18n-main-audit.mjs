/**
 * Main-process localization audit.
 *
 * Three contracts:
 *   1. MAIN_MESSAGES has the same key set in all five locales, no empty
 *      values, and the same `{placeholder}` set per key.
 *   2. Every mainT() / translateMainMessage() literal key under electron/
 *      exists in the table, and no table key is dead.
 *   3. The covered user-facing files contain no Han string or template
 *      literal outside comments.
 *
 * `root` and `coveredFiles` are injectable so tests can drive fixtures
 * without re-auditing the real repository (TEST-3).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import ts from 'typescript'

import { buildSummary, walkFiles } from './audit-framework.mjs'

export const MAIN_MESSAGES_RELATIVE_PATH = 'electron/mainMessages.js'

export const MAIN_COVERED_FILES = Object.freeze([
  'electron/ipc/audioIpc.js',
  'electron/services/ttsService.js',
  'electron/services/ttsVolcengine.js',
  'electron/windowManager.js',
  'electron/services/macPermissions.js',
  'electron/services/windowsPermissions.js',
])

const HAN_PATTERN = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/
const SOURCE_PATTERN = /\.(js|mjs|cjs)$/
const IGNORED_DIRECTORIES = new Set(['node_modules', 'dist', 'release', 'release-smoke', '.git'])
const CALL_NAMES = new Set(['mainT', 'translateMainMessage'])

function placeholders(value) {
  return [...String(value).matchAll(/\{([A-Za-z0-9_]+)\}/g)]
    .map((match) => match[1])
    .sort()
}

function sameList(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function formatLocation(file, sourceFile, node) {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  return `${file}:${line + 1}:${character + 1}`
}

function collectLiteralKeys(sourceFile) {
  const keys = []
  const visit = (node) => {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && CALL_NAMES.has(node.expression.text)
    ) {
      const [firstArgument] = node.arguments
      if (firstArgument && (ts.isStringLiteral(firstArgument) || ts.isNoSubstitutionTemplateLiteral(firstArgument))) {
        keys.push(firstArgument.text)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return keys
}

function collectHanLiterals(sourceFile, file) {
  const found = []
  const visit = (node) => {
    let text = null
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      text = node.text
    } else if (ts.isTemplateExpression(node)) {
      text = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join('')
    }
    if (text !== null && HAN_PATTERN.test(text)) {
      found.push({ file, text, location: formatLocation(file, sourceFile, node) })
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return found
}

function parseSource(file, text) {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
}

async function loadMainMessages(root) {
  const absolutePath = join(root, MAIN_MESSAGES_RELATIVE_PATH)
  const module = await import(`${pathToFileURL(absolutePath).href}?audit=${Date.now()}`)
  return {
    locales: module.MAIN_MESSAGE_LOCALES,
    messages: module.MAIN_MESSAGES,
  }
}

/**
 * Build the main-process localization report for `root`.
 * @param {{ root?: string, coveredFiles?: readonly string[] }} [options]
 * @returns {Promise<{ checkedLocales: string[], keyCount: number, usedKeyCount: number, issues: string[], summary: { ok: boolean, errors: number } }>}
 */
export async function buildMainI18nReport(options = {}) {
  const root = options.root ?? process.cwd()
  const coveredFiles = options.coveredFiles ?? MAIN_COVERED_FILES
  const issues = []

  let loaded
  try {
    loaded = await loadMainMessages(root)
  } catch (error) {
    issues.push(`cannot load ${MAIN_MESSAGES_RELATIVE_PATH}: ${error instanceof Error ? error.message : error}`)
    return {
      checkedLocales: [],
      keyCount: 0,
      usedKeyCount: 0,
      issues,
      summary: buildSummary({ issues }),
    }
  }

  const { locales, messages } = loaded
  const localeList = Array.isArray(locales) ? [...locales] : Object.keys(messages ?? {})

  if (localeList.length !== 5) {
    issues.push(`expected 5 locales, found ${localeList.length}: ${localeList.join(', ')}`)
  }

  // ── 1. Table parity ────────────────────────────────────────────────────
  const baselineLocale = localeList[0]
  const baselineMessages = baselineLocale ? messages?.[baselineLocale] : undefined
  if (!baselineMessages || typeof baselineMessages !== 'object') {
    issues.push(`missing message table for baseline locale ${String(baselineLocale)}`)
    return {
      checkedLocales: localeList,
      keyCount: 0,
      usedKeyCount: 0,
      issues,
      summary: buildSummary({ issues }),
    }
  }

  const baselineKeys = Object.keys(baselineMessages).sort()
  const keySet = new Set(baselineKeys)

  for (const locale of localeList) {
    const table = messages?.[locale]
    if (!table || typeof table !== 'object') {
      issues.push(`missing message table for locale ${locale}`)
      continue
    }
    const localeKeys = Object.keys(table).sort()
    const missing = baselineKeys.filter((key) => !(key in table))
    const extra = localeKeys.filter((key) => !keySet.has(key))
    if (missing.length) issues.push(`${locale} missing keys: ${missing.join(', ')}`)
    if (extra.length) issues.push(`${locale} extra keys: ${extra.join(', ')}`)

    for (const key of localeKeys) {
      const value = table[key]
      if (typeof value !== 'string' || !value.trim()) {
        issues.push(`${locale} empty value for ${key}`)
        continue
      }
      if (key in baselineMessages) {
        const expected = placeholders(baselineMessages[key])
        const actual = placeholders(value)
        if (!sameList(expected, actual)) {
          issues.push(`${locale} placeholder mismatch ${key}: expected {${expected.join(',')}} got {${actual.join(',')}}`)
        }
      }
    }
  }

  // ── 2. Usage coverage under electron/ ──────────────────────────────────
  const usedKeys = new Set()
  const electronFiles = walkFiles(root, 'electron', (file) => SOURCE_PATTERN.test(file), {
    ignoreDirectories: IGNORED_DIRECTORIES,
  })
  for (const file of electronFiles) {
    const text = readFileSync(join(root, file), 'utf8')
    const sourceFile = parseSource(file, text)
    for (const key of collectLiteralKeys(sourceFile)) usedKeys.add(key)
  }

  for (const key of [...usedKeys].sort()) {
    if (!keySet.has(key)) issues.push(`unknown message key used in electron/: ${key}`)
  }
  for (const key of baselineKeys) {
    if (!usedKeys.has(key)) issues.push(`unused message key (no mainT/translateMainMessage under electron/): ${key}`)
  }

  // ── 3. No Han literals in covered user-facing files ────────────────────
  for (const file of coveredFiles) {
    let text
    try {
      text = readFileSync(join(root, file), 'utf8')
    } catch {
      issues.push(`covered file missing: ${file}`)
      continue
    }
    const sourceFile = parseSource(file, text)
    for (const hit of collectHanLiterals(sourceFile, file)) {
      const preview = hit.text.replace(/\s+/g, ' ').slice(0, 60)
      issues.push(`Han literal in covered file ${hit.location}: "${preview}"`)
    }
  }

  return {
    checkedLocales: localeList,
    keyCount: baselineKeys.length,
    usedKeyCount: usedKeys.size,
    issues,
    summary: buildSummary({ issues }),
  }
}
