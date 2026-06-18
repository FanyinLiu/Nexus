import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  classifyIpcAuditCategories,
  installHighRiskIpcAudit,
  isHighRiskIpcChannel,
} from '../electron/ipc/auditedIpc.js'

function createFakeIpcMain() {
  type IpcListener = (event: unknown, ...args: unknown[]) => unknown
  const handlers = new Map<string, IpcListener>()
  return {
    handlers,
    ipcMain: {
      handle(channel: string, listener: IpcListener) {
        handlers.set(channel, listener)
      },
    },
  }
}

function createEvent(url = 'file:///Users/private/Nexus/index.html') {
  return {
    sender: {
      id: 42,
      getURL: () => url,
    },
    senderFrame: {
      url,
    },
  }
}

test('high-risk IPC audit classifier matches M3 categories', () => {
  assert.deepEqual(classifyIpcAuditCategories('tool:open-external'), ['system-action', 'mutating'])
  assert.deepEqual(classifyIpcAuditCategories('file:save-text'), ['local-data-or-files', 'mutating'])
  assert.deepEqual(classifyIpcAuditCategories('audio:transcribe'), ['network-or-integration', 'mutating'])
  assert.equal(isHighRiskIpcChannel('runtime-state:get'), false)
  assert.equal(isHighRiskIpcChannel('vault:retrieve'), true)
})

test('high-risk IPC audit wrapper records redacted success metadata only', async () => {
  const { ipcMain, handlers } = createFakeIpcMain()
  const records: Array<{ category: string; action: string; details: Record<string, unknown> }> = []
  const installResult = installHighRiskIpcAudit(ipcMain, {
    auditFn: (category: string, action: string, details: Record<string, unknown>) => {
      records.push({ category, action, details })
    },
  })

  assert.deepEqual(installResult, { installed: true })

  ipcMain.handle('file:save-text', async (_event: unknown, payload: { content: string }) => {
    assert.equal(payload.content, 'private file body')
    return { filePath: '/Users/private/export.json', content: 'private result' }
  })

  const result = await handlers.get('file:save-text')?.(createEvent(), { content: 'private file body' })
  assert.deepEqual(result, { filePath: '/Users/private/export.json', content: 'private result' })

  assert.equal(records.length, 1)
  assert.equal(records[0]?.category, 'ipc')
  assert.equal(records[0]?.action, 'high-risk-invoke')
  assert.equal(records[0]?.details.channel, 'file:save-text')
  assert.equal(records[0]?.details.outcome, 'ok')
  assert.deepEqual(records[0]?.details.sender, { webContentsId: 42, originKind: 'file' })

  const serialized = JSON.stringify(records)
  assert.equal(serialized.includes('private file body'), false)
  assert.equal(serialized.includes('private result'), false)
  assert.equal(serialized.includes('/Users/private'), false)
})

test('high-risk IPC audit wrapper records redacted failure metadata and rethrows', async () => {
  const { ipcMain, handlers } = createFakeIpcMain()
  const records: Array<{ category: string; action: string; details: Record<string, unknown> }> = []
  installHighRiskIpcAudit(ipcMain, {
    auditFn: (category: string, action: string, details: Record<string, unknown>) => {
      records.push({ category, action, details })
    },
  })

  ipcMain.handle('tool:open-external', async () => {
    throw new TypeError('private URL https://example.invalid/secret-token failed')
  })

  await assert.rejects(
    () => handlers.get('tool:open-external')?.(createEvent('http://127.0.0.1:47821/index.html'), {
      url: 'https://example.invalid/secret-token',
    }),
    /secret-token/,
  )

  assert.equal(records.length, 1)
  assert.equal(records[0]?.details.channel, 'tool:open-external')
  assert.equal(records[0]?.details.outcome, 'error')
  assert.equal(records[0]?.details.errorName, 'TypeError')
  assert.deepEqual(records[0]?.details.sender, { webContentsId: 42, originKind: 'local-dev' })

  const serialized = JSON.stringify(records)
  assert.equal(serialized.includes('secret-token'), false)
  assert.equal(serialized.includes('example.invalid'), false)
})

test('high-risk IPC audit wrapper is idempotent and skips low-risk channels', async () => {
  const { ipcMain, handlers } = createFakeIpcMain()
  const records: unknown[] = []
  const options = {
    auditFn: (...args: unknown[]) => {
      records.push(args)
    },
  }

  assert.deepEqual(installHighRiskIpcAudit(ipcMain, options), { installed: true })
  assert.deepEqual(installHighRiskIpcAudit(ipcMain, options), { installed: false })

  ipcMain.handle('runtime-state:get', () => ({ ok: true }))
  assert.deepEqual(await handlers.get('runtime-state:get')?.(createEvent()), { ok: true })
  assert.equal(records.length, 0)
})
