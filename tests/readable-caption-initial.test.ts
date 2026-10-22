import assert from 'node:assert/strict'
import { test } from 'node:test'

import React from 'react'

import { useReadableCaption } from '../src/features/uiV2/caption.ts'
import type { CompanionSurfacePhase } from '../src/features/uiV2/state.ts'

type ReactInternals = { H: unknown }
const reactInternals = (React as unknown as {
  __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: ReactInternals
}).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE

function CaptionProbe(props: { text: string; phase: CompanionSurfacePhase }) {
  return useReadableCaption(props.text, props.phase)
}

function firstCaption(text: string, phase: CompanionSurfacePhase): string {
  const slots: unknown[] = []
  let cursor = 0
  reactInternals.H = {
    useState(initial: unknown) {
      const index = cursor++
      if (!(index in slots)) {
        slots[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial
      }
      return [slots[index], () => {}]
    },
    useRef(initial: unknown) {
      const index = cursor++
      if (!(index in slots)) slots[index] = { current: initial }
      return slots[index]
    },
    useEffect() {
      cursor += 1
    },
  }
  try {
    return CaptionProbe({ text, phase })
  } finally {
    reactInternals.H = null
  }
}

test('the caption is present on the first render, before effects', () => {
  assert.equal(firstCaption('语音还没装好', 'error'), '语音还没装好')
  assert.equal(firstCaption('hello', 'speaking'), 'hello')
  assert.equal(firstCaption('hello', 'done'), 'hello')
  assert.equal(firstCaption('hello', 'offline'), 'hello')
  assert.equal(firstCaption('hello', 'idle'), '')
  assert.equal(firstCaption('hello', 'listening'), '')
  assert.equal(firstCaption('hello', 'thinking'), '')
  assert.equal(firstCaption('', 'error'), '')
})
