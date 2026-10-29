import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  decideDreamDiary,
  dreamNightKey,
  hasDreamMaterial,
  selectDreamFragments,
  summarizeDreamMood,
  type DreamDiaryDecisionInput,
} from '../src/features/dream/dreamDiary.ts'
import {
  buildDreamPrompt,
  containsVerbatimFragment,
  parseDreamResponse,
} from '../src/features/dream/dreamDiaryPrompt.ts'
import {
  appendDreamEntry,
  countDreams,
  createDreamDiaryEntry,
  deleteDream,
  getLatestDreamForNight,
  getLatestUnsurfacedDream,
  getMostRecentDreamNight,
  getMostRecentSurfacedAtMs,
  loadDreams,
  markDreamSurfaced,
  saveDream,
} from '../src/features/dream/dreamDiaryStore.ts'
import { decideDreamSurfacing } from '../src/features/dream/dreamSurfacing.ts'
import { buildMemoryTimeline, buildRememberedCardView } from '../src/features/memory/memoryTimeline.ts'
import {
  DREAM_DIARY_STORAGE_KEY,
  MEMORY_STORAGE_KEY,
} from '../src/lib/storage/core.ts'
import type { MemoryItem } from '../src/types/memory.ts'

const NIGHT_23 = new Date(2026, 9, 29, 23, 0, 0).getTime()
const NIGHT_2AM = new Date(2026, 9, 30, 2, 0, 0).getTime()
const MORNING = new Date(2026, 9, 30, 10, 0, 0).getTime()

/** Local-time ISO helper so these tests never depend on the machine's zone. */
function iso(year: number, month: number, day: number, hour = 12, minute = 0): string {
  return new Date(year, month - 1, day, hour, minute, 0).toISOString()
}

function decisionInput(overrides: Partial<DreamDiaryDecisionInput> = {}): DreamDiaryDecisionInput {
  return {
    enabled: true,
    autonomyEnabled: true,
    autonomyDreamEnabled: true,
    nowMs: NIGHT_23,
    idleSeconds: 20 * 60,
    sleepAfterIdleMinutes: 15,
    memoryPaused: false,
    lastDreamNight: null,
    hasMaterial: true,
    ...overrides,
  }
}

function createLocalStorageMock(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, String(value)) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => { store.clear() },
  }
}

function installStorage(initial: Record<string, string> = {}) {
  const localStorage = createLocalStorageMock(initial)
  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage,
      dispatchEvent: () => true,
    },
    configurable: true,
    writable: true,
  })
  return localStorage
}

function memory(id: string, content: string, createdAt: string, extra: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id,
    content,
    category: 'manual',
    source: 'chat',
    createdAt,
    ...extra,
  }
}

// ── generation gate ─────────────────────────────────────────────────────────

test('dreams in the night window after a long enough idle stretch', () => {
  const decision = decideDreamDiary(decisionInput())
  assert.equal(decision.shouldDream, true)
  assert.equal(decision.night, '2026-10-29')
})

test('one night key spans midnight', () => {
  assert.equal(dreamNightKey(NIGHT_23), dreamNightKey(NIGHT_2AM))
})

test('does not dream outside the night window', () => {
  const decision = decideDreamDiary(decisionInput({ nowMs: new Date(2026, 9, 29, 14, 0).getTime() }))
  assert.equal(decision.shouldDream, false)
  assert.equal(decision.reason, 'outside_window')
})

test('does not dream before the idle threshold', () => {
  const decision = decideDreamDiary(decisionInput({ idleSeconds: 10 * 60 }))
  assert.equal(decision.shouldDream, false)
  assert.equal(decision.reason, 'not_idle_enough')
})

test('at most one entry per night', () => {
  const decision = decideDreamDiary(decisionInput({
    nowMs: NIGHT_2AM,
    lastDreamNight: '2026-10-29',
  }))
  assert.equal(decision.shouldDream, false)
  assert.equal(decision.reason, 'already_dreamed_tonight')
})

test('memory pause stops memory-shaped dreams', () => {
  const decision = decideDreamDiary(decisionInput({ memoryPaused: true }))
  assert.equal(decision.shouldDream, false)
  assert.equal(decision.reason, 'memory_paused')
})

test('no material means no dream and no wasted call', () => {
  const decision = decideDreamDiary(decisionInput({ hasMaterial: false }))
  assert.equal(decision.shouldDream, false)
  assert.equal(decision.reason, 'no_material')
})

test('the feature switch and autonomy chain are respected', () => {
  assert.equal(decideDreamDiary(decisionInput({ enabled: false })).reason, 'disabled')
  assert.equal(decideDreamDiary(decisionInput({ autonomyEnabled: false })).reason, 'autonomy_off')
  assert.equal(decideDreamDiary(decisionInput({ autonomyDreamEnabled: false })).reason, 'autonomy_off')
})

// ── material ────────────────────────────────────────────────────────────────

