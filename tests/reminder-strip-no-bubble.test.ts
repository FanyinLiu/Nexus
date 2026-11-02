import assert from 'node:assert/strict'
import test from 'node:test'

import { routeDelivery } from '../shared/proactiveDelivery.js'
import type { DeliveryContext, DeliveryState, ProactiveMessage } from '../shared/proactiveDelivery.js'
import type { Logger } from '../electron/logger.js'
import {
  createProactiveOutletRegistry,
  createProactiveRouter,
} from '../electron/services/proactiveRouter.js'
import {
  buildReminderProactiveMessage,
  planReminderPresentation,
} from '../src/features/reminders/proactiveMessage.ts'
import { resolveProactivePresentation } from '../src/features/proactive/proactivePresentation.ts'

const NOW = 1_700_000_000_000

function makeMessage(): ProactiveMessage {
  return buildReminderProactiveMessage(
    { id: 'task-1', title: 'Stand up' },
    { displayText: 'Time to move', speech: 'Stand up now', now: NOW },
  )
}

function makeContext(): DeliveryContext {
  return {
    panelFocused: false,
    fullscreen: false,
    focusState: 'active',
    inQuietHours: false,
    systemDnd: null,
    awayNotificationsEnabled: false,
    stripEnabled: true,
  }
}

function createFakeLogger(): Logger {
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => logger,
  }
  return logger
}

test('a reminder routed to the strip never chooses the bubble outlet', () => {
  const decision = routeDelivery(makeMessage(), makeContext())

  assert.equal(decision.rule, 3)
  assert.ok(decision.outlets.includes('strip'))
  assert.ok(!decision.outlets.includes('bubble'))
  assert.equal(planReminderPresentation(decision).bubble, false)
  assert.equal(planReminderPresentation(decision).speech, true)
})

test('delivering a reminder through the real router never calls the bubble outlet', async () => {
  const seen: string[] = []
  const outlets = createProactiveOutletRegistry({ logger: createFakeLogger() })
  outlets.register('inbox', (_message: ProactiveMessage, state: DeliveryState) => {
    seen.push('inbox')
    state.unreadCount = 1
  })
  outlets.register('badge', () => {
    seen.push('badge')
  })
  outlets.register('strip', () => {
    seen.push('strip')
  })
  outlets.register('bubble', () => {
    seen.push('bubble')
  })

  const router = createProactiveRouter({ outlets })
  const decision = await router.deliver(makeMessage(), makeContext())

  assert.deepEqual(decision.outlets, ['inbox', 'strip'])
  assert.deepEqual(seen, ['inbox', 'strip'])
})

test('a strip presentation produces no pet bubble', () => {
  assert.equal(
    resolveProactivePresentation({ outlet: 'strip', message: makeMessage() }),
    null,
  )
})
