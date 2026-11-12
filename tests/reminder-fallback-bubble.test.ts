/**
 * The legacy fallback of a reminder (no router bridge, or the deliver call
 * throws) must still be a proactive bubble: 12 s untouched, never while
 * hovered, and a fixed 5 s after the pointer leaves. These tests drive the
 * real controller through the real notice hook and the real legacy dialog
 * layer, so a second timer implementation cannot hide the regression.
 */

import assert from 'node:assert/strict'
import { register } from 'node:module'
import { test } from 'node:test'

import { PROACTIVE_BUBBLE_AFTER_HOVER_COLLAPSE_MS, PROACTIVE_BUBBLE_AUTO_COLLAPSE_MS } from '../src/features/proactive/proactiveCollapse.ts'
import { InterruptedError } from '../src/features/voice/interruptedError.ts'
import type { PetDialogBubbleState, ReminderTask } from '../src/types/index.ts'
import type { DeliveryPayload } from './helpers/reminderControllerHarness.ts'

register(new URL('./helpers/bundler-import-hooks.mjs', import.meta.url))

const { LegacyPetDialogLayer } = await import('../src/app/views/LegacyPetDialogLayer.tsx')
const { createControllerSession, makeTask, reactInternals } = await import('./helpers/reminderControllerHarness.ts')

// ── Legacy dialog layer renderer (same pattern as legacy-proactive-bubble) ──

type ElementLike = {
  type: unknown
  props: Record<string, unknown> & { children?: unknown }
}

function isElement(node: unknown): node is ElementLike {
  return Boolean(node) && typeof node === 'object' && node !== null && 'props' in node
}

function findElements(
  node: unknown,
  predicate: (element: ElementLike) => boolean,
  found: ElementLike[] = [],
): ElementLike[] {
  if (Array.isArray(node)) {
    for (const child of node) findElements(child, predicate, found)
    return found
  }
  if (!isElement(node)) return found
  if (predicate(node)) found.push(node)
  findElements(node.props.children, predicate, found)
  return found
}

function findElement(node: unknown, predicate: (element: ElementLike) => boolean): ElementLike {
  const found = findElements(node, predicate)
  assert.ok(found[0], 'expected element was not rendered')
  return found[0]
}

function layerElement(tree: unknown): ElementLike {
  return findElement(tree, (element) => element.props.className === 'pet-window__dialog-layer')
}

function bubbleElement(tree: unknown): ElementLike {
  return findElement(tree, (element) => (
    typeof (element.props.bubble as PetDialogBubbleState | undefined)?.content === 'string'
  ))
}

function triggerPointer(tree: unknown, event: 'onPointerEnter' | 'onPointerLeave'): void {
  const handler = layerElement(tree).props[event]
  if (typeof handler === 'function') (handler as () => void)()
}

function shownContent(tree: unknown): string {
  return (bubbleElement(tree).props.bubble as PetDialogBubbleState).content
}

