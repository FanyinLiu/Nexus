import assert from 'node:assert/strict'
import { register } from 'node:module'
import { test } from 'node:test'

import React from 'react'

import type {
  AppSettings,
  PetDialogBubbleState,
  RuntimeStateSnapshot,
  VoiceState,
} from '../src/types/index.ts'
import type { PetModelDefinition } from '../src/features/pet/models.ts'
import { PROACTIVE_BUBBLE_AUTO_COLLAPSE_MS } from '../src/features/uiV2/caption.ts'
import { t } from '../src/i18n/runtime.ts'

register(new URL('./helpers/bundler-import-hooks.mjs', import.meta.url))

const {
  FramelessCompanionSurface,
} = await import('../src/features/uiV2/FramelessCompanionSurface.tsx')

const GENERIC = '刚才出了点问题，可以检查设置后再试。'
const SPECIFIC = '语音还没装好，去「设置 → 语音 → 高级」里下载。'

type ReactInternals = { H: unknown }
const reactInternals = (React as unknown as {
  __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: ReactInternals
}).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE

type EffectSlot = {
  deps?: readonly unknown[]
  cleanup?: () => void
  callback?: () => void | (() => void)
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
      const setState = (value: unknown) => {
        const next = typeof value === 'function'
          ? (value as (prev: unknown) => unknown)(slots[index])
          : value
        if (Object.is(next, slots[index])) return
        slots[index] = next
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
      if (changed) {
        effects[index] = { deps, cleanup: prev?.cleanup, callback, run: true }
      }
    },
    useLayoutEffect(callback: () => void | (() => void), deps?: readonly unknown[]) {
      this.useEffect(callback, deps)
    },
  }

  function renderNow() {
    cursor = 0
    rerender = false
    depth += 1
    if (depth > 8) throw new Error('renderer did not settle')
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

function captionText(tree: unknown): string {
  const captions = findElements(tree, (element) => (
    element.props.className === 'nexus-companion-v2__caption nexus-v2-interactive'
  ))
  const found: string[] = []
  for (const caption of captions) {
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

function presenceError(): RuntimeStateSnapshot['companionPresence'] {
  return { phase: 'error', mood: 'idle', updatedAt: '2026-01-01T00:00:00.000Z' }
}

function presenceOffline(): RuntimeStateSnapshot['companionPresence'] {
  return { phase: 'offline', mood: 'idle', updatedAt: '2026-01-01T00:00:00.000Z' }
}

function surfaceProps(input: {
  error?: string | null
  bubble?: PetDialogBubbleState | null
  presence?: RuntimeStateSnapshot['companionPresence']
  voiceState?: VoiceState
  chatBusy?: boolean
  onHideBubble?: () => void
} = {}) {
  return {
    settings: {
      uiLanguage: 'zh-CN',
      companionName: '星绘',
      companionBackdropEnabled: false,
      gazeFollowEnabled: false,
      continuousVoiceModeEnabled: false,
    } as AppSettings,
    petModel: {
      id: 'test',
      label: 'test',
      description: 'test',
      modelPath: '',
      fallbackImagePath: '',
      motionGroups: { gestures: {} },
      expressionMap: {},
    } as PetModelDefinition,
    pet: {
      mood: 'idle' as const,
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
      voiceState: input.voiceState ?? ('idle' as const),
      speechLevelSource: { current: 0, getSnapshot: () => 0, subscribe: () => () => {} },
      continuousVoiceActive: false,
      toggleVoiceConversation: () => {},
      stopVoiceConversation: () => {},
    },
    chat: {
      assistantActivity: 'idle' as const,
      busy: input.chatBusy ?? false,
      error: input.error ?? null,
      petDialogBubble: input.bubble ?? null,
      cancelActiveTurn: () => {},
      hidePetDialogBubble: input.onHideBubble ?? (() => {}),
    },
    isPinned: false,
    clickThrough: false,
    runtimeSnapshot: {
      mood: 'idle' as const,
      companionPresence: input.presence,
    } as RuntimeStateSnapshot,
    openSettingsPanel: () => {},
    openChatPanelForVoice: () => {},
    togglePinned: () => {},
    toggleClickThrough: () => {},
  }
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

type WindowTimerHost = {
  setTimeout: (callback: () => void, delay?: number) => number
  clearTimeout: (id: number) => void
}

function installFakeClock() {
  const clock = createClock()
  const target = globalThis.window as unknown as WindowTimerHost
  const previous = {
    setTimeout: target.setTimeout,
    clearTimeout: target.clearTimeout,
  }
  target.setTimeout = clock.setTimeout
  target.clearTimeout = clock.clearTimeout
  return {
    clock,
    restore() {
      target.setTimeout = previous.setTimeout
      target.clearTimeout = previous.clearTimeout
    },
  }
}

Object.assign(globalThis, {
  window: {
    setTimeout,
    clearTimeout,
    requestAnimationFrame: (callback: () => void) => {
      callback()
      return 1
    },
  },
  document: {
    addEventListener: () => {},
    removeEventListener: () => {},
    getSelection: () => null,
  },
})

test('clearing the missing-model line does not adopt the generic recovery caption', () => {
  const view = createRenderer(FramelessCompanionSurface)
  const first = captionText(view.render(surfaceProps({ error: SPECIFIC })))
  assert.ok(first.includes(SPECIFIC), first)
  assert.equal(first.includes(GENERIC), false)

  const cleared = captionText(view.render(surfaceProps({ error: null })))
  assert.equal(cleared.includes(GENERIC), false, cleared)
})

test('a sticky presence error does not replace the missing-model line with the generic one', () => {
  const view = createRenderer(FramelessCompanionSurface)
  const first = captionText(view.render(surfaceProps({
    error: SPECIFIC,
    presence: presenceError(),
  })))
  assert.ok(first.includes(SPECIFIC), first)

  const cleared = captionText(view.render(surfaceProps({
    error: null,
    presence: presenceError(),
  })))
  assert.equal(cleared.includes(GENERIC), false, cleared)
  assert.ok(cleared.includes(SPECIFIC), cleared)
})

test('the pet bubble shows the reminder instead of the generic recovery line', () => {
  const view = createRenderer(FramelessCompanionSurface)
  const text = captionText(view.render(surfaceProps({
    error: 'voice-model-missing',
    bubble: { content: SPECIFIC, replacesSurfaceError: true },
    presence: presenceError(),
  })))
  assert.ok(text.includes(SPECIFIC), text)
  assert.equal(text.includes(GENERIC), false, text)
  assert.equal(text.includes('voice-model-missing'), false, text)
})

test('a presence error with no specific line still uses the generic recovery caption', () => {
  const view = createRenderer(FramelessCompanionSurface)
  const text = captionText(view.render(surfaceProps({ presence: presenceError() })))
  assert.ok(text.includes(GENERIC), text)
})

test('an idle pet shows a proactive bubble title instead of its body', () => {
  const view = createRenderer(FramelessCompanionSurface)
  try {
    const text = captionText(view.render(surfaceProps({
      bubble: {
        content: 'Proactive body that must stay hidden',
        proactiveTitle: 'Proactive title',
      },
    })))
    assert.ok(text.includes('Proactive title'), text)
    assert.equal(text.includes('Proactive body that must stay hidden'), false, text)
  } finally {
    view.unmount()
  }
})

test('a proactive bubble does not replace a listening or thinking caption', () => {
  const listening = createRenderer(FramelessCompanionSurface)
  const thinking = createRenderer(FramelessCompanionSurface)
  try {
    const bubble = {
      content: 'Proactive body',
      proactiveTitle: 'Proactive title',
    }
    assert.equal(captionText(listening.render(surfaceProps({
      bubble,
      voiceState: 'listening',
    }))), '')
    assert.equal(captionText(thinking.render(surfaceProps({
      bubble,
      chatBusy: true,
    }))), '')
  } finally {
    listening.unmount()
    thinking.unmount()
  }
})

test('a proactive bubble does not replace the speaking caption', () => {
  const view = createRenderer(FramelessCompanionSurface)
  try {
    const text = captionText(view.render(surfaceProps({
      bubble: {
        content: 'Speaking text',
        proactiveTitle: 'Proactive title',
      },
      voiceState: 'speaking',
    })))
    assert.equal(text, 'Speaking text')
    assert.equal(text.includes('Proactive title'), false, text)
  } finally {
    view.unmount()
  }
})

test('a proactive bubble does not replace the error caption', () => {
  const view = createRenderer(FramelessCompanionSurface)
  try {
    const text = captionText(view.render(surfaceProps({
      bubble: {
        content: 'Proactive body',
        proactiveTitle: 'Proactive title',
      },
      error: SPECIFIC,
    })))
    assert.ok(text.includes(SPECIFIC), text)
    assert.equal(text.includes('Proactive title'), false, text)
  } finally {
    view.unmount()
  }
})

test('a proactive bubble does not replace the offline caption', () => {
  const view = createRenderer(FramelessCompanionSurface)
  try {
    const offline = t('ui_v2.offline_recovery')
    const text = captionText(view.render(surfaceProps({
      bubble: {
        content: 'Proactive body',
        proactiveTitle: 'Proactive title',
      },
      presence: presenceOffline(),
    })))
    assert.ok(text.includes(offline), text)
    assert.equal(text.includes('Proactive title'), false, text)
  } finally {
    view.unmount()
  }
})

test('a collapsed proactive caption is dropped and never comes back on a phase round-trip', () => {
  const { clock, restore } = installFakeClock()
  const view = createRenderer(FramelessCompanionSurface)
  let hides = 0
  try {
    const bubble: PetDialogBubbleState = {
      content: 'Proactive body',
      proactiveTitle: 'Proactive title',
      createdAt: '2026-01-01T00:00:00.000Z',
    }
    const onHideBubble = () => {
      hides += 1
    }

    assert.equal(captionText(view.render(surfaceProps({ bubble, onHideBubble }))), 'Proactive title')
    clock.tick(PROACTIVE_BUBBLE_AUTO_COLLAPSE_MS - 1)
    assert.equal(captionText(view.render(surfaceProps({ bubble, onHideBubble }))), 'Proactive title')
    clock.tick(1)
    assert.equal(captionText(view.render(surfaceProps({ bubble: null, onHideBubble }))), '')
    assert.equal(hides, 1)

    assert.equal(captionText(view.render(surfaceProps({
      bubble: null,
      voiceState: 'listening',
      onHideBubble,
    }))), '')
    assert.equal(captionText(view.render(surfaceProps({ bubble: null, onHideBubble }))), '')
    assert.equal(captionText(view.render(surfaceProps({
      bubble: null,
      chatBusy: true,
      onHideBubble,
    }))), '')
    const errorText = captionText(view.render(surfaceProps({
      bubble: null,
      presence: presenceError(),
      onHideBubble,
    })))
    assert.equal(errorText.includes('Proactive title'), false, errorText)
    assert.equal(captionText(view.render(surfaceProps({ bubble: null, onHideBubble }))), '')
    assert.equal(hides, 1)
  } finally {
    view.unmount()
    restore()
  }
})

test('a newer reply that replaced a proactive bubble is not hidden by its old countdown', () => {
  const { clock, restore } = installFakeClock()
  const view = createRenderer(FramelessCompanionSurface)
  let hides = 0
  try {
    const onHideBubble = () => {
      hides += 1
    }
    const proactive: PetDialogBubbleState = {
      content: 'Proactive body',
      proactiveTitle: 'Proactive title',
      createdAt: '2026-01-01T00:00:00.000Z',
    }
    const reply: PetDialogBubbleState = {
      content: 'Fresh reply',
      createdAt: '2026-01-01T00:00:06.000Z',
    }

    assert.equal(captionText(view.render(surfaceProps({ bubble: proactive, onHideBubble }))), 'Proactive title')
    clock.tick(6_000)
    assert.equal(captionText(view.render(surfaceProps({
      bubble: reply,
      voiceState: 'speaking',
      onHideBubble,
    }))), 'Fresh reply')

    clock.tick(PROACTIVE_BUBBLE_AUTO_COLLAPSE_MS * 2)
    assert.equal(hides, 0)
  } finally {
    view.unmount()
    restore()
  }
})

test('a newer proactive bubble with the same title gets its own collapse window', () => {
  const { clock, restore } = installFakeClock()
  const view = createRenderer(FramelessCompanionSurface)
  let hides = 0
  try {
    const onHideBubble = () => {
      hides += 1
    }
    const first: PetDialogBubbleState = {
      content: 'Proactive body',
      proactiveTitle: 'Proactive title',
      createdAt: '2026-01-01T00:00:00.000Z',
    }
    const second: PetDialogBubbleState = {
      content: 'Proactive body',
      proactiveTitle: 'Proactive title',
      createdAt: '2026-01-01T00:00:06.000Z',
    }

    assert.equal(captionText(view.render(surfaceProps({ bubble: first, onHideBubble }))), 'Proactive title')
    clock.tick(6_000)
    assert.equal(captionText(view.render(surfaceProps({ bubble: second, onHideBubble }))), 'Proactive title')
    clock.tick(6_000)
    assert.equal(hides, 0)
    clock.tick(6_000)
    assert.equal(hides, 1)
  } finally {
    view.unmount()
    restore()
  }
})
