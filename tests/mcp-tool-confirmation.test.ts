import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildMcpToolCallApprovalDialogOptions,
  confirmMcpToolCall,
  formatMcpToolArgumentsForApproval,
  runConfirmedMcpToolCall,
} from '../electron/services/mcpToolConfirmation.js'
import { isMcpToolNotAllowedError } from '../shared/mcpToolErrors.js'

type DialogResult = { response?: number }

const PARENT = { id: 'window-1' }

function allowOnce(): Promise<DialogResult> {
  return Promise.resolve({ response: 1 })
}

const SIDE_EFFECTING_TOOL = {
  name: 'write_file',
  description: 'Writes a file to disk.',
  annotations: null,
}

test('dialog options show server, tool, pretty arguments, deny default, and no always-allow', () => {
  const options = buildMcpToolCallApprovalDialogOptions({
    serverId: 'plugin:files',
    toolName: 'write_file',
    toolArgs: { path: '/tmp/a.txt', contents: 'hello' },
    locale: 'en-US',
  })

  assert.match(options.message, /write_file/)
  assert.match(options.message, /plugin:files/)
  assert.match(options.detail, /"path": "\/tmp\/a\.txt"/)
  assert.match(options.detail, /"contents": "hello"/)
  assert.equal(options.defaultId, 0)
  assert.equal(options.cancelId, 0)
  assert.equal(options.buttons.length, 2)
  assert.equal(options.buttons[0], "Don't allow")
  assert.equal(options.buttons[1], 'Allow once')
  assert.equal(options.buttons.some((label) => /always/i.test(label)), false)
})

test('argument display is pretty-printed and truncated to a safe length', () => {
  assert.equal(formatMcpToolArgumentsForApproval({ a: 1 }), '{\n  "a": 1\n}')
  const huge = formatMcpToolArgumentsForApproval({ value: 'x'.repeat(10_000) }, 200)
  assert.ok(huge.length <= 200)
  assert.match(huge, /truncated/)
})

test('a thrown dialog refuses the call', async () => {
  const allowed = await confirmMcpToolCall({
    serverId: 'srv',
    toolName: 'write_file',
    toolArgs: {},
    locale: 'en-US',
    isHeadless: false,
    getParentWindow: () => PARENT,
    showMessageBox: async () => {
      throw new Error('dialog unavailable')
    },
  })

  assert.equal(allowed, false)
})

test('no focused window refuses the call without showing a dialog', async () => {
  let shown = 0
  const allowed = await confirmMcpToolCall({
    serverId: 'srv',
    toolName: 'write_file',
    toolArgs: {},
    locale: 'en-US',
    isHeadless: false,
    getParentWindow: () => null,
    showMessageBox: async () => {
      shown += 1
      return { response: 1 }
    },
  })

  assert.equal(allowed, false)
  assert.equal(shown, 0)
})

test('a window lookup error refuses the call', async () => {
  const allowed = await confirmMcpToolCall({
    serverId: 'srv',
    toolName: 'write_file',
    toolArgs: {},
    locale: 'en-US',
    isHeadless: false,
    getParentWindow: () => {
      throw new Error('window manager unavailable')
    },
    showMessageBox: allowOnce,
  })

  assert.equal(allowed, false)
})

test('cancel, close, and unknown responses all refuse the call', async () => {
  for (const result of [{ response: 0 }, { response: 2 }, { response: -1 }, {}]) {
    const allowed = await confirmMcpToolCall({
      serverId: 'srv',
      toolName: 'write_file',
      toolArgs: {},
      locale: 'en-US',
      isHeadless: false,
      getParentWindow: () => PARENT,
      showMessageBox: async () => result,
    })
    assert.equal(allowed, false, JSON.stringify(result))
  }
})

test('headless/smoke/test mode refuses without a dialog', async () => {
  let shown = 0
  const allowed = await confirmMcpToolCall({
    serverId: 'srv',
    toolName: 'write_file',
    toolArgs: {},
    locale: 'en-US',
    isHeadless: true,
    getParentWindow: () => PARENT,
    showMessageBox: async () => {
      shown += 1
      return { response: 1 }
    },
  })

  assert.equal(allowed, false)
  assert.equal(shown, 0)
})

test('allow once runs the call; every call prompts again', async () => {
  let prompts = 0
  let calls = 0
  const options = {
    serverId: 'srv',
    toolName: 'write_file',
    toolArgs: { path: '/tmp/a.txt' },
    toolMeta: SIDE_EFFECTING_TOOL,
    locale: 'en-US',
    isHeadless: false,
    getParentWindow: () => PARENT,
    showMessageBox: async () => {
      prompts += 1
      return { response: 1 }
    },
    call: async () => {
      calls += 1
      return 'done'
    },
  }

  assert.equal(await runConfirmedMcpToolCall(options), 'done')
  assert.equal(await runConfirmedMcpToolCall(options), 'done')
  assert.equal(prompts, 2)
  assert.equal(calls, 2)
})

test('a refused side-effecting call throws a stable code and never runs', async () => {
  let calls = 0
  await assert.rejects(
    runConfirmedMcpToolCall({
      serverId: 'srv',
      toolName: 'write_file',
      toolArgs: {},
      toolMeta: SIDE_EFFECTING_TOOL,
      locale: 'en-US',
      isHeadless: false,
      getParentWindow: () => PARENT,
      showMessageBox: async () => ({ response: 0 }),
      call: async () => {
        calls += 1
        return 'done'
      },
    }),
    (error: unknown) => isMcpToolNotAllowedError(error),
  )
  assert.equal(calls, 0)
})

test('read-only annotated tools run without a prompt', async () => {
  let prompts = 0
  let calls = 0
  const result = await runConfirmedMcpToolCall({
    serverId: 'srv',
    toolName: 'get_weather',
    toolArgs: {},
    toolMeta: {
      name: 'get_weather',
      description: 'Returns the current weather.',
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    locale: 'en-US',
    isHeadless: false,
    getParentWindow: () => PARENT,
    showMessageBox: async () => {
      prompts += 1
      return { response: 0 }
    },
    call: async () => {
      calls += 1
      return 'sunny'
    },
  })

  assert.equal(result, 'sunny')
  assert.equal(prompts, 0)
  assert.equal(calls, 1)
})
