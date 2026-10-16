import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  emptyAgendaState,
  markAgendaFired,
  projectAgenda,
  recordLoopSurfaced,
  selectAgendaItem,
} from '../src/features/autonomy/proactiveAgenda.ts'
import { evaluateProactiveEtiquette } from '../src/features/autonomy/proactiveBudget.ts'
import { curateMemories } from '../src/features/memory/curation.ts'
import {
  bookClearPlanReminders,
  buildLoopOutreach,
  clearPlanReminderDrafts,
  loopReminderDraft,
  outreachAsks,
} from '../src/features/memory/loopOutreach.ts'
import { extractOpenLoopItems, loopPlanReading } from '../src/features/memory/openLoops.ts'
import { planTurnMemoryWrite } from '../src/features/memory/reconcile.ts'
import { t } from '../src/i18n/runtime.ts'
import type { MemoryItem } from '../src/types/memory.ts'
import type { ProactiveAgendaState } from '../src/types/proactive.ts'

function atLocal(year: number, month: number, day: number, hour = 10, minute = 0): Date {
  return new Date(year, month - 1, day, hour, minute, 0, 0)
}

function etiquette(nowMs: number, firedAt: readonly number[], dismissedAt: readonly number[] = []) {
  return evaluateProactiveEtiquette({
    nowMs,
    enabled: true,
    preset: 'normal',
    quietStart: 23,
    quietEnd: 8,
    firedAt,
    dismissedAt,
    userTyping: false,
    fullscreen: false,
    focusState: 'active',
    channel: 'return',
    resumedAtMs: nowMs - 60_000,
  })
}

