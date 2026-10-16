import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { stripAliasCopies } from '../scripts/strip-uiohook-prebuild-aliases.cjs'

test('packaged uiohook keeps the napi binary Electron loads', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'uiohook-prebuild-'))
  try {
    const dir = path.join(root, 'linux-x64')
    mkdirSync(dir)
    writeFileSync(path.join(dir, 'uiohook-napi.node'), 'binary')
    writeFileSync(path.join(dir, 'node.napi.node'), 'binary')
    const removed = stripAliasCopies(root)
    assert.equal(existsSync(path.join(dir, 'node.napi.node')), true)
    assert.equal(existsSync(path.join(dir, 'uiohook-napi.node')), false)
    assert.equal(removed.length, 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
