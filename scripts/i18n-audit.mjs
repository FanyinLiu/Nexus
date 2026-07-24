import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = process.cwd()
const keyFile = resolve(root, 'src/i18n/keys.ts')

/** Locale id → directory of per-namespace message modules. */
const locales = {
  'zh-CN': 'src/i18n/locales/zh-CN',
  'zh-TW': 'src/i18n/locales/zh-TW',
  'en-US': 'src/i18n/locales/en',
  ja: 'src/i18n/locales/ja',
  ko: 'src/i18n/locales/ko',
}

function readText(path) {
  return readFileSync(resolve(root, path), 'utf8')
}

function extractTranslationKeys() {
  const text = readFileSync(keyFile, 'utf8')
  return [...text.matchAll(/^\s*'([^']+)'\s*,/gm)].map((match) => match[1])
}

function unescapeStringLiteral(value) {
  return value
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
    .replace(/\\\\/g, '\\')
}

function listLocaleSourceFiles(dirRel) {
  const abs = resolve(root, dirRel)
  return readdirSync(abs)
    .filter((name) => name.endsWith('.ts') && name !== 'index.ts')
    .map((name) => join(dirRel, name))
}

function extractLocaleEntries(dirRel) {
  const entries = new Map()
  const duplicates = []
  const pattern = /^\s*'([^']+)'\s*:\s*(['"])((?:\\.|[\s\S])*?)\2\s*,/gm

  for (const file of listLocaleSourceFiles(dirRel)) {
    const text = readText(file)
    for (const match of text.matchAll(pattern)) {
      const key = match[1]
      if (entries.has(key)) duplicates.push(key)
      entries.set(key, unescapeStringLiteral(match[3]))
    }
  }

  return { entries, duplicates, files: listLocaleSourceFiles(dirRel) }
}

function placeholders(value) {
  return [...String(value).matchAll(/\{([A-Za-z0-9_]+)\}/g)]
    .map((match) => match[1])
    .sort()
}

function sameList(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

// Fail fast if a locale directory is missing (e.g. incomplete split).
for (const [locale, dir] of Object.entries(locales)) {
  const abs = resolve(root, dir)
  try {
    if (!statSync(abs).isDirectory()) {
      throw new Error(`${locale} locale path is not a directory: ${dir}`)
    }
  } catch (error) {
    console.error(`i18n audit failed: missing locale directory for ${locale}: ${dir}`)
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

const keys = extractTranslationKeys()
const keySet = new Set(keys)
const duplicateKeys = keys.filter((key, index) => keys.indexOf(key) !== index)
const localeEntries = new Map(
  Object.entries(locales).map(([locale, path]) => [locale, { path, ...extractLocaleEntries(path) }]),
)
const sourceEntries = localeEntries.get('zh-CN')?.entries ?? new Map()
const issues = []

if (duplicateKeys.length) {
  issues.push(`translationKeys duplicates: ${[...new Set(duplicateKeys)].join(', ')}`)
}

for (const [locale, result] of localeEntries) {
  const localeKeys = [...result.entries.keys()]
  const missing = keys.filter((key) => !result.entries.has(key))
  const extra = localeKeys.filter((key) => !keySet.has(key))

  if (missing.length || extra.length || result.duplicates.length) {
    issues.push(`${locale}: missing=${missing.length} extra=${extra.length} duplicate=${result.duplicates.length}`)
    if (missing.length) issues.push(`${locale} missing: ${missing.join(', ')}`)
    if (extra.length) issues.push(`${locale} extra: ${extra.join(', ')}`)
    if (result.duplicates.length) issues.push(`${locale} duplicate: ${result.duplicates.join(', ')}`)
  }

  for (const key of keys) {
    const value = result.entries.get(key)
    if (typeof value !== 'string') continue

    const sourceValue = sourceEntries.get(key)
    if (typeof sourceValue === 'string') {
      const expectedPlaceholders = placeholders(sourceValue)
      const actualPlaceholders = placeholders(value)
      if (!sameList(expectedPlaceholders, actualPlaceholders)) {
        issues.push(
          `${locale} placeholder mismatch ${key}: expected {${expectedPlaceholders.join(',')}} got {${actualPlaceholders.join(',')}}`,
        )
      }
    }

    if (/\[object Object\]|undefined|null/.test(value)) {
      issues.push(`${locale} suspicious value ${key}: ${value}`)
    }
    if (/Phase\s*1|phase1|Phase1|階段|阶段/.test(value)) {
      issues.push(`${locale} internal-stage wording ${key}: ${value}`)
    }
  }

  console.log(
    `${locale}: keys=${result.entries.size} files=${result.files.length} missing=${missing.length} extra=${extra.length} duplicate=${result.duplicates.length}`,
  )
}

if (issues.length) {
  console.error(`\nI18n audit failed with ${issues.length} issue(s):`)
  for (const issue of issues) console.error(`- ${issue}`)
  process.exit(1)
}

console.log('i18n audit passed')
