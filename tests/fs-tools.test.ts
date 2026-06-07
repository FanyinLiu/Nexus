import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

import { executeFsTool } from '../src/features/agent/fsTools.ts'

beforeEach(() => {
  Object.defineProperty(globalThis, 'window', {
    value: {
      desktopPet: {},
    },
    configurable: true,
    writable: true,
  })
})

test('executeFsTool rejects empty paths before calling the workspace bridge', async () => {
  let readCalled = false
  window.desktopPet = {
    workspaceRead: async () => {
      readCalled = true
      return { path: '', content: '', truncated: false, bytes: 0 }
    },
  } as typeof window.desktopPet

  await assert.rejects(
    () => executeFsTool('fs_read', { path: '   ' }),
    /non-empty workspace-relative path/,
  )
  assert.equal(readCalled, false)
})

test('executeFsTool rejects traversal paths before calling the workspace bridge', async () => {
  let writeCalled = false
  window.desktopPet = {
    workspaceWrite: async () => {
      writeCalled = true
      return { path: '', bytes: 0 }
    },
  } as typeof window.desktopPet

  await assert.rejects(
    () => executeFsTool('fs_write', { path: '../escape.txt', content: 'x' }),
    /disallowed "\.\." traversal/,
  )
  assert.equal(writeCalled, false)
})
