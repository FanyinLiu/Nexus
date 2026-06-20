#!/usr/bin/env node

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STORAGE_CONTRACT_VERSION, STORAGE_KEY_CONTRACTS } from './storage-contract.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const VALID_CLASSIFICATIONS = new Set([
  'audit-adjacent',
  'debug',
  'ephemeral',
  'legacy-compat',
  'secret-adjacent',
  'session',
  'settings',
  'user-data',
])

function walkSourceFiles(root, directory) {
  const base = join(root, directory)
  const files = []
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    const fullPath = join(base, entry.name)
    const rel = relative(root, fullPath)
    if (entry.isDirectory()) {
      files.push(...walkSourceFiles(root, rel))
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      files.push(rel)
    }
  }
  return files
}

function readBrowserStorageKeys(root = ROOT) {
  const keys = []
  const keyBySource = new Map()

  function addKey(item) {
    const sourceKey = `${item.key}:${item.file}:${item.constant}`
    if (keyBySource.has(sourceKey)) return
    keyBySource.set(sourceKey, item)
    keys.push(item)
  }

  for (const file of walkSourceFiles(root, 'src')) {
    const source = readFileSync(join(root, file), 'utf8')

    for (const match of source.matchAll(/\b(?:export\s+)?const\s+([A-Z0-9_]*(?:KEY|PREFIX)[A-Z0-9_]*)\s*=\s*'([^']*nexus[.:][^']*)'/g)) {
      addKey({
        constant: match[1],
        key: match[2],
        file,
        kind: match[1].includes('PREFIX') ? 'prefix' : 'exact',
      })
    }

    for (const match of source.matchAll(/(?:window\.)?(?:localStorage|sessionStorage)\.(?:getItem|setItem|removeItem)\(\s*'([^']*nexus[.:][^']*)'/g)) {
      addKey({
        constant: 'INLINE_STORAGE_KEY',
        key: match[1],
        file,
        kind: 'exact',
      })
    }
  }

  return keys.sort((left, right) => left.key.localeCompare(right.key) || left.file.localeCompare(right.file))
}

function countBy(items, field) {
  return items.reduce((acc, item) => {
    const value = item[field] ?? 'unknown'
    acc[value] = (acc[value] ?? 0) + 1
    return acc
  }, {})
}

export function buildStorageContractReport(root = ROOT) {
  const discoveredKeys = readBrowserStorageKeys(root)
  const discoveredKeySet = new Set(discoveredKeys.map((item) => item.key))
  const contractMap = new Map(STORAGE_KEY_CONTRACTS.map((item) => [item.key, item]))
  const keyOwners = new Map()
  const duplicateContractKeys = []

  for (const item of STORAGE_KEY_CONTRACTS) {
    const owners = keyOwners.get(item.key) ?? []
    owners.push(item.constant)
    keyOwners.set(item.key, owners)
  }

  for (const [key, owners] of keyOwners) {
    if (owners.length > 1) duplicateContractKeys.push({ key, constants: owners })
  }

  const missingContracts = discoveredKeys.filter((item) => !contractMap.has(item.key))
  const staleContracts = STORAGE_KEY_CONTRACTS.filter((item) => !discoveredKeySet.has(item.key))
  const wrongKind = discoveredKeys
    .map((item) => {
      const contract = contractMap.get(item.key)
      const contractKind = contract?.kind ?? 'exact'
      return contract && contractKind !== item.kind
        ? { key: item.key, sourceKind: item.kind, contractKind, file: item.file }
        : null
    })
    .filter(Boolean)
  const invalidClassifications = STORAGE_KEY_CONTRACTS
    .filter((item) => !VALID_CLASSIFICATIONS.has(item.classification))
    .map((item) => ({ constant: item.constant, classification: item.classification }))
  const missingMigration = STORAGE_KEY_CONTRACTS
    .filter((item) => !item.migration || !item.authority || !item.domain)
    .map((item) => ({ constant: item.constant }))
  const unclassifiedUserData = STORAGE_KEY_CONTRACTS
    .filter((item) => item.classification === 'user-data' && item.migration === 'do-not-migrate')
    .map((item) => ({ constant: item.constant, key: item.key }))

  const errors = {
    missingContracts,
    staleContracts,
    wrongKind,
    duplicateContractKeys,
    invalidClassifications,
    missingMigration,
    unclassifiedUserData,
  }
  const errorCount = Object.values(errors).reduce((sum, list) => sum + list.length, 0)

  return {
    schemaVersion: STORAGE_CONTRACT_VERSION,
    source: 'src/**/*.ts{x}',
    discoveredKeyReferences: discoveredKeys.length,
    discoveredKeys: discoveredKeySet.size,
    contracts: STORAGE_KEY_CONTRACTS.length,
    coverage: {
      classification: countBy(STORAGE_KEY_CONTRACTS, 'classification'),
      domain: countBy(STORAGE_KEY_CONTRACTS, 'domain'),
      migration: countBy(STORAGE_KEY_CONTRACTS, 'migration'),
    },
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

function formatList(items, key = 'constant', limit = 8) {
  if (!items.length) return 'none'
  const shown = items.slice(0, limit).map((item) => item[key] ?? JSON.stringify(item)).join(', ')
  return items.length > limit ? `${shown}, ... +${items.length - limit} more` : shown
}

function formatHumanReport(report) {
  const lines = ['Storage contract audit']
  lines.push(`- discovered browser storage keys: ${report.discoveredKeys}`)
  lines.push(`- source references: ${report.discoveredKeyReferences}`)
  lines.push(`- contract entries: ${report.contracts}`)
  lines.push(`- classifications: ${JSON.stringify(report.coverage.classification)}`)
  lines.push(`- migration posture: ${JSON.stringify(report.coverage.migration)}`)
  lines.push('')
  for (const [name, items] of Object.entries(report.errors)) {
    lines.push(`ERROR ${name}: ${items.length}`)
    if (items.length) lines.push(`  ${formatList(items)}`)
  }
  lines.push('')
  lines.push(`Summary: ok=${report.summary.ok} errors=${report.summary.errors}`)
  return lines.join('\n')
}

function main(argv) {
  const report = buildStorageContractReport(ROOT)
  const json = argv.includes('--json') || argv.includes('--format=json')
  process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : `${formatHumanReport(report)}\n`)
  if (!report.summary.ok) process.exit(1)
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null
if (invokedPath && resolve(fileURLToPath(import.meta.url)) === invokedPath) {
  main(process.argv.slice(2))
}