test('material prefers recent usable memories and caps at two', () => {
  const fragments = selectDreamFragments([
    memory('old', '很久以前的旧事', iso(2026, 1, 1, 10)),
    memory('recent-low', '上周的一件小事', iso(2026, 10, 27, 10)),
    memory('recent-high', '昨天的一件重要的事', iso(2026, 10, 29, 10), { importance: 'high' }),
    memory('archived', '已经归档的', iso(2026, 10, 29, 11), { status: 'archived' }),
    memory('disabled', '停用的', iso(2026, 10, 29, 12), { enabled: false }),
  ], NIGHT_23)

  assert.deepEqual(fragments.map((fragment) => fragment.id), ['recent-high', 'recent-low'])
})

test('mood needs a few samples and collapses to one gentle line', () => {
  assert.equal(summarizeDreamMood([]), null)
  const mood = summarizeDreamMood([
    { energy: 0.8, warmth: 0.8, curiosity: 0.8, concern: 0.1 },
    { energy: 0.7, warmth: 0.7, curiosity: 0.7, concern: 0.1 },
    { energy: 0.7, warmth: 0.7, curiosity: 0.7, concern: 0.1 },
  ])
  assert.match(mood ?? '', /bright/)
  assert.match(mood ?? '', /close/)
  assert.equal(hasDreamMaterial([], mood), true)
  assert.equal(hasDreamMaterial([], null), false)
})

// ── prompt and parser ───────────────────────────────────────────────────────

test('the prompt asks for transformed imagery, never a real event', () => {
  const { system, user } = buildDreamPrompt({
    companionName: '星绘',
    uiLanguage: 'zh-CN',
    fragments: [{ id: 'm1', text: '你下周三要去医院复查' }],
    weekMood: 'quiet and close',
  })

  assert.match(system, /Never quote/)
  assert.match(system, /never present the dream as something that happened/)
  assert.match(system, /Simplified Chinese/)
  assert.match(user, /你下周三要去医院复查/)
  assert.match(user, /quiet and close/)
})

test('parser accepts a fenced JSON dream and rejects broken contracts', () => {
  const valid = '```json\n{"dream":"我梦见一条河从书架中间流过去，书页折成了小船。"}\n```'
  assert.equal(parseDreamResponse(valid), '我梦见一条河从书架中间流过去，书页折成了小船。')
  assert.equal(parseDreamResponse('{"dream":"太短"}'), null)
  assert.equal(parseDreamResponse('not json'), null)
  assert.equal(parseDreamResponse('{"dream":"   "}'), null)
})

test('parser rejects a dream that quotes a source fragment verbatim', () => {
  const fragment = '你下周三下午三点去医院复查'
  const leaked = JSON.stringify({ dream: '我梦见下周三下午三点去医院复查，走廊很长。' })
  assert.equal(parseDreamResponse(leaked, [fragment]), null)
  assert.equal(containsVerbatimFragment('一条河从书架中间流过去，书页折成了小船。', [fragment]), false)
})

// ── store ───────────────────────────────────────────────────────────────────

test('a failed generation never consumes the night', () => {
  installStorage()
  const failed = createDreamDiaryEntry({ night: '2026-10-29', text: null })
  assert.equal(failed, null)

  const entries = appendDreamEntry([], failed)
  assert.deepEqual(entries, [])
  assert.equal(loadDreams().length, 0)
  assert.equal(getMostRecentDreamNight(), null)
})

test('one row per night, newest replaces the same night', () => {
  installStorage()
  const first = createDreamDiaryEntry({
    night: '2026-10-29',
    text: '书架里流出一条河，我把书页折成小船。',
    createdAt: iso(2026, 10, 29, 23, 10),
  })
  assert.ok(first)
  saveDream(first)

  const retry = createDreamDiaryEntry({
    night: '2026-10-29',
    text: '一条河从书架里流出来，书页变成了小船。',
    createdAt: iso(2026, 10, 29, 23, 40),
  })
  assert.ok(retry)
  saveDream(retry)

  const rows = loadDreams()
  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.id, retry.id)
  assert.equal(rows[0]?.text, retry.text)
})

test('dreams can be marked mentioned and deleted', () => {
  installStorage()
  const entry = createDreamDiaryEntry({
    night: '2026-10-29',
    text: '书架里流出一条河，我把书页折成小船。',
    createdAt: iso(2026, 10, 29, 23, 10),
  })
  assert.ok(entry)
  saveDream(entry)

  assert.equal(getLatestDreamForNight('2026-10-29')?.id, entry.id)
  assert.equal(getLatestUnsurfacedDream()?.id, entry.id)
  assert.equal(getMostRecentSurfacedAtMs(), null)

  markDreamSurfaced(entry.id, iso(2026, 10, 30, 9))
  assert.equal(getLatestUnsurfacedDream(), null)
  assert.equal(getMostRecentSurfacedAtMs(), Date.parse(iso(2026, 10, 30, 9)))
  assert.equal(countDreams(), 1)

  assert.equal(deleteDream(entry.id), true)
  assert.equal(deleteDream(entry.id), false)
  assert.equal(countDreams(), 0)
})