test('14 days: passport capture, night-before offer, one check, then silence', () => {
  assert.equal(atLocal(2026, 10, 16).getDay(), 5)
  const saidAt = atLocal(2026, 10, 16, 11)
  const [captured] = extractOpenLoopItems('下周二去办护照', saidAt.toISOString(), () => 'memory-passport', 'msg-1')
  assert.ok(captured)
  const opened = planTurnMemoryWrite({
    memoryPaused: false,
    existing: [],
    candidates: [captured],
    utterance: '下周二去办护照',
    now: saidAt.toISOString(),
    messageId: 'msg-1',
    embed: () => null,
    createId: () => 'memory-passport',
  })
  let memories = opened.memories
  assert.equal(memories.filter((item) => item.kind === 'open_loop').length, 1)

  const detailAt = atLocal(2026, 10, 16, 15)
  const detailed = planTurnMemoryWrite({
    memoryPaused: false,
    existing: memories,
    candidates: [],
    utterance: '我选择了南山的出入境大厅，上午九点，已经预约好了',
    now: detailAt.toISOString(),
    messageId: 'msg-2',
    embed: () => null,
  })
  memories = detailed.memories
  const passport = memories.find((item) => item.slotKey === 'loop.passport')
  assert.ok(passport)
  assert.equal(passport.loopPlace, '南山出入境大厅')
  assert.equal(new Date(passport.loopDueAt ?? '').getFullYear(), 2026)
  assert.equal(new Date(passport.loopDueAt ?? '').getMonth(), 9)
  assert.equal(new Date(passport.loopDueAt ?? '').getDate(), 20)
  assert.equal(new Date(passport.loopDueAt ?? '').getHours(), 9)
  assert.equal(memories.filter((item) => item.kind === 'open_loop' && (item.loopStatus ?? 'open') === 'open').length, 1)

  const migrated: MemoryItem = {
    ...passport,
    id: 'memory-old',
    content: '去年的护照预约',
    slotKey: 'loop.old',
    migrated: true,
    loopDueAt: atLocal(2026, 10, 17, 9).toISOString(),
    loopPlace: undefined,
  }
  memories = [...memories, migrated]
  assert.equal(loopPlanReading(passport!), 'clear')
  const drafts = clearPlanReminderDrafts(memories, detailAt.getTime())
  assert.equal(drafts.length, 1)
  assert.equal(drafts[0]?.draft.schedule.kind, 'at')
  if (drafts[0]?.draft.schedule.kind === 'at') {
    const at = new Date(drafts[0].draft.schedule.at)
    assert.equal(at.getDate(), 19)
    assert.equal(at.getHours(), 20)
  }
  let bookedCount = 0
  memories = bookClearPlanReminders(memories, detailAt.getTime(), () => {
    bookedCount += 1
    return { id: 'reminder-passport' }
  })
  assert.equal(bookedCount, 1)
  assert.equal(memories.find((item) => item.id === passport?.id)?.loopReminderTaskId, 'reminder-passport')
  memories = bookClearPlanReminders(memories, detailAt.getTime(), () => {
    bookedCount += 1
    return { id: 'reminder-again' }
  })
  assert.equal(bookedCount, 1)

  let agenda: ProactiveAgendaState = emptyAgendaState()
  const mentions: string[] = []

  for (let day = 16; day <= 30; day += 1) {
    const morning = atLocal(2026, 10, day, 10).getTime()
    if (day === 19) {
      const quiet = etiquette(atLocal(2026, 10, 19, 23, 30).getTime(), agenda.firedAt)
      assert.equal(quiet.allow, false)
      assert.equal(quiet.reason, 'quiet-hours')
    }
    agenda = projectAgenda({ memories, followUps: [], previous: agenda, nowMs: morning })
    const gate = etiquette(morning, agenda.firedAt, agenda.dismissedAt)
    const item = gate.allow ? selectAgendaItem(agenda.items, morning, 'return') : null
    assert.equal(item?.sourceId === 'memory-old', false)
    if (!item) continue
    const memory = memories.find((row) => row.id === item.sourceId)
    assert.ok(memory)
    const outreach = buildLoopOutreach(memory, morning, t)
    assert.ok(outreach)
    assert.equal(outreach.text.includes('120'), false)
    assert.equal(outreach.text.includes('你忘了'), false)
    mentions.push(`${day}:${outreach.phase}`)
    if (outreach.phase === 'preview') {
      assert.equal(day, 19)
      assert.equal(outreach.mode, 'confirm')
      assert.equal(outreachAsks(outreach.text), false)
      assert.match(outreach.text, /10月20日 9:00/)
      assert.match(outreach.text, /南山出入境大厅/)
      assert.match(outreach.text, /前一晚会提醒你/)
      assert.equal(outreach.text.includes('要我前一晚提醒你吗'), false)
      assert.match(outreach.why.quote, /办护照|南山/)
      const draft = loopReminderDraft(memory, morning)
      assert.ok(draft)
      assert.equal(draft.schedule.kind, 'at')
      if (draft.schedule.kind === 'at') {
        const at = new Date(draft.schedule.at)
        assert.equal(at.getDate(), 19)
        assert.equal(at.getHours(), 20)
      }
      const tooSoon = etiquette(morning + 30 * 60 * 1000, [...agenda.firedAt, morning])
      assert.equal(tooSoon.allow, false)
      assert.equal(tooSoon.reason, 'gap')
    }
    if (outreach.phase === 'check') {
      assert.equal(day, 20)
      assert.equal(outreachAsks(outreach.text), true)
      assert.match(outreach.text, /办好了吗/)
      assert.equal(outreach.offer, null)
    }
    agenda = markAgendaFired(agenda, item.id, morning)
    memories = recordLoopSurfaced(memories, memory.id, new Date(morning).toISOString(), outreach.phase)
    if (outreach.phase === 'check') {
      const closed = planTurnMemoryWrite({
        memoryPaused: false,
        existing: memories,
        candidates: [],
        utterance: '搞定了',
        now: atLocal(2026, 10, 20, 11).toISOString(),
        messageId: 'msg-done',
        embed: () => null,
      })
      memories = closed.memories
      assert.equal(memories.find((row) => row.id === passport.id)?.loopStatus, 'done')
      const curated = curateMemories(memories, atLocal(2026, 10, 20, 12).toISOString(), 'memory-run-passport')
      memories = curated.memories
      assert.equal(memories.find((row) => row.id === passport.id)?.status, 'archived')
    }
  }

  assert.deepEqual(mentions, ['19:preview', '20:check'])
  const later = projectAgenda({
    memories,
    followUps: [],
    previous: agenda,
    nowMs: atLocal(2026, 10, 30, 10).getTime(),
  })
  assert.equal(selectAgendaItem(later.items, atLocal(2026, 10, 30, 10).getTime(), 'return'), null)

  const capped = evaluateProactiveEtiquette({
    nowMs: atLocal(2026, 10, 21, 18).getTime(),
    enabled: true,
    preset: 'normal',
    quietStart: 23,
    quietEnd: 8,
    firedAt: [10, 12, 14].map((hour) => atLocal(2026, 10, 21, hour).getTime()),
    dismissedAt: [],
    userTyping: false,
    fullscreen: false,
    focusState: 'active',
    channel: 'return',
    resumedAtMs: atLocal(2026, 10, 21, 9).getTime(),
  })
  assert.equal(capped.reason, 'daily-cap')
  const backedOff = evaluateProactiveEtiquette({
    nowMs: atLocal(2026, 10, 22, 10).getTime(),
    enabled: true,
    preset: 'normal',
    quietStart: 23,
    quietEnd: 8,
    firedAt: [atLocal(2026, 10, 22, 8, 30).getTime()],
    dismissedAt: [atLocal(2026, 10, 21, 10).getTime(), atLocal(2026, 10, 21, 15).getTime()],
    userTyping: false,
    fullscreen: false,
    focusState: 'active',
    channel: 'return',
    resumedAtMs: atLocal(2026, 10, 22, 9).getTime(),
  })
  assert.equal(backedOff.reason, 'daily-cap')
})

test('english preview sentences keep a space after the period', () => {
  const memory = {
    id: 'loop-en',
    content: 'I need to get my passport next Tuesday',
    kind: 'open_loop' as const,
    loopStatus: 'open' as const,
    slotKey: 'loop.passport',
    loopPlace: 'Nanshan hall',
    loopDueAt: atLocal(2026, 10, 20, 9).toISOString(),
    category: 'goal' as const,
    source: 'chat' as const,
    createdAt: atLocal(2026, 10, 16, 9).toISOString(),
    enabled: true,
    status: 'active' as const,
  }
  const english = (key: string, params?: Record<string, string | number>) => {
    if (key === 'proactive.loop.preview') return `${params?.when ?? ''}${params?.place ?? ''}, ${params?.what ?? ''}.`
    if (key === 'proactive.loop.place') return `, ${params?.where ?? ''}`
    if (key === 'proactive.loop.prep_passport') return 'Bring your ID and residence permit, and arrive 15 minutes early.'
    if (key === 'proactive.loop.offer') return 'Want me to remind you the night before?'
    return key
  }
  const text = buildLoopOutreach(memory, atLocal(2026, 10, 19, 10).getTime(), english as never)?.text ?? ''
  assert.match(text, /Tuesday\. Bring your ID/)
  assert.match(text, /early\. Want me to remind you/)
})
