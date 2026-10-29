import assert from 'node:assert/strict'
import { register } from 'node:module'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { createDreamDiaryEntry, saveDream } from '../src/features/dream/dreamDiaryStore.ts'

register(new URL('./helpers/tsx-test-loader.mjs', import.meta.url))
const { MemoryTimelineV3 } = await import('../src/features/settingsV3/MemoryTimelineV3.tsx')

function installStorage() {
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => { store.set(key, String(value)) },
        removeItem: (key: string) => { store.delete(key) },
        clear: () => { store.clear() },
      },
      dispatchEvent: () => true,
    },
    configurable: true,
    writable: true,
  })
}

test('a dream renders in the memory timeline as its own re-readable row', () => {
  installStorage()
  const entry = createDreamDiaryEntry({
    night: '2026-10-29',
    text: '书架里流出一条河，我把书页折成小船。',
    createdAt: new Date(2026, 9, 29, 23, 10).toISOString(),
  })
  assert.ok(entry)
  saveDream(entry)

  const html = renderToStaticMarkup(React.createElement(MemoryTimelineV3, {
    memories: [],
    dailyEntries: [],
    uiLanguage: 'zh-CN',
    memoryPaused: false,
    confirm: async () => true,
    onUpdateMemory: () => undefined,
    onRemoveMemory: () => undefined,
  }))

  assert.match(html, /她的梦/)
  assert.match(html, /书架里流出一条河/)
  assert.match(html, /删除/)
})
