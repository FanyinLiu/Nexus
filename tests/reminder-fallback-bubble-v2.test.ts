/**
 * The legacy reminder fallback (no router bridge, or the deliver call throws)
 * must reach the default v2 surface as a proactive caption: 12 s untouched,
 * never while hovered, and a fixed 5 s after the pointer leaves. These tests
 * drive the real controller through the real notice hook, the real bubble
 * store and the real FramelessCompanionSurface caption, so the v2 surface
 * cannot drift away from the fallback path.
 */

import assert from 'node:assert/strict'
import { register } from 'node:module'
import { test } from 'node:test'

import React from 'react'

import {
  PROACTIVE_BUBBLE_AFTER_HOVER_COLLAPSE_MS,
  PROACTIVE_BUBBLE_AUTO_COLLAPSE_MS,
} from '../src/features/proactive/proactiveCollapse.ts'
import type {
  AppSettings,
  PetDialogBubbleState,
  ReminderTask,
  RuntimeStateSnapshot,
} from '../src/types/index.ts'
import type { PetModelDefinition } from '../src/features/pet/models.ts'

register(new URL('./helpers/bundler-import-hooks.mjs', import.meta.url))

const { usePetDialogBubbles } = await import('../src/hooks/chat/usePetDialogBubbles.ts')
const { useCompanionNotices } = await import('../src/hooks/chat/useCompanionNotices.ts')
const { useReminderController } = await import('../src/app/controllers/useReminderController.ts')
const { FramelessCompanionSurface } = await import('../src/features/uiV2/FramelessCompanionSurface.tsx')

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
type MemoSlot = { value: unknown; deps?: readonly unknown[] }

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

/**
 * Minimal hook dispatcher that runs the controller hooks and the surface
 * function in one stable slot order. The surface is invoked as a function so
 * the caption under test is the real `useReadableCaption`, not a stub.
 */
function createRenderer<P>(component: (props: P) => unknown) {
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
    useMemo(factory: () => unknown, deps?: readonly unknown[]) {
      const index = cursor++
      const previous = slots[index] as MemoSlot | undefined
      if (!previous || depsChanged(previous.deps, deps)) {
        slots[index] = { value: factory(), deps }
      }
      return (slots[index] as MemoSlot).value
    },
    useEffect(callback: () => void | (() => void), deps?: readonly unknown[]) {
      const index = cursor++
      const previous = effects[index]
      const changed = !previous || depsChanged(previous.deps, deps)
      if (changed) effects[index] = { deps, callback, cleanup: previous?.cleanup, run: true }
    },
    useLayoutEffect(callback: () => void | (() => void), deps?: readonly unknown[]) {
      this.useEffect(callback, deps)
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
    if (depth > 10) throw new Error('surface renderer did not settle')
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
    get tree() {
      return tree
    },
    unmount() {
      for (const slot of effects) slot?.cleanup?.()
    },
  }
}

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

function captionElement(tree: unknown): ElementLike {
  return findElement(tree, (element) => (
    element.props.className === 'nexus-companion-v2__caption nexus-v2-interactive'
  ))
}

function captionText(tree: unknown): string {
  const found: string[] = []
  for (const caption of findElements(tree, (element) => (
    element.props.className === 'nexus-companion-v2__caption nexus-v2-interactive'
  ))) {
    const walk = (node: unknown) => {
      if (Array.isArray(node)) {
        for (const child of node) walk(child)
        return
      }
      if (typeof node === 'string') found.push(node)
      else if (isElement(node)) walk(node.props.children)
    }
    walk(caption.props.children)
  }
  return found.join('')
}

function triggerCaptionPointer(tree: unknown, event: 'onPointerEnter' | 'onPointerLeave'): void {
  const handler = captionElement(tree).props[event]
  if (typeof handler === 'function') (handler as () => void)()
}

function createSettings(): AppSettings {
  return {
    uiLanguage: 'zh-CN',
    companionName: '星绘',
    companionBackdropEnabled: false,
    gazeFollowEnabled: false,
    continuousVoiceModeEnabled: false,
    contextAwarenessEnabled: false,
    activeWindowContextEnabled: false,
    companionAwarenessPaused: false,
    proactiveQuietHoursStart: 0,
    proactiveQuietHoursEnd: 0,
    proactiveAwayNotificationsEnabled: false,
  } as unknown as AppSettings
}

function makePetModel(): PetModelDefinition {
  return {
    id: 'test',
    label: 'test',
    description: 'test',
    modelPath: '',
    fallbackImagePath: '',
    motionGroups: { gestures: {} },
    expressionMap: {},
  } as PetModelDefinition
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

type ControllerOptions = Parameters<typeof useReminderController>[0]
type NoticeDependencies = Parameters<typeof useCompanionNotices>[0]
type SurfaceProps = Parameters<typeof FramelessCompanionSurface>[0]

type ProbeApi = {
  bubble: PetDialogBubbleState | null
  trigger: (task: ReminderTask) => Promise<void>
}

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
  surface: SurfaceProps
}

