import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { DeliveryContext, ProactiveDeliveryPayload } from '../shared/proactiveDelivery.js'
import { createProactiveInboxOverlayController } from '../src/features/proactive/proactiveInboxOverlayController.ts'
import { PROACTIVE_INBOX_SNOOZE_MS } from '../src/features/proactive/proactiveInboxSnooze.ts'
import type { ProactiveInboxEntryView } from '../src/features/proactive/proactiveInboxOverlay.ts'

const CONTEXT: DeliveryContext = {
  panelFocused: false,
  fullscreen: false,
  focusState: 'active',
  inQuietHours: false,
  systemDnd: null,
  awayNotificationsEnabled: false,
  stripEnabled: true,
}

function entry(overrides: Partial<ProactiveInboxEntryView> & { id: string }): ProactiveInboxEntryView {
  return {
    source: 'reminder',
    kind: 'reminder_follow_up',
    priority: 'high',
    title: `Title ${overrides.id}`,
    body: `Body ${overrides.id}`,
    actions: ['done', 'snooze'],
    createdAt: 1,
    status: 'unread',
    updatedAt: 1,
    ...overrides,
  }
}

function countUnread(entries: readonly ProactiveInboxEntryView[]): number {
  return entries.filter((item) => (
    item.status === 'unread' && (item.actions.length > 0 || item.priority === 'high')
  )).length
}

function createFakeClock() {
  let now = 0
  let nextHandle = 1
  const timers = new Map<number, { dueAt: number, callback: () => void }>()

  return {
    setTimeout(callback: () => void, ms: number) {
      const handle = nextHandle++
      timers.set(handle, { dueAt: now + ms, callback })
      return handle
    },
    clearTimeout(handle: unknown) {
      timers.delete(handle as number)
    },
    advance(ms: number) {
      now += ms
      let due = [...timers.entries()]
        .filter(([, timer]) => timer.dueAt <= now)
        .sort((left, right) => left[1].dueAt - right[1].dueAt)
      while (due.length > 0) {
        const [handle, timer] = due[0]
        timers.delete(handle)
        timer.callback()
        due = [...timers.entries()]
          .filter(([, entryTimer]) => entryTimer.dueAt <= now)
          .sort((left, right) => left[1].dueAt - right[1].dueAt)
      }
    },
  }
}

