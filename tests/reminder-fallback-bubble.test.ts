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

import React from 'react'

import { PROACTIVE_BUBBLE_AFTER_HOVER_COLLAPSE_MS, PROACTIVE_BUBBLE_AUTO_COLLAPSE_MS } from '../src/features/proactive/proactiveCollapse.ts'
import type { CompanionNoticePayload } from '../src/hooks/chat/types.ts'
import type { AppSettings, PetDialogBubbleState, ReminderTask } from '../src/types/index.ts'

register(new URL('./helpers/bundler-import-hooks.mjs', import.meta.url))

const { usePetDialogBubbles } = await import('../src/hooks/chat/usePetDialogBubbles.ts')
const { useCompanionNotices } = await import('../src/hooks/chat/useCompanionNotices.ts')
const { useReminderController } = await import('../src/app/controllers/useReminderController.ts')
const { LegacyPetDialogLayer } = await import('../src/app/views/LegacyPetDialogLayer.tsx')

type ReactInternals = { H: unknown }
const reactInternals = (React as unknown as {
  __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: ReactInternals
}).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE

type EffectSlot = {
  deps?: readonly unknown[]
  callback?: () => void | (() => void)
  cleanup?: () => void
  run?: boolean
}

type CallbackSlot = { fn: unknown; deps?: readonly unknown[] }

function depsChanged(previous: readonly unknown[] | undefined, next: readonly unknown[] | undefined) {
  if (!previous || !next) return true
  return previous.length !== next.length || next.some((dep, index) => !Object.is(dep, previous[index]))
}

type Timer = { at: number; callback: () => void }

function createClock() {
  let now = 0
  let nextId = 1
  const timers = new Map<number, Timer>()

  return {
    setTimeout(callback: () => void, delay?: number) {
      const id = nextId++
      timers.set(id, { at: now + (delay ?? 0), callback })
      return id
    },
    clearTimeout(id: number) {
      timers.delete(id)
    },
    tick(ms: number) {
      const target = now + ms
      for (;;) {
        let next: { id: number; timer: Timer } | null = null
        for (const [id, timer] of timers) {
          if (timer.at > target) continue
          if (!next || timer.at < next.timer.at) next = { id, timer }
        }
        if (!next) break
        timers.delete(next.id)
        now = next.timer.at
        next.timer.callback()
      }
      now = target
    },
  }
}

type ControllerOptions = Parameters<typeof useReminderController>[0]
type NoticeDependencies = Parameters<typeof useCompanionNotices>[0]

type ProbeProps = {
  settingsRef: ControllerOptions['settingsRef']
  runtimeSnapshot: ControllerOptions['runtimeSnapshot']
  ctx: NoticeDependencies['ctx']
  t: NoticeDependencies['t']
  busyRef: NoticeDependencies['busyRef']
  appendChatMessage: NoticeDependencies['appendChatMessage']
  setError: NoticeDependencies['setError']
  appendSystemMessage: ControllerOptions['chat']['appendSystemMessage']
  sendMessage: ControllerOptions['chat']['sendMessage']
  updatePetStatus: ControllerOptions['pet']['updatePetStatus']
  appendDebugConsoleEvent: ControllerOptions['debugConsole']['appendDebugConsoleEvent']
}

type ControllerApi = {
  bubble: PetDialogBubbleState | null
  hide: () => void
  trigger: (task: ReminderTask) => Promise<void>
  push: (payload: CompanionNoticePayload) => Promise<void>
}

function ControllerProbe(props: ProbeProps): ControllerApi {
  const bubbles = usePetDialogBubbles()
  const notices = useCompanionNotices({
    ctx: props.ctx,
    t: props.t,
    busyRef: props.busyRef,
    appendChatMessage: props.appendChatMessage,
    presentPetDialogBubble: bubbles.presentPetDialogBubble,
    setError: props.setError,
  })
  const controller = useReminderController({
    view: 'panel',
    settingsRef: props.settingsRef,
    runtimeSnapshot: props.runtimeSnapshot,
    focusState: 'active',
    chat: {
      pushCompanionNotice: notices.pushCompanionNotice,
      appendSystemMessage: props.appendSystemMessage,
      sendMessage: props.sendMessage,
    },
    pet: { updatePetStatus: props.updatePetStatus },
    debugConsole: { appendDebugConsoleEvent: props.appendDebugConsoleEvent },
    reminderTaskStore: {
      reminderTasks: [],
      setReminderTasks: () => {},
    },
  })

  return {
    bubble: bubbles.petDialogBubble,
    hide: bubbles.hidePetDialogBubble,
    trigger: controller.handleReminderTaskTrigger,
    push: notices.pushCompanionNotice,
  }
}

