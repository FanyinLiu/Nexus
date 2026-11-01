import assert from 'node:assert/strict'
import { test } from 'node:test'

import React from 'react'

import { useMemoryArchiveActions, type UseMemoryArchiveActionsOptions } from '../src/components/settingsDrawerHooks/useMemoryArchiveActions.ts'
import type { ConfirmFn } from '../src/components/useConfirm.ts'
import { t } from '../src/i18n/runtime.ts'
import { setConsolePassthrough } from '../src/lib/logger.ts'
import { purgeClearedMemories } from '../src/lib/storage/purgeMemoryStores.ts'
import type { DailyMemoryEntry, MemoryItem } from '../src/types/index.ts'

setConsolePassthrough(false)

type ReactInternals = { H: unknown }
const reactInternals = (React as unknown as {
  __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: ReactInternals
}).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE

type EffectSlot = { deps?: readonly unknown[]; cleanup?: () => void }

function createHookRenderer<P, R>(hookFn: (props: P) => R) {
  const slots: unknown[] = []
  const effects: EffectSlot[] = []
  let cursor = 0
  let pending: Array<{ index: number; callback: () => void | (() => void) }> = []

  const dispatcher = {
    useState(initial: unknown) {
      const index = cursor++
      if (!(index in slots)) {
        slots[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial
      }
      const setState = (value: unknown) => {
        slots[index] = typeof value === 'function'
          ? (value as (prev: unknown) => unknown)(slots[index])
          : value
      }
      return [slots[index], setState]
    },
    useRef(initial: unknown) {
      const index = cursor++
      if (!(index in slots)) slots[index] = { current: initial }
      return slots[index]
    },
    useContext() {
      cursor++
      return null
    },
    useCallback(fn: unknown) {
      cursor++
      return fn
    },
    useMemo(fn: () => unknown) {
      cursor++
      return fn()
    },
    useEffect(callback: () => void | (() => void), deps?: readonly unknown[]) {
      const index = cursor++
      const prev = effects[index]
      const changed = !prev
        || deps === undefined
        || prev.deps === undefined
        || deps.length !== prev.deps.length
        || deps.some((dep, i) => !Object.is(dep, prev.deps![i]))
      if (changed) {
        effects[index] = { deps }
        pending.push({ index, callback })
      }
    },
  }

  function render(props: P): R {
    cursor = 0
    pending = []
    reactInternals.H = dispatcher
    let result: R
    try {
      result = hookFn(props)
    } finally {
      reactInternals.H = null
    }
    for (const { index, callback } of pending) {
      const slot = effects[index]
      slot.cleanup?.()
      const cleanup = callback()
      slot.cleanup = typeof cleanup === 'function' ? cleanup : undefined
    }
    return result
  }

  function unmount() {
    for (const effect of effects) effect?.cleanup?.()
  }

  return { render, unmount }
}

type WindowOptions = {
  inboxEntries?: string[]
  inboxReadFails?: boolean
}

function installWindow(options: WindowOptions = {}) {
  const inboxEntries = [...(options.inboxEntries ?? [])]
  const vectorClearPayloads: Array<{ needles?: string[] }> = []
  const storage = new Map<string, string>()
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, String(value)) },
    removeItem: (key: string) => { storage.delete(key) },
    clear: () => { storage.clear() },
  }
  const bridge = {
    listProactiveInbox: async () => {
      if (options.inboxReadFails) throw new Error('inbox read failed')
      return { entries: inboxEntries.map((id) => ({ id })), unreadCount: 0, removedIds: [] }
    },
    memoryVectorClear: async (payload?: { needles?: string[] }) => {
      vectorClearPayloads.push(payload ?? {})
      inboxEntries.length = 0
      return { ok: true, removed: 0, localDataCleared: true, snapshotMemoryFilesRemoved: 0 }
    },
  }
  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage,
      dispatchEvent: () => true,
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      desktopPet: bridge,
    },
    configurable: true,
    writable: true,
  })
  return { inboxEntries, vectorClearPayloads }
}

function confirmRecorder(accepted = true) {
  const calls: Array<{ message: string; tone?: 'danger' | 'default' }> = []
  const confirm: ConfirmFn = async (options) => {
    calls.push({ message: options.message, tone: options.tone })
    return accepted
  }
  return { confirm, calls }
}

