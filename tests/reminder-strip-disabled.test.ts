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

function makeContext(): DeliveryContext {
  return {
    panelFocused: false,
    fullscreen: false,
    focusState: 'active',
    inQuietHours: false,
    systemDnd: null,
    awayNotificationsEnabled: false,
    stripEnabled: false,
  }
}

test('with the strip disabled an active reminder falls back to the bubble outlet and speech', () => {
  const decision = routeDelivery(makeMessage(), makeContext())

  assert.deepEqual(decision, { rule: 4, outlets: ['inbox', 'bubble'] })
  assert.deepEqual(planReminderPresentation(decision), {
    chatLine: true,
    // The router's bubble outlet shows the bubble, not the controller.
    bubble: false,
    speech: true,
  })
})
