import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

import { buildIpcContractReport } from '../scripts/ipc-contract-audit.mjs'

const BASELINE_FILES: Record<string, string> = {
  'electron/preload.js': `
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('nexus', {
  ping: () => ipcRenderer.invoke('app:ping'),
})
`,
  'electron/ipc/app.js': `
const { ipcMain } = require('electron')

function requireTrustedSender() {}

ipcMain.handle('app:ping', (event) => {
  requireTrustedSender(event)
  return true
})
`,
}

function createIpcContractFixture(overrides: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'nexus-ipc-contract-audit-'))
  const files = { ...BASELINE_FILES, ...overrides }

  for (const [relativePath, source] of Object.entries(files)) {
    const absolutePath = join(root, relativePath)
    mkdirSync(dirname(absolutePath), { recursive: true })
    writeFileSync(absolutePath, source)
  }

  return root
}

function withIpcContractFixture<T>(
  overrides: Record<string, string>,
  callback: (root: string) => T,
): T {
  const root = createIpcContractFixture(overrides)
  try {
    return callback(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function warningChannels(report: ReturnType<typeof buildIpcContractReport>, bucket: keyof typeof report.warnings) {
  return report.warnings[bucket].map((item) => item.channel)
}

test('IPC contract audit passes a minimal trusted preload-handler contract', () => {
  withIpcContractFixture({}, (root) => {
    const report = buildIpcContractReport(root)

    assert.equal(report.summary.ok, true)
    assert.equal(report.counts.preloadInvokeChannels, 1)
    assert.equal(report.counts.mainHandlerChannels, 1)
    assert.deepEqual(report.errors.missingHandlers, [])
    assert.deepEqual(report.errors.missingTrustedSender, [])
  })
})

test('IPC contract audit rejects preload channels without a main handler', () => {
  withIpcContractFixture({
    'electron/preload.js': `
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('nexus', {
  missing: () => ipcRenderer.invoke('app:missing'),
})
`,
  }, (root) => {
    const report = buildIpcContractReport(root)

    assert.equal(report.summary.ok, false)
    assert.deepEqual(report.errors.missingHandlers.map((item) => item.channel), ['app:missing'])
  })
})

test('IPC contract audit rejects handlers that skip trusted sender checks', () => {
  withIpcContractFixture({
    'electron/ipc/app.js': `
const { ipcMain } = require('electron')

ipcMain.handle('app:ping', () => true)
`,
  }, (root) => {
    const report = buildIpcContractReport(root)

    assert.equal(report.summary.ok, false)
    assert.deepEqual(report.errors.missingTrustedSender.map((item) => item.channel), ['app:ping'])
  })
})

test('IPC contract audit warns on high-risk renderer payloads without validation, audit, or permission boundary', () => {
  withIpcContractFixture({
    'electron/preload.js': `
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('nexus', {
  openText: (payload) => ipcRenderer.invoke('file:open-text', payload),
})
`,
    'electron/ipc/app.js': `
const { ipcMain } = require('electron')

function requireTrustedSender() {}

ipcMain.handle('file:open-text', (event, payload) => {
  requireTrustedSender(event)
  return payload?.path
})
`,
  }, (root) => {
    const report = buildIpcContractReport(root)

    assert.equal(report.summary.ok, false)
    assert.equal(report.summary.errors, 0)
    assert.ok(warningChannels(report, 'payloadWithoutValidation').includes('file:open-text'))
    assert.ok(warningChannels(report, 'highRiskWithoutAudit').includes('file:open-text'))
    assert.ok(warningChannels(report, 'highRiskWithoutPermissionHint').includes('file:open-text'))
  })
})
