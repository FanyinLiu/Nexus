/**
 * Behaviour tests for the chat sheet's scroll call sites.
 *
 * The hook is rendered with a fake history element that records scrollTo calls,
 * so the assertions are about where the sheet actually lands (letter opener vs
 * bottom), not about how the source is written. There is no DOM renderer in
 * this environment, so React's shared dispatcher is backed by a slot table (the
 * same approach as tests/chat-cross-window-sync.test.ts); refs are attached
 * before effects flush, like a real React commit.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import React from 'react'

import {
  useChatSheetScroll,
  type ChatSheetScrollControls,
  type ChatSheetScrollMessage,
} from '../src/features/uiV2/useChatSheetScroll.ts'

type ReactInternals = { H: unknown }
const reactInternals = (React as unknown as {
  __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: ReactInternals
}).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE

type EffectSlot = { deps?: readonly unknown[]; cleanup?: () => void }
type HookProps = {
  messages: readonly ChatSheetScrollMessage[]
  scheduleFrame: (callback: () => void) => void
}

function createHookRenderer(
  hookFn: (props: HookProps) => ChatSheetScrollControls,
  attachRefs: (result: ChatSheetScrollControls) => void,
) {
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
    useCallback(fn: unknown) {
      cursor++
      return fn
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

  function render(props: HookProps): ChatSheetScrollControls {
    cursor = 0
    pending = []
    reactInternals.H = dispatcher
    let result: ChatSheetScrollControls
    try {
      result = hookFn(props)
    } finally {
      reactInternals.H = null
    }
    // React attaches refs before passive effects run; the fake history has to
    // be in place before the first-open scroll is scheduled.
    attachRefs(result)
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

type FakeArticle = {
  offsetTop: number
  offsetParent: unknown
  getAttribute(name: string): string | null
}

type ScrollCall = { top: number; behavior?: ScrollBehavior }

interface FakeHistory {
  offsetTop: number
  offsetParent: unknown
  scrollHeight: number
  clientHeight: number
  scrollTop: number
  calls: ScrollCall[]
  addArticle(id: string, offsetTop: number): void
  scrollTo(call: ScrollCall): void
  querySelectorAll(selector: string): FakeArticle[]
}

function createHistory(options: { scrollHeight?: number; clientHeight?: number } = {}): FakeHistory {
  const articles: FakeArticle[] = []
  const calls: ScrollCall[] = []
  const history: FakeHistory = {
    offsetTop: 0,
    offsetParent: null,
    scrollHeight: options.scrollHeight ?? 1200,
    clientHeight: options.clientHeight ?? 500,
    scrollTop: 0,
    calls,
    addArticle(id, offsetTop) {
      articles.push({
        offsetTop,
        offsetParent: history,
        getAttribute: (name) => (name === 'data-message-id' ? id : null),
      })
    },
    scrollTo(call) {
      calls.push(call)
      history.scrollTop = call.top
    },
    querySelectorAll(selector) {
      assert.equal(selector, '[data-message-id]')
      return articles
    },
  }
  return history
}

function userMessage(id: string, content = 'hello'): ChatSheetScrollMessage {
  return { id, role: 'user', content }
}

function assistantMessage(id: string, content = 'hi'): ChatSheetScrollMessage {
  return { id, role: 'assistant', content }
}

function letterMessage(id: string, content = 'letter'): ChatSheetScrollMessage {
  return { id, role: 'assistant', content, capsuleLetter: { body: content } }
}

function createSheet(initialMessages: readonly ChatSheetScrollMessage[], history: FakeHistory) {
  let current = initialMessages
  const renderer = createHookRenderer(useChatSheetScroll, (result) => {
    result.historyRef.current = history as unknown as HTMLDivElement
  })
  let controls!: ChatSheetScrollControls

  const render = () => {
    // A fresh scheduler per render: these tests want frames synchronous.
    controls = renderer.render({ messages: current, scheduleFrame: (callback) => callback() })
    return controls
  }

  const update = (next: readonly ChatSheetScrollMessage[]) => {
    current = next
    return render()
  }

  return {
    render,
    update,
    unmount: renderer.unmount,
    get controls() { return controls },
  }
}

test('first open lands on the latest capsule letter start instead of the bottom', () => {
  const history = createHistory({ scrollHeight: 1200 })
  history.addArticle('u1', 100)
  history.addArticle('letter-1', 420)
  const sheet = createSheet([userMessage('u1'), letterMessage('letter-1')], history)

  sheet.render()

  assert.deepEqual(history.calls, [{ top: 420, behavior: 'auto' }])
  sheet.unmount()
})

test('first open with a plain latest message still lands on the bottom', () => {
  const history = createHistory({ scrollHeight: 1200 })
  history.addArticle('u1', 100)
  history.addArticle('a1', 300)
  const sheet = createSheet([userMessage('u1'), assistantMessage('a1')], history)

  sheet.render()

  assert.deepEqual(history.calls, [{ top: 1200, behavior: 'auto' }])
  sheet.unmount()
})

test('a letter arriving while scrolled up announces, and view-new-messages opens at its start', () => {
  const history = createHistory({ scrollHeight: 1200 })
  history.addArticle('u1', 100)
  const first = [userMessage('u1')]
  const sheet = createSheet(first, history)
  sheet.render()
  history.calls.length = 0

  // The user has scrolled far away from the bottom.
  history.scrollTop = 0
  sheet.controls.handleHistoryScroll()

  history.addArticle('letter-2', 520)
  sheet.update([...first, letterMessage('letter-2')])
  // The announce state is set inside the effect flush, after the render result
  // was captured, so re-render to observe it.
  assert.equal(sheet.render().hasNewMessages, true)

  history.calls.length = 0
  sheet.controls.handleViewNewMessages()

  assert.deepEqual(history.calls, [{ top: 520, behavior: 'smooth' }])
  assert.equal(sheet.render().hasNewMessages, false)
  sheet.unmount()
})

test('following a new capsule letter lands on the new letter start, not the previous bottom', () => {
  const history = createHistory({ scrollHeight: 1200 })
  history.addArticle('u1', 100)
  history.addArticle('a1', 300)
  const first = [userMessage('u1'), assistantMessage('a1')]
  const sheet = createSheet(first, history)
  sheet.render()
  history.calls.length = 0

  history.addArticle('letter-3', 620)
  sheet.update([...first, letterMessage('letter-3')])

  assert.deepEqual(history.calls, [{ top: 620, behavior: 'smooth' }])
  sheet.unmount()
})