test('dreams are stored separately and never become user memory', () => {
  const storage = installStorage()
  const entry = createDreamDiaryEntry({
    night: '2026-10-29',
    text: '书架里流出一条河，我把书页折成小船。',
    createdAt: iso(2026, 10, 29, 23, 10),
  })
  assert.ok(entry)
  saveDream(entry)

  assert.ok(storage.getItem(DREAM_DIARY_STORAGE_KEY))
  assert.equal(storage.getItem(MEMORY_STORAGE_KEY), null)
  assert.equal(storage.getItem('nexus:memory:daily'), null)
})

test('dreams join the memory timeline but not the remembered count', () => {
  installStorage()
  const entry = createDreamDiaryEntry({
    night: '2026-10-29',
    text: '书架里流出一条河，我把书页折成小船。',
    createdAt: iso(2026, 10, 29, 23, 10),
  })
  assert.ok(entry)
  saveDream(entry)

  const dreams = loadDreams()
  const groups = buildMemoryTimeline({
    memories: [],
    dailyEntries: [],
    dreams,
    now: new Date(2026, 9, 30, 10, 0, 0),
  })
  assert.equal(groups.length, 1)
  assert.equal(groups[0]?.kind, 'yesterday')
  assert.deepEqual(groups[0]?.items.map((item) => item.kind), ['dream'])
  assert.equal(groups[0]?.items[0]?.text, entry.text)

  assert.deepEqual(buildRememberedCardView({
    memories: [],
    dailyEntries: [],
    now: new Date(2026, 9, 30, 10, 0, 0),
    paused: false,
  }), { state: 'empty', count: 0, latest: [] })

  deleteDream(entry.id)
  assert.equal(buildMemoryTimeline({
    memories: [],
    dailyEntries: [],
    dreams: loadDreams(),
    now: new Date(2026, 9, 30, 10, 0, 0),
  }).length, 0)
})

// ── morning surfacing ───────────────────────────────────────────────────────

function surfacingInput(overrides: Partial<Parameters<typeof decideDreamSurfacing>[0]> = {}) {
  return {
    enabled: true,
    nowMs: MORNING,
    dream: { createdAt: iso(2026, 10, 30, 2), surfacedAt: null },
    lastSurfacedAtMs: null,
    relationshipType: 'friend' as const,
    frequency: 'normal' as const,
    quietStart: 23,
    quietEnd: 8,
    focusState: 'active' as const,
    bracketEnabled: true,
    lastMorningBracketFiredMs: new Date(2026, 9, 30, 8, 0, 0).getTime(),
    ...overrides,
  }
}

test('mentions a dream on the morning after, after the bracket', () => {
  const decision = decideDreamSurfacing(surfacingInput())
  assert.equal(decision.shouldSurface, true)
  assert.equal(decision.shouldSurface && decision.minGapDays, 3)
})

test('the morning bracket always wins when it has not fired yet', () => {
  const decision = decideDreamSurfacing(surfacingInput({
    lastMorningBracketFiredMs: null,
  }))
  assert.equal(decision.shouldSurface, false)
  assert.equal(decision.reason, 'bracket_pending')
})

test('does not stack right after the bracket line', () => {
  const decision = decideDreamSurfacing(surfacingInput({
    lastMorningBracketFiredMs: MORNING - 10 * 60_000,
  }))
  assert.equal(decision.shouldSurface, false)
  assert.equal(decision.reason, 'bracket_too_recent')
})

test('event follow-ups and letters outrank a dream', () => {
  assert.equal(
    decideDreamSurfacing(surfacingInput({ eventFollowUpDue: true })).reason,
    'event_follow_up_pending',
  )
  assert.equal(
    decideDreamSurfacing(surfacingInput({ letterDue: true })).reason,
    'letter_pending',
  )
})

test('mentions stay occasional: three days apart, a week on the quiet pace', () => {
  const fourDaysAgo = MORNING - 4 * 24 * 60 * 60_000
  assert.equal(decideDreamSurfacing(surfacingInput({ lastSurfacedAtMs: fourDaysAgo })).shouldSurface, true)
  assert.equal(
    decideDreamSurfacing(surfacingInput({ lastSurfacedAtMs: fourDaysAgo, frequency: 'low' })).reason,
    'mentioned_recently',
  )
})

test('never repeats a mention, and never mentions while memory is paused', () => {
  assert.equal(
    decideDreamSurfacing(surfacingInput({
      dream: { createdAt: iso(2026, 10, 30, 2), surfacedAt: iso(2026, 10, 30, 9) },
    })).reason,
    'no_dream',
  )
  assert.equal(decideDreamSurfacing(surfacingInput({ memoryPaused: true })).reason, 'memory_paused')
  assert.equal(
    decideDreamSurfacing(surfacingInput({ relationshipType: 'quiet_companion' })).reason,
    'relationship_type_opted_out',
  )
})

test('a stale dream is not mentioned the next day', () => {
  const decision = decideDreamSurfacing(surfacingInput({
    dream: { createdAt: iso(2026, 10, 28, 2), surfacedAt: null },
  }))
  assert.equal(decision.shouldSurface, false)
  assert.equal(decision.reason, 'too_old')
})
