import assert from 'node:assert/strict'
import { test } from 'node:test'

import { getChatPromptStrings } from '../src/features/chat/prompts/index.ts'
import type { CompanionRelationshipType, UiLanguage } from '../src/types/app.ts'

const LOCALES: UiLanguage[] = ['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko']

test('relationshipTypeBias: open_ended returns empty string in every locale', () => {
  for (const locale of LOCALES) {
    const prompts = getChatPromptStrings(locale)
    assert.equal(prompts.relationshipTypeBias('open_ended'), '', `expected empty for ${locale}`)
  }
})

test('relationshipTypeBias: friend / mentor / quiet_companion produce non-empty distinct strings', () => {
  const types: CompanionRelationshipType[] = ['friend', 'mentor', 'quiet_companion']
  for (const locale of LOCALES) {
    const prompts = getChatPromptStrings(locale)
    const seen = new Set<string>()
    for (const t of types) {
      const out = prompts.relationshipTypeBias(t)
      assert.ok(out.length > 10, `${locale}/${t} should produce a non-trivial string`)
      assert.ok(!seen.has(out), `${locale}/${t} should differ from earlier types`)
      seen.add(out)
    }
  }
})
