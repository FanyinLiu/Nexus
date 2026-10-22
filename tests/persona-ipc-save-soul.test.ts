import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { register } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { PERSONA_SOUL_MAX_CHARS } from '../shared/personaSoul.js'

register(new URL('./helpers/persona-ipc-electron-stub.mjs', import.meta.url))

type SaveHandler = (event: unknown, payload: unknown) => Promise<{ ok: boolean }>

const handlers = new Map<string, SaveHandler>()
let registered = false

async function handler(): Promise<SaveHandler> {
  if (!registered) {
    const personaIpc = await import('../electron/ipc/personaIpc.js')
    personaIpc.register()
    const stored = (globalThis as { __nexusPersonaIpcHandlers?: Map<string, SaveHandler> }).__nexusPersonaIpcHandlers
    const save = stored?.get('persona:save-soul')
    assert.equal(typeof save, 'function')
    handlers.set('persona:save-soul', save as SaveHandler)
    registered = true
  }
  const save = handlers.get('persona:save-soul')
  if (!save) throw new Error('persona:save-soul handler was not registered')
  return save
}

function useUserData(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'nexus-persona-ipc-'))
  ;(globalThis as { __nexusPersonaIpcUserData?: string }).__nexusPersonaIpcUserData = dir
  return dir
}

async function entries(dir: string): Promise<string[]> {
  try {
    return await readdir(dir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

test('persona:save-soul rejects non-string content and does not write', async () => {
  const dir = useUserData()
  const save = await handler()
  try {
    assert.deepEqual(await save({}, { content: 12 }), { ok: false })
    assert.deepEqual(await save({}, { content: { text: 'nope' } }), { ok: false })
    assert.deepEqual(await save({}, { content: ['nope'] }), { ok: false })
    assert.deepEqual(await entries(dir), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('persona:save-soul rejects an unsafe profile id and does not write the global file', async () => {
  const dir = useUserData()
  const save = await handler()
  try {
    assert.deepEqual(await save({}, { content: 'pwned', profileId: '../etc' }), { ok: false })
    assert.deepEqual(await save({}, { content: 'pwned', profileId: 4 }), { ok: false })
    assert.deepEqual(await entries(dir), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('persona:save-soul rejects oversized content and still accepts an empty clear', async () => {
  const dir = useUserData()
  const save = await handler()
  try {
    const oversized = await save({}, { content: 'x'.repeat(PERSONA_SOUL_MAX_CHARS + 1) })
    assert.deepEqual(oversized, { ok: false })
    assert.deepEqual(await entries(dir), [])

    assert.deepEqual(await save({}, { content: '' }), { ok: true })
    assert.equal(await readFile(path.join(dir, 'persona', 'SOUL.md'), 'utf8'), '')

    assert.deepEqual(await save({}, { content: 'kept-soul' }), { ok: true })
    assert.equal(await readFile(path.join(dir, 'persona', 'SOUL.md'), 'utf8'), 'kept-soul')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
