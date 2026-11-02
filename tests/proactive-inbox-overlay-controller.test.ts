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
    now: () => now,
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
  const updates: Array<{ id: string, status: 'done' | 'read' }> = []
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
    nowMs: clock.now,
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

test('a read entry is not counted as unread and its Done/Open still complete it', async () => {
  const harness = createHarness([
    entry({ id: 'read-done', status: 'read', actions: ['done'], createdAt: 1 }),
    entry({ id: 'read-open', status: 'read', actions: ['open'], createdAt: 2 }),
  ])
  await harness.controller.open()

  const opened = harness.controller.getSnapshot()
  assert.equal(opened.unreadCount, 0)
  assert.equal(opened.rows.length, 2)
  // `read` is seen, not handled: the row keeps working controls.
  assert.deepEqual(opened.rows.map((row) => row.read), [false, false])

  await harness.controller.runAction('read-done', 'done')
  await harness.controller.runAction('read-open', 'open')

  assert.equal(harness.openedConversation(), 1)
  assert.deepEqual(harness.updates, [
    { id: 'read-done', status: 'done' },
    { id: 'read-open', status: 'done' },
  ])
  assert.equal(harness.controller.getSnapshot().unreadCount, 0)
  assert.deepEqual(harness.controller.getSnapshot().rows.map((row) => row.read), [true, true])
})