async function flushAsync(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

function createHarness(initialEntries: ProactiveInboxEntryView[]) {
  let entries = initialEntries.map((item) => ({ ...item }))
  const updates: Array<{ id: string, status: 'done' }> = []
  const deliveries: ProactiveDeliveryPayload[] = []
  let openedConversation = 0
  const clock = createFakeClock()

  const controller = createProactiveInboxOverlayController({
    bridge: {
      list: async () => ({
        entries: entries.map((item) => ({ ...item })),
        unreadCount: countUnread(entries),
        removedIds: [],
      }),
      update: async (id, status) => {
        updates.push({ id, status })
        entries = entries.map((item) => (item.id === id ? { ...item, status } : item))
        return { updated: true, unreadCount: countUnread(entries) }
      },
      deliver: async (payload) => {
        deliveries.push(payload)
        return { rule: 6, outlets: ['inbox', 'badge'] }
      },
      openConversation: () => {
        openedConversation += 1
      },
    },
    buildDeliveryPayload: async (message) => ({
      message,
      context: CONTEXT,
      preferences: {
        quietStart: 0,
        quietEnd: 0,
        desktopAwarenessAllowed: false,
        awayNotificationsEnabled: false,
      },
    }),
    logger: { warn: () => {} },
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  })

  return {
    controller,
    clock,
    updates,
    deliveries,
    openedConversation: () => openedConversation,
    entries: () => entries,
    setEntries: (next: ProactiveInboxEntryView[]) => {
      entries = next.map((item) => ({ ...item }))
    },
  }
}

test('toggling the badge opens and closes the overlay', async () => {
  const harness = createHarness([entry({ id: 'a' })])
  await harness.controller.toggle()
  assert.equal(harness.controller.getSnapshot().open, true)
  await harness.controller.toggle()
  assert.equal(harness.controller.getSnapshot().open, false)
  assert.deepEqual(harness.updates, [])
})

test('opening the overlay changes nothing, closing clears its expansion', async () => {
  const harness = createHarness([entry({ id: 'a' }), entry({ id: 'b', createdAt: 2 })])
  await harness.controller.open()

  assert.equal(harness.controller.getSnapshot().open, true)
  assert.equal(harness.controller.getSnapshot().unreadCount, 2)
  assert.equal(harness.controller.getSnapshot().rows.length, 2)
  assert.deepEqual(harness.updates, [])

  await harness.controller.toggleRow('a')
  assert.equal(harness.controller.getSnapshot().expandedId, 'a')
  harness.controller.close()
  assert.equal(harness.controller.getSnapshot().open, false)
  assert.equal(harness.controller.getSnapshot().expandedId, null)
})

test('Done marks the entry done, removes the row and drops the count', async () => {
  const harness = createHarness([entry({ id: 'a' }), entry({ id: 'b', createdAt: 2 })])
  await harness.controller.open()

  await harness.controller.runAction('a', 'done')

  assert.deepEqual(harness.updates, [{ id: 'a', status: 'done' }])
  assert.equal(harness.controller.getSnapshot().unreadCount, 1)
  assert.deepEqual(harness.controller.getSnapshot().rows.map((row) => row.id), ['b'])
})

test('Snooze keeps the count, hides the row, then re-delivers once after ten minutes', async () => {
  const harness = createHarness([entry({ id: 'a' })])
  await harness.controller.open()

  await harness.controller.runAction('a', 'snooze')

  assert.deepEqual(harness.updates, [])
  assert.equal(harness.controller.getSnapshot().unreadCount, 1)
  assert.deepEqual(harness.controller.getSnapshot().rows, [])

  harness.clock.advance(PROACTIVE_INBOX_SNOOZE_MS - 1)
  await flushAsync()
  assert.equal(harness.deliveries.length, 0)

  harness.clock.advance(1)
  await flushAsync()
  assert.equal(harness.deliveries.length, 1)
  assert.equal(harness.deliveries[0].message.id, 'a')
  assert.equal('fullBody' in harness.deliveries[0].message, false)

  harness.clock.advance(PROACTIVE_INBOX_SNOOZE_MS)
  await flushAsync()
  assert.equal(harness.deliveries.length, 1)
})

test('Done before the snooze timer fires cancels the re-delivery', async () => {
  const harness = createHarness([entry({ id: 'a' })])
  await harness.controller.open()
  await harness.controller.runAction('a', 'snooze')
  await harness.controller.runAction('a', 'done')

  harness.clock.advance(PROACTIVE_INBOX_SNOOZE_MS)
  await flushAsync()

  assert.equal(harness.deliveries.length, 0)
  assert.deepEqual(harness.updates, [{ id: 'a', status: 'done' }])
})

test('Open chat calls the panel bridge and marks the entry done', async () => {
  const harness = createHarness([entry({ id: 'a', actions: ['open'] }), entry({ id: 'b', createdAt: 2 })])
  await harness.controller.open()

  await harness.controller.runAction('a', 'open')

  assert.equal(harness.openedConversation(), 1)
  assert.deepEqual(harness.updates, [{ id: 'a', status: 'done' }])
  assert.equal(harness.controller.getSnapshot().unreadCount, 1)
  assert.deepEqual(harness.controller.getSnapshot().rows.map((row) => row.id), ['b'])
})

test('expanding an action-less high entry shows its full text, marks it read and pins the row', async () => {
  const fullBody = `first line\nsecond line ${'z'.repeat(180)}`
  const harness = createHarness([entry({
    id: 'capsule',
    actions: [],
    priority: 'high',
    body: 'short preview',
    fullBody,
  })])
  await harness.controller.open()

  await harness.controller.toggleRow('capsule')

  const expanded = harness.controller.getSnapshot()
  assert.equal(expanded.unreadCount, 0)
  assert.equal(expanded.expandedId, 'capsule')
  assert.deepEqual(expanded.rows.map((row) => row.id), ['capsule'])
  assert.equal(expanded.rows[0].fullText, fullBody)
  assert.deepEqual(harness.updates, [{ id: 'capsule', status: 'done' }])

  await harness.controller.toggleRow('capsule')
  const collapsed = harness.controller.getSnapshot()
  assert.equal(collapsed.expandedId, null)
  assert.deepEqual(collapsed.rows, [])
})

test('expanding an entry with actions does not change its status', async () => {
  const harness = createHarness([entry({ id: 'actionable', actions: ['done'], priority: 'normal' })])
  await harness.controller.open()

  await harness.controller.toggleRow('actionable')

  assert.equal(harness.controller.getSnapshot().expandedId, 'actionable')
  assert.equal(harness.controller.getSnapshot().unreadCount, 1)
  assert.deepEqual(harness.updates, [])
  assert.deepEqual(harness.entries().map((item) => item.status), ['unread'])
})

test('the overlay is empty when there is no badge-worthy unread entry', async () => {
  const harness = createHarness([
    entry({ id: 'companionship', actions: [], priority: 'normal' }),
    entry({ id: 'already-done', actions: ['done'], status: 'done' }),
  ])
  await harness.controller.open()

  assert.deepEqual(harness.controller.getSnapshot().rows, [])
  assert.equal(harness.controller.getSnapshot().unreadCount, 0)
  assert.deepEqual(harness.updates, [])
})

test('refresh reflects changes made by the strip or another window', async () => {
  const harness = createHarness([])
  await harness.controller.open()
  assert.deepEqual(harness.controller.getSnapshot().rows, [])

  harness.setEntries([entry({ id: 'from-strip', actions: ['open'], createdAt: 5 })])
  await harness.controller.refresh()

  assert.deepEqual(harness.controller.getSnapshot().rows.map((row) => row.id), ['from-strip'])
  assert.equal(harness.controller.getSnapshot().unreadCount, 1)
})
