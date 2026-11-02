/**
 * The legacy pet window shares the proactive collapse policy with the v2
 * caption: 12s untouched, never while hovered, and a fixed 5s after the
 * pointer leaves. The dialog layer is the component LegacyPetView mounts, so
 * these tests drive the real layer rather than a copy of its timer.
 */

import assert from 'node:assert/strict'
import { register } from 'node:module'
import { test } from 'node:test'

import React from 'react'

import type { PetDialogBubbleState } from '../src/types/index.ts'

register(new URL('./helpers/bundler-import-hooks.mjs', import.meta.url))

const { LegacyPetDialogLayer } = await import('../src/app/views/LegacyPetDialogLayer.tsx')
const { LegacyPetView } = await import('../src/app/views/LegacyPetView.tsx')
const { PROACTIVE_BUBBLE_AFTER_HOVER_COLLAPSE_MS, PROACTIVE_BUBBLE_AUTO_COLLAPSE_MS } = await import(
  '../src/features/uiV2/caption.ts'
)

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
    if (depth > 6) throw new Error('renderer did not settle')
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

function installWindow(clock: ReturnType<typeof createClock>) {
  Object.defineProperty(globalThis, 'window', {
    value: {
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      setInterval: clock.setTimeout,
      clearInterval: clock.clearTimeout,
    },
    configurable: true,
    writable: true,
  })
}