function createLayerRenderer<P>(component: (props: P) => unknown) {
  const slots: unknown[] = []
  const effects: EffectSlot[] = []
  let cursor = 0
  let props: P
  let tree: unknown
  let commit = false
  let rerender = false
  let depth = 0

  const dispatcher = {
    useState(initial: unknown) {
      const index = cursor++
      if (!(index in slots)) {
        slots[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial
      }
      const setState = (next: unknown) => {
        const resolved = typeof next === 'function'
          ? (next as (prev: unknown) => unknown)(slots[index])
          : next
        if (Object.is(resolved, slots[index])) return
        slots[index] = resolved
        if (commit) rerender = true
      }
      return [slots[index], setState]
    },
    useRef(initial: unknown) {
      const index = cursor++
      if (!(index in slots)) slots[index] = { current: initial }
      return slots[index]
    },
    useCallback(fn: unknown) {
      cursor += 1
      return fn
    },
    useMemo(fn: () => unknown) {
      cursor += 1
      return fn()
    },
    useEffect(callback: () => void | (() => void), deps?: readonly unknown[]) {
      const index = cursor++
      const prev = effects[index]
      const changed = !prev
        || deps === undefined
        || prev.deps === undefined
        || deps.length !== prev.deps.length
        || deps.some((dep, i) => !Object.is(dep, prev.deps![i]))
      if (changed) effects[index] = { deps, callback, cleanup: prev?.cleanup, run: true }
    },
  }

  function renderNow() {
    cursor = 0
    rerender = false
    depth += 1
    if (depth > 6) throw new Error('layer renderer did not settle')
    commit = true
    reactInternals.H = dispatcher
    try {
      tree = component(props)
      for (const slot of effects) {
        if (!slot?.run) continue
        slot.run = false
        slot.cleanup?.()
        const cleanup = slot.callback?.()
        slot.cleanup = typeof cleanup === 'function' ? cleanup : undefined
      }
    } finally {
      reactInternals.H = null
      commit = false
    }
    if (rerender) renderNow()
    depth -= 1
  }

  return {
    render(next: P) {
      props = next
      depth = 0
      renderNow()
      return tree
    },
    unmount() {
      for (const slot of effects) slot?.cleanup?.()
    },
  }
}

function makeLayerProps(bubble: PetDialogBubbleState, onCollapse: () => void) {
  return { bubble, assistantName: '星绘', onCollapse }
}

const ROUTING_FAILURES: Array<{ label: string; deliver?: () => Promise<never> }> = [
  { label: 'routing unavailable' },
  {
    label: 'routing throws',
    deliver: async () => {
      throw new Error('router offline')
    },
  },
]

for (const failure of ROUTING_FAILURES) {
  test(`${failure.label}: the fallback reminder bubble collapses at exactly 12 s`, async () => {
    const session = createControllerSession({ deliver: failure.deliver })
    const layer = createLayerRenderer(LegacyPetDialogLayer)
    let hides = 0
    try {
      await session.trigger(makeTask())
      const bubble = session.bubble
      assert.ok(bubble)
      assert.equal(bubble.proactiveTitle, 'Stand up')
      assert.equal(bubble.content, 'Time to move')
      const onCollapse = () => {
        hides += 1
        session.hide()
      }

      assert.equal(shownContent(layer.render(makeLayerProps(bubble, onCollapse))), 'Stand up')
      session.clock.tick(PROACTIVE_BUBBLE_AUTO_COLLAPSE_MS - 100)
      assert.equal(hides, 0)
      assert.ok(session.bubble)
      session.clock.tick(100)
      assert.equal(hides, 1)
      assert.equal(session.bubble, null)
      assert.deepEqual(session.inboxUpdates, [])
    } finally {
      layer.unmount()
      session.unmount()
    }
  })
}

test('hovering the fallback reminder holds it for 20 s and leaving collapses it at 5 s', async () => {
  const session = createControllerSession()
  const layer = createLayerRenderer(LegacyPetDialogLayer)
  let hides = 0
  try {
    await session.trigger(makeTask())
    const bubble = session.bubble
    assert.ok(bubble)
    const onCollapse = () => {
      hides += 1
      session.hide()
    }

    assert.equal(shownContent(layer.render(makeLayerProps(bubble, onCollapse))), 'Stand up')
    triggerPointer(layer.render(makeLayerProps(bubble, onCollapse)), 'onPointerEnter')
    layer.render(makeLayerProps(bubble, onCollapse))
    session.clock.tick(20_000)
    assert.equal(hides, 0)
    assert.ok(session.bubble)

    triggerPointer(layer.render(makeLayerProps(bubble, onCollapse)), 'onPointerLeave')
    layer.render(makeLayerProps(bubble, onCollapse))
    session.clock.tick(PROACTIVE_BUBBLE_AFTER_HOVER_COLLAPSE_MS - 100)
    assert.equal(hides, 0)
    assert.ok(session.bubble)

    session.clock.tick(100)
    assert.equal(hides, 1)
    assert.equal(session.bubble, null)
    assert.deepEqual(session.inboxUpdates, [])
  } finally {
    layer.unmount()
    session.unmount()
  }
})

test('a non-proactive companion notice still auto-hides with its own timer', async () => {
  const session = createControllerSession()
  try {
    await session.push({
      chatContent: '',
      bubbleContent: 'Plain companion notice',
      speechContent: '',
    })
    const bubble = session.bubble
    assert.ok(bubble)
    assert.equal(bubble.proactiveTitle, undefined)
    assert.equal(bubble.content, 'Plain companion notice')

    session.clock.tick(13_999)
    assert.ok(session.bubble)
    session.clock.tick(1)
    assert.equal(session.bubble, null)
  } finally {
    session.unmount()
  }
})

test('an interrupted companion notice requeues and replays once instead of being dropped', async () => {
  const errors: Array<string | null> = []
  const speech: string[] = []
  const pending: Array<{ resolve: () => void; reject: (error: unknown) => void }> = []
  const session = createControllerSession({
    speakAssistantReply: (text) => {
      speech.push(text)
      return new Promise<void>((resolve, reject) => { pending.push({ resolve, reject }) })
    },
    onError: (value) => errors.push(value),
  })
  try {
    const first = session.push({ chatContent: '', bubbleContent: 'Stopped notice', speechContent: 'Stopped speech', dedupeKey: 'stop-ok' })
    for (let index = 0; index < 4; index += 1) await Promise.resolve()
    assert.deepEqual(speech, ['Stopped speech'])

    pending.shift()!.reject(new InterruptedError('interrupt'))
    await first
    assert.deepEqual(errors, [], 'a clean interrupt is not a playback error')

    const replay = session.flush()
    for (let index = 0; index < 4; index += 1) await Promise.resolve()
    assert.deepEqual(speech, ['Stopped speech', 'Stopped speech'], 'the notice is replayed once')
    pending.shift()!.resolve()
    await replay
  } finally {
    session.unmount()
  }
})

test('a companion notice speech failure stays silent and keeps the notice on screen', async () => {
  const errors: Array<string | null> = []
  const session = createControllerSession({
    speakAssistantReply: async () => { throw new Error('real playback failure') },
    onError: (value) => errors.push(value),
  })
  try {
    await session.push({ chatContent: '', bubbleContent: 'Failed notice', speechContent: 'Failed speech', dedupeKey: 'stop-fail' })
    assert.deepEqual(errors, [], 'a notice voice failure is log-only')
    assert.equal(session.bubble?.content, 'Failed notice', 'the delivered bubble survives the voice failure')
  } finally {
    session.unmount()
  }
})

test('a reminder whose speech fails keeps chat and bubble without surfacing an error', async () => {
  const errors: Array<string | null> = []
  const chatLines: string[] = []
  const speeches: string[] = []
  const session = createControllerSession({
    speakAssistantReply: async (text) => {
      speeches.push(text)
      throw new Error('real playback failure')
    },
    onError: (value) => errors.push(value),
    appendChatMessage: (message) => { chatLines.push(message.content) },
  })
  try {
    await session.trigger(makeTask())
    assert.equal(speeches.length, 1, 'the reminder used the ordinary playback path')
    assert.match(speeches[0] ?? '', /Time to move/)
    assert.equal(chatLines.length, 1, 'the reminder chat line survives the voice failure')
    assert.match(chatLines[0] ?? '', /Time to move/)
    assert.equal(session.bubble?.content, 'Time to move', 'the reminder bubble survives the voice failure')
    assert.deepEqual(errors, [], 'a reminder voice failure is log-only')
  } finally {
    session.unmount()
  }
})

test('a duplicate reminder occurrence never falls back to bubble, chat, speech or external channels', async () => {
  let payload: DeliveryPayload | null = null
  const chatLines: string[] = []
  const speeches: string[] = []
  const telegramMessages: string[] = []
  const session = createControllerSession({
    deliver: async (next) => {
      payload = next
      return { rule: 2, outlets: ['inbox', 'panel'], duplicate: true }
    },
    settings: {
      telegramPermissionMode: 'auto',
      ownerTelegramChatIds: '4242',
    },
    appendChatMessage: (message) => { chatLines.push(message.content) },
    speakAssistantReply: async (text) => { speeches.push(text) },
    telegramSendMessage: async ({ text }) => { telegramMessages.push(text) },
  })
  const dueAt = '2026-01-01T00:05:00.000Z'
  try {
    await session.trigger({ ...makeTask(), nextRunAt: dueAt })
    assert.equal(payload?.message.origin?.occurrenceDueAt, Date.parse(dueAt))
    assert.equal(session.bubble, null)
    assert.deepEqual(session.inboxUpdates, [])
    assert.deepEqual(chatLines, [], 'no duplicate chat line')
    assert.deepEqual(speeches, [], 'no duplicate speech')
    assert.deepEqual(telegramMessages, [], 'no duplicate external channel send')
  } finally {
    session.unmount()
  }
})

test('panel handoff refreshes reminders against the pet last online instant', () => {
  const now = Date.now()
  const dueAt = new Date(now - 3 * 60_000).toISOString()
  const petLastSeenAt = new Date(now - 2 * 60_000 - 40_000).toISOString()
  const task: ReminderTask = {
    ...makeTask(),
    schedule: { kind: 'at', at: dueAt },
    nextRunAt: dueAt,
  }
  let tasks = [task]
  const refreshedNextRuns: Array<string | undefined> = []
  const session = createControllerSession({
    runtimeSnapshot: {
      mood: 'idle',
      panelOnline: true,
      petOnline: false,
      petLastSeenAt,
    },
    reminderTasks: tasks,
    setReminderTasks: (updater) => {
      tasks = typeof updater === 'function' ? updater(tasks) : updater
      refreshedNextRuns.push(tasks[0]?.nextRunAt)
    },
    deliver: async () => ({ rule: 1, outlets: ['inbox', 'badge'] }),
  })
  try {
    assert.ok(
      refreshedNextRuns.includes(dueAt),
      'the due instant survives because it is within grace of petLastSeenAt',
    )
  } finally {
    session.unmount()
  }
})

const TAKEOVER_NON_NOTICE_ACTIONS = [
  { label: 'weather', action: { kind: 'weather', location: 'Beijing' } },
  { label: 'web search', action: { kind: 'web_search', query: 'news', limit: 5 } },
  { label: 'scheduled chat action', action: { kind: 'chat_action', instruction: 'say hello' } },
] as const

for (const { label, action } of TAKEOVER_NON_NOTICE_ACTIONS) {
  test(`the panel controller leaves a due ${label} unmarked for the pet window`, async () => {
    const dueAt = Date.now() - 1_000
    const task: ReminderTask = {
      ...makeTask(),
      action: action as ReminderTask['action'],
      schedule: { kind: 'at', at: new Date(dueAt).toISOString() },
      nextRunAt: new Date(dueAt).toISOString(),
    }
    const delivered: DeliveryPayload[] = []
    const session = createControllerSession({
      runtimeSnapshot: {
        mood: 'idle',
        panelOnline: true,
        petOnline: false,
        petLastSeenAt: new Date(dueAt - 10_000).toISOString(),
      },
      reminderTasks: [task],
      setReminderTasks: () => {},
      deliver: async (payload) => {
        delivered.push(payload)
        return { rule: 1, outlets: ['inbox', 'badge'] }
      },
    })
    try {
      await new Promise((resolve) => setImmediate(resolve))
      assert.deepEqual(delivered, [], 'the panel does not execute the action')
      assert.deepEqual(session.readReminderTasks(), [], 'the panel does not mark the occurrence')
      assert.equal(session.bubble, null)
    } finally {
      session.unmount()
    }
  })
}

test('the panel controller still delivers and marks a due notice', async () => {
  const dueAt = Date.now() - 1_000
  const task: ReminderTask = {
    ...makeTask(),
    schedule: { kind: 'at', at: new Date(dueAt).toISOString() },
    nextRunAt: new Date(dueAt).toISOString(),
  }
  const delivered: DeliveryPayload[] = []
  const session = createControllerSession({
    runtimeSnapshot: {
      mood: 'idle',
      panelOnline: true,
      petOnline: false,
      petLastSeenAt: new Date(dueAt - 10_000).toISOString(),
    },
    reminderTasks: [task],
    setReminderTasks: () => {},
    deliver: async (payload) => {
      delivered.push(payload)
      return { rule: 1, outlets: ['inbox', 'badge'] }
    },
  })
  try {
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(delivered.length, 1)
    assert.equal(typeof session.readReminderTasks()[0]?.lastTriggeredAt, 'string')
  } finally {
    session.unmount()
  }
})
