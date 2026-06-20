#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STORAGE_CONTRACT_VERSION, STORAGE_KEY_CONTRACTS } from './storage-contract.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const STORAGE_CORE_PATH = join('src', 'lib', 'storage', 'core.ts')
const VALID_CLASSIFICATIONS = new Set([
  'audit-adjacent',
  'debug',
  'ephemeral',
  'legacy-compat',
  'settings',
  'user-data',
])

function readStorageConstants(root = ROOT) {
  const source = readFileSync(join(root, STORAGE_CORE_PATH), 'utf8')
  return [...source.matchAll(/export const ([A-Z0-9_]+_STORAGE_KEY) = '([^']+)'/g)]
    .map((match) => ({ constant: match[1], key: match[2] }))
}

function countBy(items, field) {
  return items.reduce((acc, item) => {
    const value = item[field] ?? 'unknown'
    acc[value] = (acc[value] ?? 0) + 1
    return acc
  }, {})
}

export function buildStorageContractReport(root = ROOT) {
  const constants = readStorageConstants(root)
  const constantMap = new Map(constants.map((item) => [item.constant, item]))
  const contractMap = new Map(STORAGE_KEY_CONTRACTS.map((item) => [item.constant, item]))
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

  const missingContracts = constants.filter((item) => !contractMap.has(item.constant))
  const staleContracts = STORAGE_KEY_CONTRACTS.filter((item) => !constantMap.has(item.constant))
  const keyMismatches = STORAGE_KEY_CONTRACTS
    .map((item) => {
      const source = constantMap.get(item.constant)
      return source && source.key !== item.key
        ? { constant: item.constant, sourceKey: source.key, contractKey: item.key }
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
    keyMismatches,
    duplicateContractKeys,
    invalidClassifications,
    missingMigration,
    unclassifiedUserData,
  }
  const errorCount = Object.values(errors).reduce((sum, list) => sum + list.length, 0)

  return {
    schemaVersion: STORAGE_CONTRACT_VERSION,
    source: STORAGE_CORE_PATH,
    constants: constants.length,
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
  lines.push(`- storage constants: ${report.constants}`)
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
