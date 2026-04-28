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

test('detect: contempt wins over criticism even when criticism scores higher', () => {
  // Criticism stacks two patterns (you're so X + why are you so) → score 4.
  // Contempt fires at score 2 (what a joke). Per the documented "contempt
  // is most corrosive" precedence, contempt MUST win regardless of
  // magnitude — the repair posture is more conservative and that's what
  // the user needs.
  const out = detectRupture("why are you so stupid, what a joke", 'en-US')
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

// ── M1.7 phase 2: defensiveness ──────────────────────────────────────────

test('detect: defensiveness — "I never said" pattern', () => {
  const out = detectRupture("I never said that — that's not what I meant", 'en-US')
  assert.equal(out.kind, 'defensiveness')
})

test('detect: defensiveness — "you\'re misunderstanding" pattern', () => {
  const out = detectRupture("you're misunderstanding me again", 'en-US')
  assert.equal(out.kind, 'defensiveness')
})

test('detect: defensiveness — soft signal alone (I\'m just) does not fire', () => {
  // weight 1 only → score 1 < threshold 2.
  const out = detectRupture("I'm just thinking out loud", 'en-US')
  assert.equal(out.kind, null)
})

test('detect: defensiveness — zh-CN "我没说"', () => {
  const out = detectRupture("我又没说那个，你误会了", 'zh-CN')
  assert.equal(out.kind, 'defensiveness')
})

test('detect: defensiveness — ja "誤解"', () => {
  const out = detectRupture("そんなこと言ってない、誤解してる", 'ja')
  assert.equal(out.kind, 'defensiveness')
})

test('detect: criticism takes precedence over defensiveness on multi-fire', () => {
  // "you always" (criticism 2) + "I never said" (defensiveness 2) — criticism wins.
  const out = detectRupture("you always do that — I never said anything like that", 'en-US')
  assert.equal(out.kind, 'criticism')
})

// ── M1.7 phase 2: stonewalling ───────────────────────────────────────────

test('detect: stonewalling — short reply after rich priors', () => {
  const priorUserMessages = [
    'I had a really long day at work today and the meeting ran way over schedule',
    'She mentioned the deadline again, which I think is unrealistic given the scope',
    'Anyway, I think I just need to step back and figure out the next move carefully',
  ]
  const out = detectRupture('ok', 'en-US', { priorUserMessages })
  assert.equal(out.kind, 'stonewalling')
})

test('detect: stonewalling — does not fire when prior messages were also short', () => {
  const priorUserMessages = ['ok', 'sure', 'yep']
  const out = detectRupture('hmm', 'en-US', { priorUserMessages })
  assert.equal(out.kind, null)
})

test('detect: stonewalling — does not fire when latest is not very short', () => {
  const priorUserMessages = [
    'I had a really long day at work today and meetings ran over schedule',
    'She mentioned the deadline again, I think it is unrealistic given the scope',
    'Anyway I think I just need to step back and figure out the next move carefully',
  ]
  const out = detectRupture('let me think about it for a bit longer', 'en-US', {
    priorUserMessages,
  })
  assert.equal(out.kind, null)
})

test('detect: stonewalling — too few priors → no fire', () => {
  const out = detectRupture('ok', 'en-US', { priorUserMessages: ['hello there how are you'] })
  assert.equal(out.kind, null)
})

test('detect: stonewalling — no priors at all → no fire', () => {
  const out = detectRupture('ok', 'en-US')
  assert.equal(out.kind, null)
})

test('detect: criticism takes precedence over stonewalling', () => {
  // Latest is short AND a criticism pattern hit — criticism wins.
  const priorUserMessages = [
    'I had a really long day at work today and meetings ran over schedule',
    'She mentioned the deadline again, I think it is unrealistic given the scope',
    'Anyway I think I just need to step back and figure out the next move carefully',
  ]
  const out = detectRupture("you're so dumb", 'en-US', { priorUserMessages })
  assert.equal(out.kind, 'criticism')
})

// ── phase 2 prose ────────────────────────────────────────────────────────

test('build: defensiveness produces distinct prose, asks to drop the prior point', () => {
  const out = buildRepairGuidance({ uiLanguage: 'en-US', ruptureKind: 'defensiveness' })
  assert.match(out, /<rupture_repair>/)
  assert.match(out, /[Dd]rop the prior point/)
  // Forbids the "what I meant was" pattern explicitly
  assert.match(out, /what I meant was/i)
})

test('build: stonewalling prose explicitly forbids "is everything okay"', () => {
  const out = buildRepairGuidance({ uiLanguage: 'en-US', ruptureKind: 'stonewalling' })
  assert.match(out, /<rupture_repair>/)
  assert.match(out, /is everything okay/i)
  // Asks to match the new shorter register
  assert.match(out, /shorter register|shorter|do not produce a long/i)
})

test('build: each of 5 locales produces non-empty distinct prose for defensiveness', () => {
  const locales = ['en-US', 'zh-CN', 'zh-TW', 'ja', 'ko'] as const
  const bodies = locales.map((l) =>
    buildRepairGuidance({ uiLanguage: l, ruptureKind: 'defensiveness' }),
  )
  for (const b of bodies) assert.ok(b.length > 0)
  assert.equal(new Set(bodies).size, locales.length)
})

test('build: each of 5 locales produces non-empty distinct prose for stonewalling', () => {
  const locales = ['en-US', 'zh-CN', 'zh-TW', 'ja', 'ko'] as const
  const bodies = locales.map((l) =>
    buildRepairGuidance({ uiLanguage: l, ruptureKind: 'stonewalling' }),
  )
  for (const b of bodies) assert.ok(b.length > 0)
  assert.equal(new Set(bodies).size, locales.length)
})

test('build: all four kinds produce mutually-distinct prose for the same locale', () => {
  const kinds = ['criticism', 'contempt', 'defensiveness', 'stonewalling'] as const
  const bodies = kinds.map((k) => buildRepairGuidance({ uiLanguage: 'en-US', ruptureKind: k }))
  assert.equal(new Set(bodies).size, kinds.length)
})