test('Done marks the entry done, keeps it as a read row and drops the count', async () => {
  const harness = createHarness([entry({ id: 'a' }), entry({ id: 'b', createdAt: 2 })])
  await harness.controller.open()

  await harness.controller.runAction('a', 'done')

  assert.deepEqual(harness.updates, [{ id: 'a', status: 'done' }])
  assert.equal(harness.controller.getSnapshot().unreadCount, 1)
  assert.deepEqual(harness.controller.getSnapshot().rows.map((row) => row.id), ['b', 'a'])
  assert.equal(harness.controller.getSnapshot().rows[1].read, true)
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
  assert.deepEqual(harness.controller.getSnapshot().rows.map((row) => row.id), ['b', 'a'])
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
  assert.deepEqual(collapsed.rows.map((row) => row.id), ['capsule'])
  assert.equal(collapsed.rows[0].read, true)
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

test('badge 0 still lists unread and read entries for the menu-opened overlay', async () => {
  const harness = createHarness([
    entry({ id: 'companionship', actions: [], priority: 'normal', createdAt: 1 }),
    entry({ id: 'already-done', actions: ['done'], status: 'done', createdAt: 2 }),
  ])
  await harness.controller.open()

  const snapshot = harness.controller.getSnapshot()
  assert.equal(snapshot.unreadCount, 0)
  assert.deepEqual(snapshot.rows.map((row) => row.id), ['companionship', 'already-done'])
  assert.deepEqual(snapshot.rows.map((row) => row.read), [false, true])
  assert.deepEqual(harness.updates, [])

  // Expanding the normal no-button entry marks it done but keeps its slot
  // while the user reads the full text.
  await harness.controller.toggleRow('companionship')
  const expanded = harness.controller.getSnapshot()
  assert.deepEqual(harness.updates, [{ id: 'companionship', status: 'done' }])
  assert.equal(expanded.expandedId, 'companionship')
  assert.deepEqual(expanded.rows.map((row) => row.id), ['companionship', 'already-done'])
  assert.equal(expanded.rows[0].read, true)

  // Collapsing keeps the order frozen at open; only a fresh open re-sorts.
  await harness.controller.toggleRow('companionship')
  const collapsed = harness.controller.getSnapshot()
  assert.equal(collapsed.expandedId, null)
  assert.deepEqual(collapsed.rows.map((row) => row.id), ['companionship', 'already-done'])
  assert.deepEqual(collapsed.rows.map((row) => row.read), [true, true])
})

test('an expanded row keeps its index until collapse and then falls into the read section', async () => {
  const harness = createHarness([
    entry({ id: 'target', actions: [], priority: 'normal', createdAt: 1 }),
    entry({ id: 'read-a', actions: ['done'], status: 'done', createdAt: 4 }),
    entry({ id: 'read-b', actions: ['done'], status: 'done', createdAt: 3 }),
    entry({ id: 'read-c', actions: ['done'], status: 'done', createdAt: 2 }),
  ])
  const ids = () => harness.controller.getSnapshot().rows.map((row) => row.id)

  await harness.controller.open()
  assert.deepEqual(ids(), ['target', 'read-a', 'read-b', 'read-c'])

  // Expanding marks the row read; the read section would otherwise put it last.
  await harness.controller.toggleRow('target')
  assert.deepEqual(ids(), ['target', 'read-a', 'read-b', 'read-c'])
  assert.equal(harness.controller.getSnapshot().rows[0].read, true)

  // A store push / refresh keeps the expanded row at the same index.
  await harness.controller.refresh()
  assert.deepEqual(ids(), ['target', 'read-a', 'read-b', 'read-c'])

  // A live inbox:changed push (a newer read row arriving) keeps the expanded
  // row in place while the rest re-sorts around it.
  harness.setEntries([
    ...harness.entries(),
    entry({ id: 'read-d', actions: ['done'], status: 'done', createdAt: 5 }),
  ])
  await harness.controller.refresh()
  assert.deepEqual(ids(), ['target', 'read-d', 'read-a', 'read-b', 'read-c'])

  // Collapsing keeps the frozen slot: the row does not jump into the read
  // section while the notebook stays open.
  await harness.controller.toggleRow('target')
  assert.equal(harness.controller.getSnapshot().expandedId, null)
  assert.deepEqual(ids(), ['read-d', 'target', 'read-a', 'read-b', 'read-c'])

  // Closing drops the frozen order, so reopening shows the read order.
  await harness.controller.toggleRow('target')
  harness.controller.close()
  await harness.controller.open()
  assert.deepEqual(ids(), ['read-d', 'read-a', 'read-b', 'read-c', 'target'])
})

test('the injected clock drops entries older than 15 days', async () => {
  const day = 24 * 60 * 60 * 1000
  const harness = createHarness([
    entry({ id: 'boundary', createdAt: 15 * day }),
    entry({ id: 'too-old', createdAt: 15 * day - 1 }),
  ])
  harness.clock.advance(30 * day)

  await harness.controller.open()

  assert.deepEqual(harness.controller.getSnapshot().rows.map((row) => row.id), ['boundary'])
})

test('expanding an already-read row does not write its status again', async () => {
  const harness = createHarness([
    entry({ id: 'read', actions: [], status: 'done', fullBody: 'already read' }),
  ])
  await harness.controller.open()

  await harness.controller.toggleRow('read')

  assert.equal(harness.controller.getSnapshot().expandedId, 'read')
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

test('the note view follows unseen entries and ignores snoozed rows', async () => {
  const harness = createHarness([])
  await harness.controller.open()
  assert.equal(harness.controller.getSnapshot().note.state, 'none')

  harness.setEntries([entry({ id: 'one', actions: [], priority: 'normal' })])
  await harness.controller.refresh()
  assert.equal(harness.controller.getSnapshot().note.state, 'one')

  harness.setEntries([
    entry({ id: 'stack-1', actions: [], priority: 'normal', createdAt: 3 }),
    entry({ id: 'stack-2', actions: [], priority: 'normal', createdAt: 2 }),
    entry({ id: 'stack-3', actions: [], priority: 'normal', createdAt: 1 }),
  ])
  await harness.controller.refresh()
  assert.equal(harness.controller.getSnapshot().note.state, 'stack')

  harness.setEntries([entry({ id: 'important', actions: ['done'], priority: 'normal' })])
  await harness.controller.refresh()
  assert.equal(harness.controller.getSnapshot().note.state, 'important')

  // A snoozed entry keeps its unread status but contributes no sheet.
  await harness.controller.runAction('important', 'snooze')
  assert.equal(harness.controller.getSnapshot().note.state, 'none')
  assert.equal(harness.entries()[0].status, 'unread')
})

test('markSeen writes done for plain lines and read for actionable and letter rows', async () => {
  const harness = createHarness([
    entry({ id: 'plain-1', actions: [], priority: 'normal', createdAt: 7 }),
    entry({ id: 'plain-2', actions: [], priority: 'normal', createdAt: 6 }),
    entry({ id: 'actionable', actions: ['done'], createdAt: 5 }),
    entry({ id: 'letter', source: 'letter', actions: [], priority: 'normal', createdAt: 4 }),
    entry({ id: 'already-read', actions: [], status: 'read', createdAt: 3 }),
    entry({ id: 'already-done', actions: [], status: 'done', createdAt: 2 }),
  ])
  await harness.controller.open()
  assert.deepEqual(
    harness.controller.getSnapshot().openingUnseenIds,
    ['actionable', 'plain-1', 'plain-2', 'letter'],
  )

  await harness.controller.markSeen([
    'plain-1',
    'plain-2',
    'actionable',
    'letter',
    'already-read',
    'already-done',
    'plain-1',
  ])

  assert.deepEqual(harness.updates, [
    { id: 'plain-1', status: 'done' },
    { id: 'plain-2', status: 'done' },
    { id: 'actionable', status: 'read' },
    { id: 'letter', status: 'read' },
  ])
  assert.equal(harness.controller.getSnapshot().unreadCount, 0)
})

test('markSeen does nothing while the notebook is closed and never double-writes', async () => {
  const harness = createHarness([entry({ id: 'a', actions: [], priority: 'normal' })])
  await harness.controller.markSeen(['a'])
  assert.deepEqual(harness.updates, [])

  await harness.controller.open()
  await Promise.all([
    harness.controller.markSeen(['a']),
    harness.controller.markSeen(['a']),
  ])
  assert.deepEqual(harness.updates, [{ id: 'a', status: 'done' }])
})

test('the notebook keeps its opening order after markSeen and re-sorts on reopen', async () => {
  const harness = createHarness([
    entry({ id: 'unseen-1', actions: [], priority: 'normal', createdAt: 2 }),
    entry({ id: 'unseen-2', actions: [], priority: 'normal', createdAt: 1 }),
    entry({ id: 'old-done', actions: ['done'], status: 'done', createdAt: 10 }),
  ])
  const ids = () => harness.controller.getSnapshot().rows.map((row) => row.id)

  await harness.controller.open()
  assert.deepEqual(ids(), ['unseen-1', 'unseen-2', 'old-done'])
  assert.equal(harness.controller.getSnapshot().dividerBeforeId, 'old-done')

  await harness.controller.markSeen(['unseen-1', 'unseen-2'])
  // Both rows are handled now, but the opening order still holds.
  assert.deepEqual(ids(), ['unseen-1', 'unseen-2', 'old-done'])

  harness.controller.close()
  await harness.controller.open()
  // A new opening sorts all handled rows newest first.
  assert.deepEqual(ids(), ['old-done', 'unseen-1', 'unseen-2'])
})

test('the opening line covers empty, seen-only, one, reason and generic cases', async () => {
  const empty = createHarness([])
  await empty.controller.open()
  assert.equal(
    empty.controller.getSnapshot().openingKey,
    'pet.proactive.notebook_opening_empty',
  )

  const seenOnly = createHarness([entry({ id: 'seen', actions: [], status: 'read' })])
  await seenOnly.controller.open()
  assert.equal(
    seenOnly.controller.getSnapshot().openingKey,
    'pet.proactive.notebook_opening_seen_only',
  )

  const one = createHarness([entry({ id: 'one', actions: [], priority: 'normal' })])
  await one.controller.open()
  assert.equal(one.controller.getSnapshot().openingKey, 'pet.proactive.notebook_opening_one')

  const twoUnseen = () => [
    entry({ id: 'first', actions: [], priority: 'normal', createdAt: 2 }),
    entry({ id: 'second', actions: [], priority: 'normal', createdAt: 1 }),
  ]
  const away = createHarness(twoUnseen())
  await away.controller.open({ reason: 'away' })
  assert.equal(away.controller.getSnapshot().openingKey, 'pet.proactive.notebook_opening_away')

  const busy = createHarness(twoUnseen())
  await busy.controller.open({ reason: 'busy' })
  assert.equal(busy.controller.getSnapshot().openingKey, 'pet.proactive.notebook_opening_busy')

  const generic = createHarness(twoUnseen())
  await generic.controller.open()
  assert.equal(
    generic.controller.getSnapshot().openingKey,
    'pet.proactive.notebook_opening_generic',
  )
})

test('the divider appears before the first handled row only below an unhandled row', async () => {
  const mixed = createHarness([
    entry({ id: 'unhandled', actions: [], priority: 'normal', createdAt: 1 }),
    entry({ id: 'handled', actions: ['done'], status: 'done', createdAt: 2 }),
  ])
  await mixed.controller.open()
  assert.equal(mixed.controller.getSnapshot().dividerBeforeId, 'handled')

  const allHandled = createHarness([
    entry({ id: 'done-a', actions: ['done'], status: 'done', createdAt: 2 }),
    entry({ id: 'done-b', actions: ['done'], status: 'done', createdAt: 1 }),
  ])
  await allHandled.controller.open()
  assert.equal(allHandled.controller.getSnapshot().dividerBeforeId, null)

  const allUnhandled = createHarness([
    entry({ id: 'unhandled-a', actions: [], priority: 'normal', createdAt: 2 }),
    entry({ id: 'unhandled-b', actions: [], priority: 'normal', createdAt: 1 }),
  ])
  await allUnhandled.controller.open()
  assert.equal(allUnhandled.controller.getSnapshot().dividerBeforeId, null)
})

test('snoozing an actionable entry keeps it unseen and returns it on top', async () => {
  const harness = createHarness([
    entry({ id: 'actionable', actions: ['done', 'snooze'], createdAt: 2 }),
    entry({ id: 'plain', actions: [], priority: 'normal', createdAt: 1 }),
  ])
  const ids = () => harness.controller.getSnapshot().rows.map((row) => row.id)
  await harness.controller.open()
  assert.deepEqual(ids(), ['actionable', 'plain'])
  assert.equal(harness.controller.getSnapshot().note.state, 'important')

  await harness.controller.runAction('actionable', 'snooze')
  assert.deepEqual(harness.updates, [])
  assert.deepEqual(ids(), ['plain'])
  assert.equal(harness.controller.getSnapshot().note.state, 'one')
  assert.equal(harness.entries()[0].status, 'unread')

  harness.clock.advance(PROACTIVE_INBOX_SNOOZE_MS - 1)
  await flushAsync()
  assert.deepEqual(ids(), ['plain'])

  harness.clock.advance(1)
  await flushAsync()
  assert.equal(harness.deliveries.length, 1)
  assert.deepEqual(ids(), ['actionable', 'plain'])
  assert.equal(harness.controller.getSnapshot().note.state, 'important')
})
