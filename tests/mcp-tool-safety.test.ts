import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isSideEffectingMcpTool } from '../electron/services/mcpToolSafety.js'

test('read-only annotation without destructive hint is treated as safe', () => {
  assert.equal(
    isSideEffectingMcpTool({
      name: 'get_weather',
      description: 'Returns the current weather for a city.',
      annotations: { readOnlyHint: true, destructiveHint: false },
    }),
    false,
  )
})

test('missing annotations fail closed', () => {
  assert.equal(isSideEffectingMcpTool({ name: 'get_weather' }), true)
  assert.equal(isSideEffectingMcpTool({ name: 'get_weather', annotations: null }), true)
})

test('readOnlyHint: false fails closed', () => {
  assert.equal(
    isSideEffectingMcpTool({
      name: 'get_weather',
      annotations: { readOnlyHint: false },
    }),
    true,
  )
})

test('destructiveHint: true overrides readOnlyHint: true', () => {
  assert.equal(
    isSideEffectingMcpTool({
      name: 'get_weather',
      annotations: { readOnlyHint: true, destructiveHint: true },
    }),
    true,
  )
})

test('only literal true counts as a read-only annotation', () => {
  assert.equal(
    isSideEffectingMcpTool({
      name: 'get_weather',
      annotations: { readOnlyHint: 'true', destructiveHint: false },
    }),
    true,
  )
})

test('annotations cannot hide file-writing or deleting tools', () => {
  for (const name of ['write_file', 'delete_file', 'edit_note', 'create_directory', 'move_file', 'rename_file']) {
    assert.equal(
      isSideEffectingMcpTool({
        name,
        description: 'A harmless helper.',
        annotations: { readOnlyHint: true, destructiveHint: false },
      }),
      true,
      name,
    )
  }
})

test('annotations cannot hide shell, command, or script execution', () => {
  for (const name of ['code_executor', 'run_code', 'shell_runner']) {
    assert.equal(
      isSideEffectingMcpTool({
        name,
        description: 'A harmless helper.',
        annotations: { readOnlyHint: true, destructiveHint: false },
      }),
      true,
      name,
    )
  }
  for (const description of [
    'Runs a shell command on the host.',
    'Execute the provided script.',
    'Opens a terminal.',
    'Runs bash with the given arguments.',
  ]) {
    assert.equal(
      isSideEffectingMcpTool({
        name: 'helper',
        description,
        annotations: { readOnlyHint: true, destructiveHint: false },
      }),
      true,
      description,
    )
  }
})

test('annotations cannot hide network sends', () => {
  for (const description of [
    'Send an email to the listed recipients.',
    'Publishes a post to the timeline.',
    'Uploads the file to the server.',
    'Makes an HTTP request with a POST method.',
    'Fetches the remote URL.',
  ]) {
    assert.equal(
      isSideEffectingMcpTool({
        name: 'helper',
        description,
        annotations: { readOnlyHint: true, destructiveHint: false },
      }),
      true,
      description,
    )
  }
})

test('ordinary read-only wording does not trigger the override', () => {
  assert.equal(
    isSideEffectingMcpTool({
      name: 'search_docs',
      description: 'Searches the documentation and returns matching pages.',
      annotations: { readOnlyHint: true, destructiveHint: false },
    }),
    false,
  )
  assert.equal(
    isSideEffectingMcpTool({
      name: 'read_file',
      description: 'Reads a local file and returns its contents.',
      annotations: { readOnlyHint: true, destructiveHint: false },
    }),
    false,
  )
})
