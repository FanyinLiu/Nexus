import assert from 'node:assert/strict'
import test from 'node:test'

import React from 'react'

import { routeDelivery } from '../shared/proactiveDelivery.js'
import type { DeliveryContext, ProactiveMessage } from '../shared/proactiveDelivery.js'
import {
  buildReminderProactiveMessage,
  planReminderPresentation,
} from '../src/features/reminders/proactiveMessage.ts'
import { resolveProactivePresentation } from '../src/features/proactive/proactivePresentation.ts'
import {
  PROACTIVE_BUBBLE_AUTO_COLLAPSE_MS,
  useReadableCaption,
} from '../src/features/uiV2/caption.ts'
import type { CompanionSurfacePhase } from '../src/features/uiV2/state.ts'

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

type RenderInput = {
  text: string
  phase: CompanionSurfacePhase
  paused?: boolean
  proactive?: boolean
  proactiveKey?: string
  onCollapse?: () => void
}

function CaptionProbe(input: RenderInput) {
  return useReadableCaption(input.text, input.phase, input.paused ?? false, {
    proactive: input.proactive ?? false,
    proactiveKey: input.proactiveKey,
    onProactiveCollapse: input.onCollapse,
  })
}

// Minimal hook dispatcher: the caption hook only uses state, refs and effects,
// so a full react-dom render is unnecessary here.
function createCaption() {
  const slots: unknown[] = []
  const effects: EffectSlot[] = []
  let cursor = 0
  let props: RenderInput = { text: '', phase: 'idle' }
  let value = ''
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
    if (depth > 6) throw new Error('caption renderer did not settle')
    commit = true
    reactInternals.H = dispatcher
    try {
      value = CaptionProbe(props)
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
    render(next: RenderInput) {
      props = next
      depth = 0
      renderNow()
      return value
    },
    unmount() {
      for (const slot of effects) slot?.cleanup?.()
    },
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

function installWindow(clock: ReturnType<typeof createClock>) {
  const inboxUpdates: string[] = []
  Object.defineProperty(globalThis, 'window', {
    value: {
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      desktopPet: {
        updateProactiveInboxEntry: async (payload: { id: string; status: string }) => {
          inboxUpdates.push(`${payload.id}:${payload.status}`)
          return { updated: true, unreadCount: 0 }
        },
      },
    },
    configurable: true,
    writable: true,
  })
  return { inboxUpdates }
}

test('with the strip disabled the reminder bubble collapses at 12 s and hover pauses it', () => {
  const bubble = resolveProactivePresentation({ outlet: 'bubble', message: makeMessage() })
  assert.equal(bubble?.proactiveTitle, 'Stand up')
  const text = bubble?.proactiveTitle ?? ''

  const clock = createClock()
  const { inboxUpdates } = installWindow(clock)
  const caption = createCaption()
  try {
    assert.equal(PROACTIVE_BUBBLE_AUTO_COLLAPSE_MS, 12_000)
    assert.equal(caption.render({ text, phase: 'idle', proactive: true }), 'Stand up')
    clock.tick(11_900)
    assert.equal(caption.render({ text, phase: 'idle', proactive: true }), 'Stand up')
    clock.tick(100)
    assert.equal(caption.render({ text, phase: 'idle', proactive: true }), '')
    assert.deepEqual(inboxUpdates, [])
  } finally {
    caption.unmount()
  }

  // Second sub-scenario: hovering must hold the bubble past the 12 s mark and
  // only start a fresh 12 s countdown once the pointer leaves.
  const hovered = createCaption()
  try {
    assert.equal(hovered.render({ text, phase: 'idle', paused: true, proactive: true }), 'Stand up')
    clock.tick(20_000)
    assert.equal(hovered.render({ text, phase: 'idle', paused: true, proactive: true }), 'Stand up')
    assert.equal(hovered.render({ text, phase: 'idle', proactive: true }), 'Stand up')
    clock.tick(11_900)
    assert.equal(hovered.render({ text, phase: 'idle', proactive: true }), 'Stand up')
    clock.tick(100)
    assert.equal(hovered.render({ text, phase: 'idle', proactive: true }), '')
    assert.deepEqual(inboxUpdates, [])
  } finally {
    hovered.unmount()
    delete (globalThis as { window?: unknown }).window
  }
})
