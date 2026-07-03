import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { STORAGE_KEY_CONTRACTS } from '../scripts/storage-contract.mjs'
import { buildStorageContractReport } from '../scripts/storage-contract-audit.mjs'

function buildStorageKeySource(omitKeys = new Set<string>()) {
  return STORAGE_KEY_CONTRACTS
    .filter((item) => !omitKeys.has(item.key))
    .map((item) => (
      /(?:KEY|PREFIX)/.test(item.constant)
        ? `export const ${item.constant} = '${item.key}'`
        : `window.localStorage.getItem('${item.key}')`
    ))
    .join('\n')
}

function createStorageContractFixture(source: string) {
  const root = mkdtempSync(join(tmpdir(), 'nexus-storage-contract-audit-'))
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'storageKeys.ts'), `${source}\n`)
  return root
}

function withStorageContractFixture<T>(source: string, callback: (root: string) => T): T {
  const root = createStorageContractFixture(source)
  try {
    return callback(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('storage contract audit passes a fixture with every contracted key', () => {
  withStorageContractFixture(buildStorageKeySource(), (root) => {
    const report = buildStorageContractReport(root)

    assert.equal(report.summary.ok, true)
    assert.equal(report.summary.errors, 0)
    assert.equal(report.discoveredKeys, report.contracts)
    assert.equal(report.privacy.staticSourceOnly, true)
    assert.equal(report.privacy.readsStoredValues, false)
  })
})

test('storage contract audit rejects newly discovered keys without a contract', () => {
  const source = `${buildStorageKeySource()}
window.localStorage.setItem('nexus:untracked-storage-key', 'value')
`
  withStorageContractFixture(source, (root) => {
    const report = buildStorageContractReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(
      report.errors.missingContracts.some((item) => item.key === 'nexus:untracked-storage-key'),
    )
  })
})

test('storage contract audit rejects stale contracts without source references', () => {
  const omittedKey = STORAGE_KEY_CONTRACTS[0]?.key
  assert.ok(omittedKey)

  withStorageContractFixture(buildStorageKeySource(new Set([omittedKey])), (root) => {
    const report = buildStorageContractReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(
      report.errors.staleContracts.some((item) => item.key === omittedKey),
    )
  })
})
