import assert from 'node:assert/strict'
import { test } from 'node:test'

import React from 'react'

import {
  PROACTIVE_BUBBLE_AFTER_HOVER_COLLAPSE_MS,
  PROACTIVE_BUBBLE_AUTO_COLLAPSE_MS,
  companionCaptionPhaseAcceptsText,
  useReadableCaption,
} from '../src/features/uiV2/caption.ts'
import type { CompanionSurfacePhase } from '../src/features/uiV2/state.ts'

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

test('a proactive caption collapses at exactly 12 seconds', () => {
  const clock = createClock()
  installWindow(clock)
  const caption = createCaption()
  try {
    assert.equal(PROACTIVE_BUBBLE_AUTO_COLLAPSE_MS, 12_000)
    assert.equal(caption.render({ text: 'Proactive title', phase: 'idle', proactive: true }), 'Proactive title')
    clock.tick(11_900)
    assert.equal(caption.render({ text: 'Proactive title', phase: 'idle', proactive: true }), 'Proactive title')
    clock.tick(100)
    assert.equal(caption.render({ text: 'Proactive title', phase: 'idle', proactive: true }), '')
  } finally {
    caption.unmount()
    delete (globalThis as { window?: unknown }).window
  }
})

test('hovering a proactive caption holds it, and leaving collapses it 5 seconds later', () => {
  const clock = createClock()
  installWindow(clock)
  const caption = createCaption()
  try {
    assert.equal(PROACTIVE_BUBBLE_AFTER_HOVER_COLLAPSE_MS, 5_000)
    assert.equal(caption.render({ text: 'Proactive title', phase: 'idle', proactive: true }), 'Proactive title')
    assert.equal(caption.render({ text: 'Proactive title', phase: 'idle', paused: true, proactive: true }), 'Proactive title')
    clock.tick(20_000)
    assert.equal(caption.render({ text: 'Proactive title', phase: 'idle', paused: true, proactive: true }), 'Proactive title')

    // Leaving arms a fixed 5s window, not the remaining 12s.
    assert.equal(caption.render({ text: 'Proactive title', phase: 'idle', proactive: true }), 'Proactive title')
    clock.tick(4_900)
    assert.equal(caption.render({ text: 'Proactive title', phase: 'idle', proactive: true }), 'Proactive title')
    clock.tick(100)
    assert.equal(caption.render({ text: 'Proactive title', phase: 'idle', proactive: true }), '')
  } finally {
    caption.unmount()
    delete (globalThis as { window?: unknown }).window
  }
})

test('re-hovering during the 5s leave window pauses it again and restarts on the next leave', () => {
  const clock = createClock()
  installWindow(clock)
  const caption = createCaption()
  try {
    assert.equal(caption.render({ text: 'Proactive title', phase: 'idle', proactive: true }), 'Proactive title')
    assert.equal(caption.render({ text: 'Proactive title', phase: 'idle', paused: true, proactive: true }), 'Proactive title')
    clock.tick(2_000)
    assert.equal(caption.render({ text: 'Proactive title', phase: 'idle', proactive: true }), 'Proactive title')
    clock.tick(2_000)

    // Re-enter inside the leave window: the countdown is cancelled again.
    assert.equal(caption.render({ text: 'Proactive title', phase: 'idle', paused: true, proactive: true }), 'Proactive title')
    clock.tick(20_000)
    assert.equal(caption.render({ text: 'Proactive title', phase: 'idle', paused: true, proactive: true }), 'Proactive title')

    // Leaving again restarts a full 5s window.
    assert.equal(caption.render({ text: 'Proactive title', phase: 'idle', proactive: true }), 'Proactive title')
    clock.tick(4_900)
    assert.equal(caption.render({ text: 'Proactive title', phase: 'idle', proactive: true }), 'Proactive title')
    clock.tick(100)
    assert.equal(caption.render({ text: 'Proactive title', phase: 'idle', proactive: true }), '')
  } finally {
    caption.unmount()
    delete (globalThis as { window?: unknown }).window
  }
})