function createControllerRenderer() {
  const slots: unknown[] = []
  const effects: EffectSlot[] = []
  let cursor = 0
  let props: ProbeProps
  let tree: ControllerApi | null = null
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
        else renderNow()
      }
      return [slots[index], setState]
    },
    useRef(initial: unknown) {
      const index = cursor++
      if (!(index in slots)) slots[index] = { current: initial }
      return slots[index]
    },
    useCallback(fn: unknown, deps?: readonly unknown[]) {
      const index = cursor++
      const previous = slots[index] as CallbackSlot | undefined
      if (!previous || depsChanged(previous.deps, deps)) slots[index] = { fn, deps }
      return (slots[index] as CallbackSlot).fn
    },
    useEffect(callback: () => void | (() => void), deps?: readonly unknown[]) {
      const index = cursor++
      const previous = effects[index]
      const changed = !previous || depsChanged(previous.deps, deps)
      if (changed) effects[index] = { deps, callback, cleanup: previous?.cleanup, run: true }
    },
    useContext() {
      cursor += 1
      return null
    },
  }

  function renderNow() {
    cursor = 0
    rerender = false
    depth += 1
    if (depth > 8) throw new Error('controller renderer did not settle')
    commit = true
    reactInternals.H = dispatcher
    try {
      tree = ControllerProbe(props)
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
    render(next: ProbeProps) {
      props = next
      depth = 0
      renderNow()
    },
    get api() {
      return tree
    },
    unmount() {
      for (const slot of effects) slot?.cleanup?.()
    },
  }
}

function createSettings(): AppSettings {
  return {
    uiLanguage: 'zh-CN',
    contextAwarenessEnabled: false,
    activeWindowContextEnabled: false,
    companionAwarenessPaused: false,
    proactiveQuietHoursStart: 0,
    proactiveQuietHoursEnd: 0,
    proactiveAwayNotificationsEnabled: false,
  } as unknown as AppSettings
}

function makeTask(): ReminderTask {
  return {
    id: 'task-1',
    title: 'Stand up',
    prompt: 'Time to move',
    action: { kind: 'notice' },
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    schedule: { kind: 'at', at: '2026-01-01T00:00:00.000Z' },
  }
}

function createControllerSession(options: { deliver?: () => Promise<never> } = {}) {
  const clock = createClock()
  const inboxUpdates: string[] = []
  const desktopPet: Record<string, unknown> = {
    updateProactiveInboxEntry: async (payload: { id: string; status: string }) => {
      inboxUpdates.push(`${payload.id}:${payload.status}`)
      return { updated: true, unreadCount: 0 }
    },
  }
  if (options.deliver) desktopPet.deliverProactiveMessage = options.deliver

  Object.defineProperty(globalThis, 'window', {
    value: {
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      desktopPet,
    },
    configurable: true,
    writable: true,
  })

  const props: ProbeProps = {
    settingsRef: { current: createSettings() },
    runtimeSnapshot: { mood: 'idle', panelOnline: false, petOnline: false },
    ctx: {
      speakAssistantReply: async () => {},
      voiceStateRef: { current: 'idle' },
    },
    t: (key) => key,
    busyRef: { current: false },
    appendChatMessage: () => {},
    setError: () => {},
    appendSystemMessage: () => {},
    sendMessage: async () => undefined,
    updatePetStatus: () => {},
    appendDebugConsoleEvent: () => {},
  }

  const renderer = createControllerRenderer()
  renderer.render(props)

  return {
    clock,
    inboxUpdates,
    get bubble() {
      return renderer.api?.bubble ?? null
    },
    trigger: (task: ReminderTask) => renderer.api!.trigger(task),
    push: (payload: CompanionNoticePayload) => renderer.api!.push(payload),
    hide: () => renderer.api!.hide(),
    unmount() {
      renderer.unmount()
      delete (globalThis as { window?: unknown }).window
    },
  }
}

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
