import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  summarizeVaultRequest,
  summarizeVaultResult,
} from '../electron/ipc/vaultAudit.js'
import { buildVaultSecurityReport } from '../scripts/vault-security-audit.mjs'

test('vault audit summaries exclude slot names plaintext and ref tokens', () => {
  const store = summarizeVaultRequest('vault:store', {
    slot: 'settings:apiKey',
    plaintext: 'sk-private-key',
  })

  assert.deepEqual(store, {
    channel: 'vault:store',
    slot: {
      present: true,
      length: 15,
    },
    plaintextLength: 14,
  })

  const storeMany = summarizeVaultRequest('vault:store-many', {
    entries: {
      'profile:text:openai:apiKey': 'sk-private-profile',
      'settings:telegramBotToken': '',
    },
  })

  assert.deepEqual(storeMany, {
    channel: 'vault:store-many',
    entries: {
      count: 2,
      slotNameTotalLength: 51,
      nonEmptyValueCount: 1,
      valueTotalLength: 18,
    },
  })

  const retrieveMany = summarizeVaultResult('vault:retrieve-many', {
    'settings:apiKey': 'nexus-vault-ref:private-token',
    'settings:telegramBotToken': 'nexus-vault-ref:another-private-token',
  })

  assert.deepEqual(retrieveMany, {
    channel: 'vault:retrieve-many',
    ok: true,
    resultKind: 'object',
    errorMessageLength: 0,
    returnedSlotCount: 2,
    returnedSlotNameTotalLength: 40,
    refCount: 2,
    refTextTotalLength: 66,
  })

  const serialized = JSON.stringify({ store, storeMany, retrieveMany })
  for (const privateValue of [
    'settings:apiKey',
    'sk-private-key',
    'profile:text:openai:apiKey',
    'sk-private-profile',
    'settings:telegramBotToken',
    'private-token',
    'another-private-token',
  ]) {
    assert.ok(!serialized.includes(privateValue), `${privateValue} should not be logged`)
  }
})

test('vault availability and list results record only metadata', () => {
  assert.deepEqual(summarizeVaultRequest('vault:is-available'), {
    channel: 'vault:is-available',
  })

  const availability = summarizeVaultResult('vault:is-available', true)
  assert.deepEqual(availability, {
    channel: 'vault:is-available',
    ok: true,
    resultKind: 'boolean',
    errorMessageLength: 0,
    available: true,
  })

  const list = summarizeVaultResult('vault:list-slots', [
    'settings:apiKey',
    'settings:telegramBotToken',
  ])

  assert.deepEqual(list, {
    channel: 'vault:list-slots',
    ok: true,
    resultKind: 'array',
    errorMessageLength: 0,
    slots: {
      count: 2,
      totalLength: 40,
    },
  })

  assert.ok(!JSON.stringify(list).includes('settings:apiKey'))
  assert.ok(!JSON.stringify(list).includes('settings:telegramBotToken'))
})

test('vault error summaries omit private error messages', () => {
  const summary = summarizeVaultResult(
    'vault:retrieve',
    undefined,
    new Error('failed to retrieve settings:apiKey'),
  )

  assert.deepEqual(summary, {
    channel: 'vault:retrieve',
    ok: false,
    resultKind: 'error',
    errorName: 'Error',
    errorMessageLength: 34,
  })
  assert.ok(!JSON.stringify(summary).includes('settings:apiKey'))
})

test('vault security audit covers secret-safe KeyVault support logs', () => {
  const report = buildVaultSecurityReport()

  assert.equal(report.summary.errors, 0)
  assert.ok(report.checkedFiles.includes('electron/services/keyVault.js'))
})

test('vault security audit covers renderer settings store support logs', () => {
  const report = buildVaultSecurityReport()

  assert.equal(report.summary.errors, 0)
  assert.ok(report.checkedFiles.includes('src/app/store/settingsStore.ts'))
})
