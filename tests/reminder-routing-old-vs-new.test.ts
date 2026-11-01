import assert from 'node:assert/strict'
import test from 'node:test'

import { routeDelivery } from '../shared/proactiveDelivery.js'
import type { DeliveryContext, ProactiveMessage } from '../shared/proactiveDelivery.js'
import {
  buildReminderProactiveMessage,
  planReminderPresentation,
} from '../src/features/reminders/proactiveMessage.ts'

const NOW = 1_700_000_000_000

function makeMessage(): ProactiveMessage {
  return buildReminderProactiveMessage(
    { id: 'task-1', title: 'Stand up' },
    { displayText: 'Time to move', speech: 'Stand up now', now: NOW },
  )
}

function makeContext(overrides: Partial<DeliveryContext> = {}): DeliveryContext {
  return {
    panelFocused: false,
    fullscreen: false,
    focusState: 'active',
    inQuietHours: false,
    systemDnd: null,
    awayNotificationsEnabled: false,
    stripEnabled: true,
    ...overrides,
  }
}

const OLD_PLAN = Object.freeze({ chatLine: true, bubble: true, speech: true })

const CASES = [
  {
    name: 'rule 1: quiet conditions',
    context: makeContext({ fullscreen: true }),
    rule: 1,
    outlets: ['inbox', 'badge'],
    plan: { chatLine: true, bubble: false, speech: false },
  },
  {
    name: 'rule 2: panel focused',
    context: makeContext({ panelFocused: true }),
    rule: 2,
    outlets: ['inbox', 'panel'],
    plan: { chatLine: true, bubble: false, speech: true },
  },
  {
    name: 'rule 3: active focus uses the strip',
    context: makeContext(),
    rule: 3,
    outlets: ['inbox', 'strip'],
    plan: { chatLine: true, bubble: false, speech: true },
  },
  {
    name: 'rule 4: active focus without the strip',
    context: makeContext({ stripEnabled: false }),
    rule: 4,
    outlets: ['inbox', 'bubble'],
    // The bubble outlet renders the bubble; the controller never duplicates it.
    plan: { chatLine: true, bubble: false, speech: true },
  },
  {
    name: 'rule 5: idle with away notifications',
    context: makeContext({ focusState: 'idle', awayNotificationsEnabled: true }),
    rule: 5,
    outlets: ['inbox', 'os_notification'],
    plan: { chatLine: true, bubble: false, speech: false },
  },
  {
    name: 'rule 6: idle without away notifications',
    context: makeContext({ focusState: 'idle' }),
    rule: 6,
    outlets: ['inbox', 'badge'],
    plan: { chatLine: true, bubble: false, speech: false },
  },
] as const

test('a reminder notice keeps the old chat line in every new routing rule', () => {
  for (const testCase of CASES) {
    assert.equal(OLD_PLAN.chatLine, true, testCase.name)
    assert.equal(planReminderPresentation({ rule: testCase.rule }).chatLine, true, testCase.name)
  }
})

for (const testCase of CASES) {
  test(`old vs new reminder notice — ${testCase.name}`, () => {
    const decision = routeDelivery(makeMessage(), testCase.context)
    assert.equal(decision.rule, testCase.rule)
    assert.deepEqual(decision.outlets, testCase.outlets)

    // Old behaviour before M1: chat line + bubble + speech in every situation.
    assert.deepEqual(OLD_PLAN, { chatLine: true, bubble: true, speech: true })
    // New behaviour is the routing rule's plan.
    assert.deepEqual(planReminderPresentation(decision), testCase.plan)
  })
}
