import assert from 'node:assert/strict'
import { register } from 'node:module'
import { test } from 'node:test'

import React from 'react'

import type { AppSettings, PetDialogBubbleState, RuntimeStateSnapshot } from '../src/types/index.ts'
import type { PetModelDefinition } from '../src/features/pet/models.ts'

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

function surfaceProps(input: {
  error?: string | null
  bubble?: PetDialogBubbleState | null
  presence?: RuntimeStateSnapshot['companionPresence']
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
      voiceState: 'idle' as const,
      speechLevelSource: { current: 0, getSnapshot: () => 0, subscribe: () => () => {} },
      continuousVoiceActive: false,
      toggleVoiceConversation: () => {},
      stopVoiceConversation: () => {},
    },
    chat: {
      assistantActivity: 'idle' as const,
      busy: false,
      error: input.error ?? null,
      petDialogBubble: input.bubble ?? null,
      cancelActiveTurn: () => {},
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