test('collapsing a proactive caption never updates the inbox entry', () => {
  const clock = createClock()
  const { inboxUpdates } = installWindow(clock)
  const caption = createCaption()
  try {
    caption.render({ text: 'Proactive title', phase: 'idle', proactive: true })
    clock.tick(PROACTIVE_BUBBLE_AUTO_COLLAPSE_MS)
    assert.equal(caption.render({ text: 'Proactive title', phase: 'idle', proactive: true }), '')
    assert.deepEqual(inboxUpdates, [])
  } finally {
    caption.unmount()
    delete (globalThis as { window?: unknown }).window
  }
})

test('a collapsed proactive caption fires the collapse callback once and stays empty after the message is dropped', () => {
  const clock = createClock()
  installWindow(clock)
  const caption = createCaption()
  let collapses = 0
  const onCollapse = () => {
    collapses += 1
  }
  try {
    const input: RenderInput = {
      text: 'Proactive title',
      phase: 'idle',
      proactive: true,
      proactiveKey: '2026-01-01T00:00:00.000Z\u0000Proactive title',
      onCollapse,
    }
    assert.equal(caption.render(input), 'Proactive title')
    clock.tick(PROACTIVE_BUBBLE_AUTO_COLLAPSE_MS)
    assert.equal(caption.render(input), '')
    assert.equal(collapses, 1)

    // The surface drops the bubble when the callback fires, so the caption
    // input becomes empty before the phase round-trip happens.
    assert.equal(caption.render({ ...input, text: '' }), '')
    assert.equal(caption.render({ ...input, text: '', phase: 'listening' }), '')
    assert.equal(caption.render({ ...input, text: '' }), '')
    assert.equal(collapses, 1)
  } finally {
    caption.unmount()
    delete (globalThis as { window?: unknown }).window
  }
})

test('a non-proactive caption never fires the proactive collapse callback', () => {
  const clock = createClock()
  installWindow(clock)
  const caption = createCaption()
  let collapses = 0
  try {
    assert.equal(caption.render({
      text: 'Normal reply',
      phase: 'done',
      onCollapse: () => {
        collapses += 1
      },
    }), 'Normal reply')
    clock.tick(60_000)
    assert.equal(collapses, 0)
  } finally {
    caption.unmount()
    delete (globalThis as { window?: unknown }).window
  }
})

test('a proactive caption does not replace a listening or thinking surface', () => {
  const clock = createClock()
  installWindow(clock)
  const caption = createCaption()
  try {
    assert.equal(caption.render({ text: 'Normal reply', phase: 'done' }), 'Normal reply')
    assert.equal(caption.render({ text: 'Proactive title', phase: 'listening', proactive: true }), '')
    assert.equal(caption.render({ text: 'Proactive title', phase: 'thinking', proactive: true }), '')
  } finally {
    caption.unmount()
    delete (globalThis as { window?: unknown }).window
  }
})

test('a proactive caption never covers a speaking, error, or offline caption', () => {
  const clock = createClock()
  installWindow(clock)
  const caption = createCaption()
  try {
    assert.equal(caption.render({ text: 'Proactive title', phase: 'speaking', proactive: true }), '')
    assert.equal(caption.render({ text: 'Proactive title', phase: 'error', proactive: true }), '')
    assert.equal(caption.render({ text: 'Proactive title', phase: 'offline', proactive: true }), '')
  } finally {
    caption.unmount()
    delete (globalThis as { window?: unknown }).window
  }
})

test('only proactive captions are accepted on idle and done', () => {
  assert.equal(companionCaptionPhaseAcceptsText('idle'), false)
  assert.equal(companionCaptionPhaseAcceptsText('idle', true), true)
  assert.equal(companionCaptionPhaseAcceptsText('done', true), true)
  assert.equal(companionCaptionPhaseAcceptsText('listening', true), false)
  assert.equal(companionCaptionPhaseAcceptsText('thinking', true), false)
  assert.equal(companionCaptionPhaseAcceptsText('speaking', true), false)
  assert.equal(companionCaptionPhaseAcceptsText('error', true), false)
  assert.equal(companionCaptionPhaseAcceptsText('offline', true), false)
})
