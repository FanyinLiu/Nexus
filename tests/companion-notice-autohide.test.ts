import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import React from 'react'

import { showCompanionNoticeBubble } from '../src/features/uiV2/caption.ts'
import { usePetDialogBubbles } from '../src/hooks/chat/usePetDialogBubbles.ts'

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

function depsChanged(previous: readonly unknown[] | undefined, next: readonly unknown[] | undefined) {
  if (!previous || !next) return true
  return previous.length !== next.length || next.some((dep, index) => !Object.is(dep, previous[index]))
}

function NoticeProbe() {
  return usePetDialogBubbles()
}

function createBubbles() {
  const slots: unknown[] = []
  const effects: EffectSlot[] = []
  let cursor = 0
  let commit = false
  let rerender = false
  let depth = 0
  let api: ReturnType<typeof usePetDialogBubbles> | null = null
  const scheduled: Array<{ id: number; delay: number; callback: () => void }> = []
  let nextTimerId = 1

  Object.assign(globalThis, {
    window: {
      setTimeout: (callback: () => void, delay?: number) => {
        const id = nextTimerId
        nextTimerId += 1
        scheduled.push({ id, delay: delay ?? 0, callback })
        return id
      },
      clearTimeout: (id: number) => {
        const index = scheduled.findIndex((timer) => timer.id === id)
        if (index >= 0) scheduled.splice(index, 1)
      },
    },
  })

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
    useEffect(callback: () => void | (() => void), deps?: readonly unknown[]) {
      const index = cursor++
      const previous = effects[index]
      const changed = !previous || depsChanged(previous.deps, deps)
      if (changed) effects[index] = { deps, callback, cleanup: previous?.cleanup, run: true }
    },
  }

  function renderNow() {
    cursor = 0
    rerender = false
    depth += 1
    if (depth > 8) throw new Error('bubble renderer did not settle')
    commit = true
    reactInternals.H = dispatcher
    try {
      api = NoticeProbe()
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

  renderNow()
  return {
    get bubble() { return api?.petDialogBubble ?? null },
    get present() { return api!.presentPetDialogBubble },
    timers: scheduled,
  }
}

test('the missing-model notice hides after 14s and stays when that wiring is removed', async () => {
  const wired = createBubbles()
  showCompanionNoticeBubble(wired.present, '语音还没装好，去设置里下载。', { replacesSurfaceError: true })
  assert.equal(wired.bubble?.content, '语音还没装好，去设置里下载。')
  assert.equal(wired.bubble?.replacesSurfaceError, true)
  const hide = wired.timers.find((timer) => timer.delay === 14_000)
  assert.ok(hide)
  hide?.callback()
  assert.equal(wired.bubble, null)

  const bare = createBubbles()
  bare.present({ content: '语音还没装好，去设置里下载。', streaming: false })
  assert.equal(bare.bubble?.content, '语音还没装好，去设置里下载。')
  for (const timer of [...bare.timers]) {
    if (timer.delay <= 60_000) timer.callback()
  }
  assert.equal(bare.bubble?.content, '语音还没装好，去设置里下载。')

  const controller = await readFile(new URL('../src/app/controllers/useAppController.ts', import.meta.url), 'utf8')
  const notice = controller.match(/presentCompanionNotice: \(content, options\) => \{[\s\S]*?\n {4}\},/)?.[0] ?? ''
  assert.match(notice, /showCompanionNoticeBubble\(presentPetDialogBubbleRef\.current, content, options\)/)
  assert.doesNotMatch(notice, /autoHideMs:\s*0/)
})