function makeOptions(
  confirm: ConfirmFn,
  overrides: Partial<UseMemoryArchiveActionsOptions> = {},
): UseMemoryArchiveActionsOptions {
  return {
    memories: [] as MemoryItem[],
    dailyMemoryEntries: [] as DailyMemoryEntry[],
    confirm,
    onExportMemoryArchive: async () => ({ canceled: true, message: '' }),
    onImportMemoryArchive: async () => ({ canceled: true, message: '' }),
    onClearMemoryArchive: async () => {
      await purgeClearedMemories([], {})
      return { canceled: false, message: 'cleared' }
    },
    ...overrides,
  }
}

test('an inbox entry makes the clear run and reach memory:clear-user-data with no memories', async () => {
  const harness = installWindow({ inboxEntries: ['msg-1'] })
  const { confirm, calls } = confirmRecorder()
  const renderer = createHookRenderer(useMemoryArchiveActions)
  try {
    const options = makeOptions(confirm)
    const result = renderer.render(options)
    await result.handleClearMemoryArchive()

    assert.equal(calls.length, 1)
    assert.equal(calls[0]?.tone, 'danger')
    assert.equal(harness.vectorClearPayloads.length, 1)
    assert.deepEqual(harness.vectorClearPayloads[0]?.needles, [])
    assert.deepEqual(harness.inboxEntries, [])
    const after = renderer.render(options)
    assert.deepEqual(after.memoryClearStatus, { ok: true, message: 'cleared', tone: 'success' })
    assert.equal(after.memoryClearStatus?.message === t('settings.memory.clear_empty_hint'), false)
  } finally {
    renderer.unmount()
    delete (globalThis as { window?: unknown }).window
  }
})

test('all three stores empty show the clear-section hint and skip the clear IPC', async () => {
  const harness = installWindow({ inboxEntries: [] })
  const { confirm, calls } = confirmRecorder()
  let clearCalls = 0
  const renderer = createHookRenderer(useMemoryArchiveActions)
  try {
    const options = makeOptions(confirm, {
      onClearMemoryArchive: async () => {
        clearCalls += 1
        return { canceled: false, message: 'should not run' }
      },
    })
    const result = renderer.render(options)
    await result.handleClearMemoryArchive()

    assert.equal(clearCalls, 0)
    assert.equal(calls.length, 0)
    assert.deepEqual(harness.vectorClearPayloads, [])
    const after = renderer.render(options)
    assert.deepEqual(after.memoryClearStatus, {
      ok: false,
      message: t('settings.memory.clear_empty_hint'),
      tone: 'info',
    })
  } finally {
    renderer.unmount()
    delete (globalThis as { window?: unknown }).window
  }
})

test('a failed clear shows only the localized clear error and leaves the archive status untouched', async () => {
  installWindow({ inboxEntries: ['msg-1'] })
  const { confirm } = confirmRecorder()
  const renderer = createHookRenderer(useMemoryArchiveActions)
  try {
    const options = makeOptions(confirm, {
      onExportMemoryArchive: async () => ({ canceled: false, message: 'exported' }),
      onClearMemoryArchive: async () => {
        throw new Error('ENOENT /Users/x/secret')
      },
    })
    // Seed the export/import status so the assertion proves the clear path
    // does not overwrite it.
    await renderer.render(options).handleExportMemoryArchive()
    const afterExport = renderer.render(options)
    assert.deepEqual(afterExport.memoryArchiveStatus, { ok: true, message: 'exported' })

    await afterExport.handleClearMemoryArchive()
    const after = renderer.render(options)
    assert.deepEqual(after.memoryClearStatus, {
      ok: false,
      message: t('settings.memory.clear_error'),
      tone: 'error',
    })
    const shown = after.memoryClearStatus?.message ?? ''
    assert.equal(shown.includes('ENOENT'), false)
    assert.equal(shown.includes('secret'), false)
    assert.equal(shown.includes('/Users'), false)
    assert.deepEqual(after.memoryArchiveStatus, { ok: true, message: 'exported' })
  } finally {
    renderer.unmount()
    delete (globalThis as { window?: unknown }).window
  }
})

test('a failed inbox read is treated as may-have-content and the clear still runs', async () => {
  const harness = installWindow({ inboxReadFails: true })
  const { confirm, calls } = confirmRecorder()
  const renderer = createHookRenderer(useMemoryArchiveActions)
  try {
    const options = makeOptions(confirm)
    const result = renderer.render(options)
    await result.handleClearMemoryArchive()

    assert.equal(calls.length, 1)
    assert.equal(harness.vectorClearPayloads.length, 1)
    const after = renderer.render(options)
    assert.deepEqual(after.memoryClearStatus, { ok: true, message: 'cleared', tone: 'success' })
  } finally {
    renderer.unmount()
    delete (globalThis as { window?: unknown }).window
  }
})
