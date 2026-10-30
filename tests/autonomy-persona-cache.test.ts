import assert from 'node:assert/strict'
import { test } from 'node:test'
import React from 'react'

import { useAutonomyV2Engine } from '../src/app/controllers/useAutonomyV2Engine.ts'
import { PERSONA_SOUL_SAVED_CHANNEL } from '../src/features/persona/personaEvents.ts'

type ReactInternals = { H: unknown }
const reactInternals = (React as unknown as {
  __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: ReactInternals
}).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE

type EffectSlot = { deps?: readonly unknown[]; cleanup?: () => void }

function createHookRenderer<P, R>(hookFn: (props: P) => R) {
  const slots: unknown[] = []
  const effects: EffectSlot[] = []
  let cursor = 0
  let pending: Array<{ index: number; callback: () => void | (() => void) }> = []

  const dispatcher = {
    useState(initial: unknown) {
      const index = cursor++
      if (!(index in slots)) {
        slots[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial
      }
      const setState = (value: unknown) => {
        slots[index] = typeof value === 'function'
          ? (value as (prev: unknown) => unknown)(slots[index])
          : value
      }
      return [slots[index], setState]
    },
    useRef(initial: unknown) {
      const index = cursor++
      if (!(index in slots)) slots[index] = { current: initial }
      return slots[index]
    },
    useContext() {
      cursor++
      return null
    },
    useCallback(fn: unknown) {
      cursor++
      return fn
    },
    useMemo(fn: () => unknown) {
      cursor++
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
        effects[index] = { deps }
        pending.push({ index, callback })
      }
    },
  }

  function render(props: P): R {
    cursor = 0
    pending = []
    reactInternals.H = dispatcher
    let result: R
    try {
      result = hookFn(props)
    } finally {
      reactInternals.H = null
    }
    for (const { index, callback } of pending) {
      const slot = effects[index]
      slot.cleanup?.()
      const cleanup = callback()
      slot.cleanup = typeof cleanup === 'function' ? cleanup : undefined
    }
    return result
  }

  function unmount() {
    for (const effect of effects) effect?.cleanup?.()
  }

  return { render, unmount }
}

async function waitFor(predicate: () => boolean): Promise<boolean> {
  const deadline = Date.now() + 1000
  while (!predicate()) {
    if (Date.now() > deadline) return false
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  return true
}

test('a soul save makes autonomy load the persona again for the same profile', async () => {
  const loadedIds: string[] = []
  Object.defineProperty(globalThis, 'window', {
    value: {
      desktopPet: {
        personaLoadProfile: async (id: string) => {
          loadedIds.push(id)
          return {
            id,
            present: true,
            soul: 'cached-soul',
            memory: '',
            examplesRaw: '',
            examples: [],
            style: {},
            voice: {},
            tools: {},
            rootDir: `personas/${id}`,
          }
        },
      },
    },
    configurable: true,
    writable: true,
  })

  const renderer = createHookRenderer(useAutonomyV2Engine)
  const opts = {
    settingsRef: { current: { activeCharacterProfileId: 'card-keep' } },
    messagesRef: { current: [] },
    memoriesRef: { current: [] },
    reminderTasksRef: { current: [] },
    goalsRef: { current: [] },
    emotionStateRef: { current: {} },
    relationshipRef: { current: {} },
    rhythmRef: { current: {} },
    activeWindowTitleRef: { current: null },
    pushCompanionNotice: async () => {},
    enabled: true,
  }
  const channel = new BroadcastChannel(PERSONA_SOUL_SAVED_CHANNEL)
  try {
    renderer.render(opts)
    assert.equal(await waitFor(() => loadedIds.length >= 1), true)
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(loadedIds, ['card-keep'])

    renderer.render(opts)
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(loadedIds, ['card-keep'])

    channel.postMessage({ saved: true })
    assert.equal(await waitFor(() => loadedIds.length >= 2), true)
    assert.deepEqual(loadedIds, ['card-keep', 'card-keep'])
  } finally {
    channel.close()
    renderer.unmount()
  }
})
