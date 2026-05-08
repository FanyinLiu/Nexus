import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  isLorebookEntryReady,
  normalizeLorebookKeywords,
  resolveLorebookEntryGuide,
  resolveLorebookSettingsSummary,
  resolveLorebookTriggerPreview,
} from '../src/features/lorebooks/lorebookSettingsView.ts'
import { zhCNMessages } from '../src/i18n/locales/zh-CN.ts'
import type { LorebookEntry } from '../src/types/lorebooks.ts'

function entry(overrides: Partial<LorebookEntry>): LorebookEntry {
  return {
    id: overrides.id ?? 'lore-a',
    label: overrides.label ?? '设定',
    keywords: overrides.keywords ?? ['妈妈'],
    content: overrides.content ?? '用户的母亲姓张。',
    enabled: overrides.enabled ?? true,
    priority: overrides.priority ?? 0,
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-01-01T00:00:00.000Z',
  }
}

test('normalizeLorebookKeywords supports common Chinese and English separators', () => {
  assert.deepEqual(
    normalizeLorebookKeywords('妈妈, 我妈、张老师； mom ;  '),
    ['妈妈', '我妈', '张老师', 'mom'],
  )
})

test('isLorebookEntryReady requires enabled state, trigger words and content', () => {
  assert.equal(isLorebookEntryReady(entry({})), true)
  assert.equal(isLorebookEntryReady(entry({ enabled: false })), false)
  assert.equal(isLorebookEntryReady(entry({ keywords: [] })), false)
  assert.equal(isLorebookEntryReady(entry({ content: '  ' })), false)
})

test('resolveLorebookEntryGuide describes what is missing before an entry can fire', () => {
  assert.equal(resolveLorebookEntryGuide(entry({})).helperKey, 'settings.lorebooks.entry_hint_ready')
  assert.equal(
    resolveLorebookEntryGuide(entry({ keywords: [], content: '' })).helperKey,
    'settings.lorebooks.entry_hint_missing_both',
  )
  assert.equal(
    resolveLorebookEntryGuide(entry({ keywords: [] })).helperKey,
    'settings.lorebooks.entry_hint_missing_keywords',
  )
  assert.equal(
    resolveLorebookEntryGuide(entry({ content: '' })).helperKey,
    'settings.lorebooks.entry_hint_missing_content',
  )
  assert.equal(
    resolveLorebookEntryGuide(entry({ enabled: false })).helperKey,
    'settings.lorebooks.entry_hint_disabled',
  )
})

test('resolveLorebookSettingsSummary separates ready, disabled and incomplete entries', () => {
  const summary = resolveLorebookSettingsSummary([
    entry({ id: 'ready' }),
    entry({ id: 'disabled', enabled: false }),
    entry({ id: 'missing-keywords', keywords: [] }),
    entry({ id: 'missing-content', content: '' }),
  ])

  assert.equal(summary.totalCount, 4)
  assert.equal(summary.readyCount, 1)
  assert.equal(summary.disabledCount, 1)
  assert.equal(summary.incompleteCount, 2)
  assert.equal(summary.maxPerTurn, 6)
  assert.equal(summary.scanWindowMessages, 4)
})

test('resolveLorebookTriggerPreview shows which entries would affect the next reply', () => {
  const preview = resolveLorebookTriggerPreview([
    entry({ id: 'nexus', label: 'Nexus 项目', keywords: ['Nexus', '设置页'], priority: 2 }),
    entry({ id: 'mom', label: '妈妈', keywords: ['妈妈'], priority: 5 }),
    entry({ id: 'disabled', label: '停用', keywords: ['Nexus'], enabled: false }),
    entry({ id: 'empty', label: '空内容', keywords: ['Nexus'], content: '' }),
  ], 'Nexus 的设置页应该怎么改？')

  assert.deepEqual(
    preview.matches.map((match) => match.entry.id),
    ['nexus'],
  )
  assert.deepEqual(preview.matches[0].matchedKeywords, ['Nexus', '设置页'])
})

test('resolveLorebookTriggerPreview sorts by priority then specificity', () => {
  const preview = resolveLorebookTriggerPreview([
    entry({ id: 'specific', label: '设置页', keywords: ['设置页'], priority: 1 }),
    entry({ id: 'high-priority', label: 'Nexus', keywords: ['Nexus'], priority: 8 }),
  ], 'Nexus 设置页')

  assert.deepEqual(
    preview.matches.map((match) => match.entry.id),
    ['high-priority', 'specific'],
  )
})

test('zh-CN labels frame lorebooks as usable context, not an abstract lore shelf', () => {
  assert.equal(zhCNMessages['settings.lorebooks.title'], '背景与常用表达')
  assert.match(zhCNMessages['settings.lorebooks.note'], /常用词/)
  assert.equal(zhCNMessages['settings.lorebooks.preview_title'], '试一句话')
})
