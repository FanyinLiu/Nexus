import assert from 'node:assert/strict'
import { test } from 'node:test'

import React from 'react'

import { COMPANION_NOTICE_AUTO_HIDE_MS, useReadableCaption } from '../src/features/uiV2/caption.ts'
import type { CompanionSurfacePhase } from '../src/features/uiV2/state.ts'

type ReactInternals = { H: unknown }
const reactInternals = (React as unknown as {
  __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: ReactInternals
}).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE

type EffectSlot = { deps?: readonly unknown[]; callback?: () => void | (() => void); cleanup?: () => void; run?: boolean }

function CaptionProbe(props: { text: string; phase: CompanionSurfacePhase }) {
  return useReadableCaption(props.text, props.phase)
}

function createCaption() {
  const slots: unknown[] = []
  const effects: EffectSlot[] = []
  let cursor = 0
  let props = { text: '', phase: 'idle' as CompanionSurfacePhase }
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
    render(text: string, phase: CompanionSurfacePhase) {
      props = { text, phase }
      depth = 0
      renderNow()
      return value
    },
  }
}

test('a companion notice stays up for 14s and clears when the bubble does', () => {
  assert.equal(COMPANION_NOTICE_AUTO_HIDE_MS, 14_000)
  const timeouts: number[] = []
  Object.assign(globalThis, {
    window: {
      setTimeout: (callback: () => void, delay?: number) => {
        timeouts.push(delay ?? 0)
        return 1
      },
      clearTimeout: () => {},
    },
  })
  const caption = createCaption()
  assert.equal(caption.render('语音还没装好，去设置里下载。', 'done'), '语音还没装好，去设置里下载。')
  assert.equal(caption.render('语音还没装好，去设置里下载。', 'idle'), '语音还没装好，去设置里下载。')
  const scheduled = timeouts.length
  assert.equal(caption.render('', 'idle'), '')
  assert.equal(timeouts.length, scheduled)

  const held = createCaption()
  assert.equal(held.render('语音还没装好，去设置里下载。', 'error'), '语音还没装好，去设置里下载。')
  assert.equal(held.render('', 'error'), '语音还没装好，去设置里下载。')
})
