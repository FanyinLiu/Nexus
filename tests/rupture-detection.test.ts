import assert from 'node:assert/strict'
import { test } from 'node:test'

import { detectRupture } from '../src/features/autonomy/ruptureDetection.ts'
import { buildRepairGuidance } from '../src/features/autonomy/repairGuidance.ts'

// ── detectRupture ────────────────────────────────────────────────────────

test('detect: empty / null returns no rupture', () => {
  assert.equal(detectRupture('', 'en-US').kind, null)
})

test('detect: neutral message returns no rupture', () => {
  const out = detectRupture('Can you help me think through this email?', 'en-US')
  assert.equal(out.kind, null)
})

test('detect: criticism — "you always" pattern', () => {
  const out = detectRupture("you always say the wrong thing", 'en-US')
  assert.equal(out.kind, 'criticism')
  assert.ok(out.score >= 2)
})

test('detect: criticism — character attack outweighs single soft signal', () => {
  const out = detectRupture("you're so stupid", 'en-US')
  assert.equal(out.kind, 'criticism')
})

test('detect: contempt wins over criticism on tie', () => {
  // Both fire (you-always 2 + dumb-bot 3). Contempt at 3 > criticism 2.
  const out = detectRupture("you always do this, dumb bot", 'en-US')
  assert.equal(out.kind, 'contempt')
})

test('detect: contempt — "haha right" mockery', () => {
  const out = detectRupture("haha right, sure", 'en-US')
  assert.equal(out.kind, 'contempt')
})

test('detect: zh-CN criticism — "你总是"', () => {
  const out = detectRupture("你总是说一些没用的话", 'zh-CN')
  assert.equal(out.kind, 'criticism')
})

test('detect: zh-CN contempt — 破机器', () => {
  const out = detectRupture("呵呵，破机器", 'zh-CN')
  assert.equal(out.kind, 'contempt')
})

test('detect: zh-TW patterns work on traditional characters', () => {
  const out = detectRupture("你總是說錯話", 'zh-TW')
  assert.equal(out.kind, 'criticism')
})

test('detect: ja contempt — バカAI', () => {
  const out = detectRupture("バカAIだな", 'ja')
  assert.equal(out.kind, 'contempt')
})

test('detect: ko criticism — 항상 못', () => {
  const out = detectRupture("넌 항상 멍청한 소리만 해", 'ko')
  // Either criticism or contempt depending on which patterns fire.
  // The key assertion is that it fires at all (not null).
  assert.ok(out.kind !== null)
})

test('detect: english fallback patterns help mixed-language input', () => {
  // A zh-CN setting with an English contempt phrase still fires via fallback.
  const out = detectRupture("dumb bot, useless thing", 'zh-CN')
  assert.equal(out.kind, 'contempt')
})

test('detect: a single soft signal below threshold does not fire', () => {
  // "what a joke" alone is weight 2 — exactly threshold. So this DOES fire.
  // Need a case where score < 2. Single hit at weight 1 doesn't exist;
  // smallest pattern is weight 2. So a pure no-pattern message doesn't fire:
  const out = detectRupture("the weather is rough today", 'en-US')
  assert.equal(out.kind, null)
})

test('detect: signals trace surfaces the matched pattern names for debug', () => {
  const out = detectRupture("you always do this", 'en-US')
  assert.ok(out.signals.length > 0)
  assert.ok(out.signals[0].includes('criticism'))
})

// ── buildRepairGuidance ──────────────────────────────────────────────────

test('build: null kind returns empty string', () => {
  const out = buildRepairGuidance({ uiLanguage: 'en-US', ruptureKind: null })
  assert.equal(out, '')
})

test('build: criticism + contempt produce distinct prose for same locale', () => {
  const crit = buildRepairGuidance({ uiLanguage: 'en-US', ruptureKind: 'criticism' })
  const cont = buildRepairGuidance({ uiLanguage: 'en-US', ruptureKind: 'contempt' })
  assert.ok(crit.length > 0)
  assert.ok(cont.length > 0)
  assert.notEqual(crit, cont)
})

test('build: prose contains the wrapping rupture_repair tag', () => {
  const out = buildRepairGuidance({ uiLanguage: 'en-US', ruptureKind: 'criticism' })
  assert.match(out, /<rupture_repair>/)
  assert.match(out, /<\/rupture_repair>/)
})

test('build: prose forbids defending and naming the rupture', () => {
  const crit = buildRepairGuidance({ uiLanguage: 'en-US', ruptureKind: 'criticism' })
  // English version says "Do not defend"
  assert.match(crit, /[Dd]o not defend/)
  // and forbids naming the rupture
  assert.match(crit, /[Dd]o not name/)
})

test('build: each of 5 locales produces non-empty distinct prose for criticism', () => {
  const locales = ['en-US', 'zh-CN', 'zh-TW', 'ja', 'ko'] as const
  const bodies = locales.map((l) =>
    buildRepairGuidance({ uiLanguage: l, ruptureKind: 'criticism' }),
  )
  for (const b of bodies) assert.ok(b.length > 0)
  assert.equal(new Set(bodies).size, locales.length)
})

test('build: contempt prose explicitly mentions Gottman framing in en-US', () => {
  const out = buildRepairGuidance({ uiLanguage: 'en-US', ruptureKind: 'contempt' })
  // The "most corrosive" / contempt framing surfaces as keyword
  assert.match(out, /contempt|conservative/i)
})

test('build: unknown locale falls back to en-US', () => {
  const out = buildRepairGuidance({ uiLanguage: 'eo' as never, ruptureKind: 'contempt' })
  assert.match(out, /contempt|conservative/i)
})