function makeBubble(overrides: Partial<PetDialogBubbleState> = {}): PetDialogBubbleState {
  return {
    content: 'Proactive body',
    proactiveTitle: 'Proactive title',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeProps(bubble: PetDialogBubbleState, onCollapse: () => void) {
  return { bubble, assistantName: '星绘', onCollapse }
}

function petViewProps(bubble: PetDialogBubbleState, onHideBubble: () => void) {
  return {
    settings: {
      uiLanguage: 'zh-CN',
      companionName: '星绘',
      vtsEnabled: false,
      vtsPort: 8001,
      toolWeatherDefaultLocation: '',
      toolWeatherEnabled: false,
      ambientWeatherEnabled: false,
      petWeatherPreview: 'auto',
      petTimePreview: 'auto',
      continuousVoiceModeEnabled: false,
      gazeFollowEnabled: false,
    },
    petModel: {
      id: 'test',
      label: 'test',
      description: 'test',
      modelPath: '',
      fallbackImagePath: '',
      motionGroups: { gestures: {} },
      expressionMap: {},
    },
    pet: {
      mood: 'idle',
      petTapActive: false,
      petTouchZone: null,
      gazeTarget: { x: 0, y: 0 },
      setGazeTarget: () => {},
      setPetHotspotActive: () => {},
      setMascotHovered: () => {},
      markPresenceActivity: () => {},
      updatePetStatus: () => {},
      setPetTapActive: () => {},
      setPetTouchZone: () => {},
    },
    voice: {
      voiceState: 'idle',
      speechLevelSource: { current: 0, getSnapshot: () => 0, subscribe: () => () => {} },
      continuousVoiceActive: false,
      toggleVoiceConversation: () => {},
    },
    chat: {
      assistantActivity: 'idle',
      busy: false,
      petDialogBubble: bubble,
      petThoughtBubble: null,
      hidePetDialogBubble: onHideBubble,
    },
    isPinned: false,
    clickThrough: false,
    mediaSession: null,
    musicActionBusy: false,
    dismissedMusicSessionKey: '',
    runtimeSnapshot: {},
    remotePanelSettingsOpen: false,
    openSettingsPanel: () => {},
    openChatPanelForVoice: () => {},
    openPetMenu: () => {},
    togglePinned: () => {},
    toggleClickThrough: () => {},
    toggleContinuousVoiceMode: () => {},
    notificationUnreadCount: 0,
    handleMediaSessionControl: () => {},
    dismissCurrentMediaSession: () => {},
    modalOpen: false,
  } as unknown as Parameters<typeof LegacyPetView>[0]
}

test('a legacy proactive bubble shows the title and collapses at exactly 12 seconds', () => {
  const clock = createClock()
  installWindow(clock)
  const renderer = createRenderer(LegacyPetDialogLayer)
  let collapses = 0
  const props = makeProps(makeBubble(), () => {
    collapses += 1
  })
  try {
    assert.equal(PROACTIVE_BUBBLE_AUTO_COLLAPSE_MS, 12_000)
    assert.equal(shownContent(renderer.render(props)), 'Proactive title')
    clock.tick(11_900)
    assert.equal(shownContent(renderer.render(props)), 'Proactive title')
    assert.equal(collapses, 0)
    clock.tick(100)
    assert.equal(collapses, 1)
  } finally {
    renderer.unmount()
    delete (globalThis as { window?: unknown }).window
  }
})

test('hovering a legacy proactive bubble holds it and leaving collapses it 5 seconds later', () => {
  const clock = createClock()
  installWindow(clock)
  const renderer = createRenderer(LegacyPetDialogLayer)
  let collapses = 0
  const props = makeProps(makeBubble(), () => {
    collapses += 1
  })
  try {
    assert.equal(PROACTIVE_BUBBLE_AFTER_HOVER_COLLAPSE_MS, 5_000)
    renderer.render(props)

    triggerPointer(renderer.render(props), 'onPointerEnter')
    renderer.render(props)
    clock.tick(20_000)
    assert.equal(shownContent(renderer.render(props)), 'Proactive title')
    assert.equal(collapses, 0)

    triggerPointer(renderer.render(props), 'onPointerLeave')
    renderer.render(props)
    clock.tick(PROACTIVE_BUBBLE_AFTER_HOVER_COLLAPSE_MS - 100)
    assert.equal(collapses, 0)
    clock.tick(100)
    assert.equal(collapses, 1)
  } finally {
    renderer.unmount()
    delete (globalThis as { window?: unknown }).window
  }
})

test('a newer legacy proactive bubble is not hidden by the older countdown', () => {
  const clock = createClock()
  installWindow(clock)
  const renderer = createRenderer(LegacyPetDialogLayer)
  let collapses = 0
  const onCollapse = () => {
    collapses += 1
  }
  try {
    const first = makeBubble({
      content: 'First body',
      proactiveTitle: 'First title',
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    const second = makeBubble({
      content: 'Second body',
      proactiveTitle: 'Second title',
      createdAt: '2026-01-01T00:00:06.000Z',
    })

    assert.equal(shownContent(renderer.render(makeProps(first, onCollapse))), 'First title')
    clock.tick(6_000)
    assert.equal(shownContent(renderer.render(makeProps(second, onCollapse))), 'Second title')
    clock.tick(6_000)
    // The original 12s window would end here; the replacement owns its own.
    assert.equal(collapses, 0)
    clock.tick(6_000)
    assert.equal(collapses, 1)
  } finally {
    renderer.unmount()
    delete (globalThis as { window?: unknown }).window
  }
})

test('a non-proactive legacy reply never arms the proactive collapse', () => {
  const clock = createClock()
  installWindow(clock)
  const renderer = createRenderer(LegacyPetDialogLayer)
  let collapses = 0
  const reply: PetDialogBubbleState = {
    content: 'Fresh reply',
    createdAt: '2026-01-01T00:00:00.000Z',
  }
  try {
    assert.equal(shownContent(renderer.render(makeProps(reply, () => {
      collapses += 1
    }))), 'Fresh reply')
    clock.tick(60_000)
    assert.equal(collapses, 0)
  } finally {
    renderer.unmount()
    delete (globalThis as { window?: unknown }).window
  }
})

test('the legacy pet view mounts the shared dialog layer for the proactive bubble', () => {
  const clock = createClock()
  installWindow(clock)
  const renderer = createRenderer(LegacyPetView)
  let hides = 0
  const onHideBubble = () => {
    hides += 1
  }
  try {
    const tree = renderer.render(petViewProps(makeBubble(), onHideBubble))
    const layer = findElement(tree, (element) => element.type === LegacyPetDialogLayer)
    assert.equal((layer.props.bubble as PetDialogBubbleState).proactiveTitle, 'Proactive title')
    assert.equal(layer.props.onCollapse, onHideBubble)
    assert.equal(hides, 0)
  } finally {
    renderer.unmount()
    delete (globalThis as { window?: unknown }).window
  }
})