function SurfaceProbe(props: ProbeProps) {
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
    type: 'ReminderFallbackProbe',
    props: {
      api: {
        bubble: bubbles.petDialogBubble,
        trigger: controller.handleReminderTaskTrigger,
      } satisfies ProbeApi,
      children: FramelessCompanionSurface({
        ...props.surface,
        chat: {
          ...props.surface.chat,
          petDialogBubble: bubbles.petDialogBubble,
          hidePetDialogBubble: bubbles.hidePetDialogBubble,
        },
      }),
    },
  }
}

/** The probe wraps the surface tree and exposes the controller API it built. */
function probeApi(tree: unknown): ProbeApi {
  assert.ok(isElement(tree), 'expected the probe wrapper to be rendered')
  const api = tree.props.api
  assert.ok(api && typeof api === 'object', 'expected the probe api to be rendered')
  return api as ProbeApi
}

function surfaceProps(): SurfaceProps {
  return {
    settings: createSettings(),
    petModel: makePetModel(),
    pet: {
      mood: 'idle',
      petTapActive: false,
      petTouchZone: null,
      gazeTarget: { x: 0, y: 0 },
      setGazeTarget: () => {},
      setPetHotspotActive: () => {},
      setMascotHovered: () => {},
      markPresenceActivity: () => {},
      setPetTapActive: () => {},
      setPetTouchZone: () => {},
    },
    voice: {
      voiceState: 'idle',
      speechLevelSource: { current: 0, getSnapshot: () => 0, subscribe: () => () => {} },
      continuousVoiceActive: false,
      toggleVoiceConversation: () => {},
      stopVoiceConversation: () => {},
    },
    chat: {
      assistantActivity: 'idle',
      busy: false,
      error: null,
      petDialogBubble: null,
      cancelActiveTurn: () => {},
      hidePetDialogBubble: () => {},
    },
    isPinned: false,
    clickThrough: false,
    runtimeSnapshot: {
      mood: 'idle',
      panelOnline: false,
      petOnline: false,
    } as RuntimeStateSnapshot,
    openSettingsPanel: () => {},
    openChatPanelForVoice: () => {},
    openPetMenu: () => {},
    togglePinned: () => {},
    toggleClickThrough: () => {},
  }
}

function createSession(options: { deliver?: () => Promise<never> } = {}) {
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
    surface: surfaceProps(),
  }

  const renderer = createRenderer(SurfaceProbe)
  renderer.render(props)

  return {
    clock,
    inboxUpdates,
    render: () => renderer.render(props),
    get bubble() {
      return probeApi(renderer.tree).bubble
    },
    trigger(task: ReminderTask) {
      return probeApi(renderer.tree).trigger(task)
    },
    unmount() {
      renderer.unmount()
      delete (globalThis as { window?: unknown }).window
    },
  }
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
  test(`${failure.label}: the v2 fallback reminder caption collapses at exactly 12 s`, async () => {
    const session = createSession({ deliver: failure.deliver })
    try {
      await session.trigger(makeTask())
      const bubble = session.bubble
      assert.ok(bubble)
      assert.equal(bubble.proactiveTitle, 'Stand up')

      assert.equal(captionText(session.render()), 'Stand up')
      session.clock.tick(PROACTIVE_BUBBLE_AUTO_COLLAPSE_MS - 100)
      assert.equal(captionText(session.render()), 'Stand up')
      assert.ok(session.bubble)
      session.clock.tick(100)
      assert.equal(captionText(session.render()), '')
      assert.equal(session.bubble, null)
      assert.deepEqual(session.inboxUpdates, [])
    } finally {
      session.unmount()
    }
  })

  test(`${failure.label}: hovering the v2 fallback reminder holds it for 20 s and leaving collapses at 5 s`, async () => {
    const session = createSession({ deliver: failure.deliver })
    try {
      await session.trigger(makeTask())
      assert.equal(captionText(session.render()), 'Stand up')

      triggerCaptionPointer(session.render(), 'onPointerEnter')
      assert.equal(captionText(session.render()), 'Stand up')
      session.clock.tick(20_000)
      assert.equal(captionText(session.render()), 'Stand up')
      assert.ok(session.bubble)

      triggerCaptionPointer(session.render(), 'onPointerLeave')
      assert.equal(captionText(session.render()), 'Stand up')
      session.clock.tick(PROACTIVE_BUBBLE_AFTER_HOVER_COLLAPSE_MS - 100)
      assert.equal(captionText(session.render()), 'Stand up')
      assert.ok(session.bubble)

      session.clock.tick(100)
      assert.equal(captionText(session.render()), '')
      assert.equal(session.bubble, null)
      assert.deepEqual(session.inboxUpdates, [])
    } finally {
      session.unmount()
    }
  })
}
