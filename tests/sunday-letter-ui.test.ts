import assert from 'node:assert/strict'
import { register } from 'node:module'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { saveLetter, type SavedLetter } from '../src/features/letter/letterStore.ts'
import { LETTER_STORE_STORAGE_KEY } from '../src/lib/storage/core.ts'
import type { AppSettings } from '../src/types/index.ts'

register(new URL('./helpers/tsx-test-loader.mjs', import.meta.url))
const { ChatSheetV2 } = await import('../src/features/uiV2/ChatSheetV2.tsx')
const { SundayLetterCard } = await import('../src/components/SundayLetterCard.tsx')
const { SundayLetterReader } = await import('../src/components/SundayLetterReader.tsx')
const { SundayLetterShelf } = await import('../src/components/SundayLetterShelf.tsx')
const { MemorySimplePage } = await import('../src/components/settingsSimple/MemorySimplePage.tsx')

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
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    },
    configurable: true,
    writable: true,
  })
  return store
}

function letter(overrides: Partial<SavedLetter> = {}): SavedLetter {
  return {
    id: 'letter-2026-06-07',
    letterDate: '2026-06-07',
    createdAt: '2026-06-07T12:00:00.000Z',
    personaId: 'xinghui',
    uiLanguage: 'zh-CN',
    content: {
      greeting: '这周过得真快。',
      summary: '你修好了台灯，也去看了那场展。',
      suggestion: '别把自己逼得太紧。',
      intention: '下周留一个晚上给自己。',
      experiment: '周三早点睡。',
      closing: '下周日见。',
    },
    weekDayCount: 4,
    themes: ['project'],
    readAt: null,
    ...overrides,
  }
}

const labels = {
  title: '对话',
  backToCompanion: '回到她身边',
  close: '关闭',
  userName: '你',
  messageList: '消息',
  messageInput: '说点什么',
  inputPlaceholder: '说点什么',
  send: '发送',
  emptyHistory: '还没有消息',
  emptyGuidance: '随便说一句',
  starterPrompts: ['今天怎么样', '在做什么'] as const,
  busyStatus: '正在想',
  errorTitle: '出错了',
  editRetry: '改一下再试',
  viewNewMessages: '有新消息',
  cancel: '停下',
}
 
function draft(): AppSettings {
  return {
    uiLanguage: 'zh-CN',
    memoryPaused: false,
    contextAwarenessEnabled: false,
    activeWindowContextEnabled: false,
    clipboardContextEnabled: false,
    screenContextEnabled: false,
    proactiveAgendaEnabled: false,
    proactiveFrequency: 'normal',
    proactiveLetterEnabled: true,
    proactiveLetterChoice: 'auto',
  } as unknown as AppSettings
}

test('V2 chat shows the gentle letter card with a read action', () => {
  const html = renderToStaticMarkup(React.createElement(ChatSheetV2, {
    messages: [],
    companionName: '星绘',
    inputValue: '',
    labels,
    onInputChange: () => undefined,
    onSend: () => undefined,
    busy: false,
    error: null,
    onCancel: () => undefined,
    onClose: () => undefined,
    letterNotice: {
      title: '她给你写了一封信',
      dateLabel: '2026年6月7日',
      preview: '这周过得真快。',
      actionLabel: '读这封信',
    },
    onOpenLetterNotice: () => undefined,
  }))

  assert.match(html, /她给你写了一封信/)
  assert.match(html, /这周过得真快。/)
  assert.match(html, /读这封信/)
})

test('letter card component is usable on its own', () => {
  const html = renderToStaticMarkup(React.createElement(SundayLetterCard, {
    notice: {
      title: 'She wrote you a letter',
      dateLabel: 'June 7, 2026',
      preview: 'This week went fast.',
      actionLabel: 'Read it',
    },
    onOpen: () => undefined,
  }))

  assert.match(html, /She wrote you a letter/)
  assert.match(html, /Read it/)
})

test('reader renders every letter paragraph and the date', () => {
  const html = renderToStaticMarkup(React.createElement(SundayLetterReader, {
    letter: letter(),
    uiLanguage: 'zh-CN',
    onClose: () => undefined,
  }))

  assert.match(html, /周日来信/)
  assert.match(html, /这周过得真快。/)
  assert.match(html, /你修好了台灯/)
  assert.match(html, /下周日见。/)
  assert.match(html, /2026年6月7日/)
})

test('shelf lists letters newest first with unread and read badges', () => {
  installStorage()
  const html = renderToStaticMarkup(React.createElement(SundayLetterShelf, {
    letters: [
      letter({ id: 'new', letterDate: '2026-06-14', readAt: null }),
      letter({ id: 'old', letterDate: '2026-06-07', readAt: '2026-06-08T09:00:00.000Z' }),
    ],
    uiLanguage: 'zh-CN',
    onClose: () => undefined,
  }))

  assert.match(html, /她写给你的信/)
  assert.match(html, /每周一封/)
  assert.match(html, /未读/)
  assert.match(html, /已读/)
  assert.match(html, /这周过得真快。/)
})

test('simple memory page shows the letter switch, unread count, and a re-readable list', () => {
  const store = installStorage()
  saveLetter(letter({ readAt: null }))
  assert.ok(store.get(LETTER_STORE_STORAGE_KEY))

  const html = renderToStaticMarkup(React.createElement(MemorySimplePage, {
    draft: draft(),
    setDraft: () => undefined,
    memories: [],
    dailyMemoryEntries: [],
    confirm: async () => true,
    onCommitMemoryPaused: () => undefined,
    onOpenAdvanced: () => undefined,
    onUpdateMemory: () => undefined,
    onRemoveMemory: () => undefined,
    onUpdateDailyEntry: () => undefined,
    onRemoveDailyEntry: () => undefined,
  }))

  assert.match(html, /周日来信/)
  assert.match(html, /她会在周日傍晚写一封短信/)
  assert.match(html, /1 封信 · 1 封未读/)
  assert.match(html, /读信/)
  assert.match(html, /未读/)
})
