import assert from 'node:assert/strict'
import { register } from 'node:module'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { resolveChatMemoryTraceDetails } from '../src/features/memory/traceDetails.ts'
import type { AppSettings, DailyMemoryEntry, MemoryItem } from '../src/types/index.ts'

// The settings card imports a stylesheet and uses JSX, which type-stripping
// does not transform. The loader turns CSS into an empty module and compiles
// TSX with the repo's TypeScript.
register(new URL('./helpers/tsx-test-loader.mjs', import.meta.url))
const { MemorySimplePage } = await import('../src/components/settingsSimple/MemorySimplePage.tsx')
const { ChatSheetV2 } = await import('../src/features/uiV2/ChatSheetV2.tsx')

const NOW = new Date()
const YESTERDAY = new Date(NOW.getTime() - 86_400_000)

function memory(id: string, content: string, createdAt: Date): MemoryItem {
  return {
    id,
    content,
    category: 'profile',
    source: 'chat',
    createdAt: createdAt.toISOString(),
  }
}

function diary(id: string, content: string, createdAt: Date): DailyMemoryEntry {
  return {
    id,
    day: createdAt.toISOString().slice(0, 10),
    role: 'user',
    content,
    source: 'chat',
    createdAt: createdAt.toISOString(),
  }
}

function draft(paused: boolean): AppSettings {
  return {
    uiLanguage: 'zh-CN',
    memoryPaused: paused,
    contextAwarenessEnabled: false,
    activeWindowContextEnabled: false,
    clipboardContextEnabled: false,
    screenContextEnabled: false,
    proactiveAgendaEnabled: false,
    proactiveFrequency: 'normal',
  } as unknown as AppSettings
}

function renderCard(input: {
  paused: boolean
  memories: readonly MemoryItem[]
  dailyMemoryEntries: readonly DailyMemoryEntry[]
}) {
  return renderToStaticMarkup(React.createElement(MemorySimplePage, {
    draft: draft(input.paused),
    setDraft: () => undefined,
    memories: input.memories,
    dailyMemoryEntries: input.dailyMemoryEntries,
    confirm: async () => true,
    onCommitMemoryPaused: () => undefined,
    onOpenAdvanced: () => undefined,
    onUpdateMemory: () => undefined,
    onRemoveMemory: () => undefined,
    onUpdateDailyEntry: () => undefined,
    onRemoveDailyEntry: () => undefined,
  }))
}

test('remembered card shows a paused empty state instead of old items', () => {
  const html = renderCard({
    paused: true,
    memories: [memory('m1', '你下周三有面试', NOW)],
    dailyMemoryEntries: [],
  })

  assert.match(html, /她记得的你/)
  assert.match(html, /记忆先停着。打开上面的开关，她才会重新记起你。/)
  assert.doesNotMatch(html, /你下周三有面试/)
  assert.doesNotMatch(html, /看看全部/)
})

test('remembered card shows an empty state before anything is remembered', () => {
  const html = renderCard({ paused: false, memories: [], dailyMemoryEntries: [] })

  assert.match(html, /她记得的你/)
  assert.match(html, /她还没记住什么。多聊几句，这里会慢慢长出来。/)
  assert.doesNotMatch(html, /看看全部/)
})

test('remembered card shows the count, latest items, and an open action', () => {
  const html = renderCard({
    paused: false,
    memories: [
      memory('m1', '你下周三有面试', NOW),
      memory('m2', '你喜欢喝热美式', YESTERDAY),
    ],
    dailyMemoryEntries: [diary('d1', '今天聊到了搬家', NOW)],
  })

  assert.match(html, /她记着 3 件事/)
  assert.match(html, /你下周三有面试/)
  assert.match(html, /今天聊到了搬家/)
  assert.match(html, /看看全部/)
  assert.doesNotMatch(html, /她还没记住什么/)
})

test('V2 chat trace disclosure expands to the recalled excerpts and manage link', () => {
  const details = resolveChatMemoryTraceDetails({
    trace: {
      status: 'active',
      searchModeUsed: 'keyword',
      vectorSearchAvailable: false,
      longTermIds: ['m1'],
      dailyEntryIds: ['d1'],
      semanticIds: [],
    },
    memories: [memory('m1', '你下周三有面试', NOW)],
    dailyMemories: { [NOW.toISOString().slice(0, 10)]: [diary('d1', '今天聊到了搬家', NOW)] },
  })
  assert.ok(details)

  const html = renderToStaticMarkup(React.createElement(ChatSheetV2, {
    messages: [{
      id: 'a1',
      role: 'assistant',
      content: '我记着呢。',
      memoryTraceLabel: '用到了 2 条记忆',
      memoryTraceDetails: details,
    }],
    companionName: '星绘',
    inputValue: '',
    labels: {
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
      starterPrompts: ['今天怎么样', '在做什么'],
      busyStatus: '正在想',
      errorTitle: '出错了',
      editRetry: '改一下再试',
      viewNewMessages: '有新消息',
      cancel: '停下',
    },
    onInputChange: () => undefined,
    onSend: () => undefined,
    busy: false,
    error: null,
    onCancel: () => undefined,
    onClose: () => undefined,
    onOpenMemorySettings: () => undefined,
  }))

  assert.match(html, /<details/)
  assert.match(html, /用到了 2 条记忆/)
  assert.match(html, /你下周三有面试/)
  assert.match(html, /今天聊到了搬家/)
  assert.match(html, /管理记忆/)
})
