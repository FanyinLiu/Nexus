import assert from 'node:assert/strict'
import { register } from 'node:module'
import { test } from 'node:test'

import React from 'react'

import { ensureLocaleLoaded } from '../src/i18n/runtime.ts'

register(new URL('./helpers/bundler-import-hooks.mjs', import.meta.url))

const { VoiceStep } = await import('../src/features/onboarding/components/guideSteps/VoiceStep.tsx')

type ReactInternals = { H: unknown }
const reactInternals = (React as unknown as {
  __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: ReactInternals
}).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE

type EffectSlot = { deps?: readonly unknown[]; callback?: () => void | (() => void); cleanup?: () => void; run?: boolean }

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

type ElementLike = { props: { children?: unknown } }

function collectText(node: unknown, found: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, found)
    return found
  }
  if (typeof node === 'string' || typeof node === 'number') {
    found.push(String(node))
    return found
  }
  if (!node || typeof node !== 'object' || !('props' in node)) return found
  collectText((node as ElementLike).props.children, found)
  return found
}

const draft = {
  uiLanguage: 'zh-CN' as const,
  speechInputProviderId: 'local-sensevoice',
  speechOutputEnabled: false,
}

test('onboarding step 5 waits to say voice is ready until the models are installed', async () => {
  await ensureLocaleLoaded('zh-CN')
  const missing = {
    models: [
      { id: 'vad', label: 'vad', sizeLabel: '1 MB', required: true, present: false },
      { id: 'sensevoice', label: 'SenseVoice', sizeLabel: '1 MB', required: false, present: false },
    ],
    ready: false,
  }
  const installed = {
    models: missing.models.map((model) => ({ ...model, present: true })),
    ready: true,
  }
  const view = createRenderer(VoiceStep as (props: { draft: typeof draft }) => unknown)

  Object.assign(globalThis, {
    window: { desktopPet: { modelsGetInventory: async () => missing } },
  })
  view.render({ draft })
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
  const needs = collectText(view.render({ draft })).join('')
  assert.ok(needs.includes('语音还要下载模型，下完就能用'))
  assert.equal(needs.includes('语音可以用了'), false)

  Object.assign(globalThis, {
    window: { desktopPet: { modelsGetInventory: async () => installed } },
  })
  const readyView = createRenderer(VoiceStep as (props: { draft: typeof draft }) => unknown)
  readyView.render({ draft })
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
  const ready = collectText(readyView.render({ draft })).join('')
  assert.ok(ready.includes('语音可以用了'))
  assert.equal(ready.includes('语音还要下载模型，下完就能用'), false)
})
