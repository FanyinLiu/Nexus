/**
 * The reminder strip page owns its collapse timer directly (it is a plain
 * sandboxed browser script with no bundler), so these tests load the real
 * `strip.js` into a minimal DOM and drive it with fake timers.
 *
 * The policy is the same one the shared proactive scheduler implements:
 * untouched 12 s, hovered never, leave 5 s, re-hover pauses again.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

import {
  PROACTIVE_BUBBLE_AFTER_HOVER_COLLAPSE_MS,
  PROACTIVE_BUBBLE_AUTO_COLLAPSE_MS,
} from '../src/features/proactive/proactiveCollapse.ts'

const STRIP_PATH = new URL('../electron/reminderStrip/strip.js', import.meta.url)
const STRIP_SOURCE = readFileSync(STRIP_PATH, 'utf8')

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

type StripItem = {
  id: string
  title: string
  body: string
  labels: { done: string; snooze: string; open: string }
}

type Snapshot = { items: StripItem[] }

const LABELS = { done: 'Done', snooze: 'Later', open: 'Open' }

function item(id: string, title = `Title ${id}`, body = `Body ${id}`): StripItem {
  return { id, title, body, labels: LABELS }
}

function snapshot(...items: StripItem[]): Snapshot {
  return { items }
}

type FakeElement = {
  hidden: boolean
  textContent: string
  title: string
  attrs: Record<string, string>
  listeners: Map<string, () => void>
  setAttribute: (name: string, value: string) => void
  addEventListener: (type: string, listener: () => void) => void
}

function createElement(): FakeElement {
  return {
    hidden: true,
    textContent: '',
    title: '',
    attrs: {},
    listeners: new Map(),
    setAttribute(name, value) {
      this.attrs[name] = value
    },
    addEventListener(type, listener) {
      this.listeners.set(type, listener)
    },
  }
}

function createStrip(initial: Snapshot) {
  const clock = createClock()
  const actions: string[] = []
  const elements: Record<string, FakeElement> = {
    strip: createElement(),
    'strip-text': createElement(),
    'strip-count': createElement(),
    'strip-done': createElement(),
    'strip-snooze': createElement(),
  }
  let itemsListener: ((payload: Snapshot) => void) | null = null

  vm.runInNewContext(STRIP_SOURCE, {
    window: {
      reminderStrip: {
        ready: async () => initial,
        act: async (id: string, action: string) => {
          actions.push(`${id}:${action}`)
        },
        onItems: (callback: (payload: Snapshot) => void) => {
          itemsListener = callback
          return () => {
            itemsListener = null
          }
        },
      },
    },
    document: {
      getElementById: (id: string) => elements[id] ?? null,
    },
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  }, { filename: STRIP_PATH.pathname })

  return {
    clock,
    actions,
    elements,
    async ready() {
      await Promise.resolve()
      await Promise.resolve()
    },
    push(payload: Snapshot) {
      itemsListener?.(payload)
    },
    enter() {
      elements.strip.listeners.get('mouseenter')?.()
    },
    leave() {
      elements.strip.listeners.get('mouseleave')?.()
    },
  }
}

function stripNumber(source: string, name: string): number {
  const match = new RegExp(`const ${name} = ([\\d_]+)`).exec(source)
  assert.ok(match, `missing ${name} in strip.js`)
  return Number(match[1]!.replaceAll('_', ''))
}

test('the strip timings equal the shared proactive collapse constants', () => {
  assert.equal(stripNumber(STRIP_SOURCE, 'AUTO_COLLAPSE_MS'), PROACTIVE_BUBBLE_AUTO_COLLAPSE_MS)
  assert.equal(stripNumber(STRIP_SOURCE, 'RESUME_AFTER_HOVER_MS'), PROACTIVE_BUBBLE_AFTER_HOVER_COLLAPSE_MS)
  assert.equal(PROACTIVE_BUBBLE_AUTO_COLLAPSE_MS, 12_000)
  assert.equal(PROACTIVE_BUBBLE_AFTER_HOVER_COLLAPSE_MS, 5_000)
})

test('an untouched strip shows through 11.9 s and expires at 12 s', async () => {
  const strip = createStrip(snapshot(item('task-1')))
  await strip.ready()

  assert.equal(strip.elements.strip.hidden, false)
  strip.clock.tick(PROACTIVE_BUBBLE_AUTO_COLLAPSE_MS - 100)
  assert.deepEqual(strip.actions, [])

  strip.clock.tick(100)
  assert.deepEqual(strip.actions, ['task-1:expire'])
})

test('hovering holds the strip past 20 s and leaving expires it at 5 s', async () => {
  const strip = createStrip(snapshot(item('task-1')))
  await strip.ready()

  strip.enter()
  strip.clock.tick(20_000)
  assert.deepEqual(strip.actions, [])

  strip.leave()
  strip.clock.tick(PROACTIVE_BUBBLE_AFTER_HOVER_COLLAPSE_MS - 100)
  assert.deepEqual(strip.actions, [])

  strip.clock.tick(100)
  assert.deepEqual(strip.actions, ['task-1:expire'])
})

test('re-hovering within the leave window pauses and restarts a fresh 5 s', async () => {
  const strip = createStrip(snapshot(item('task-1')))
  await strip.ready()

  strip.enter()
  strip.leave()
  strip.clock.tick(2_000)
  assert.deepEqual(strip.actions, [])

  strip.enter()
  strip.clock.tick(20_000)
  assert.deepEqual(strip.actions, [])

  strip.leave()
  strip.clock.tick(PROACTIVE_BUBBLE_AFTER_HOVER_COLLAPSE_MS - 100)
  assert.deepEqual(strip.actions, [])

  strip.clock.tick(100)
  assert.deepEqual(strip.actions, ['task-1:expire'])
})

test('a strip pushed while the pointer is already over it waits for the leave', async () => {
  const strip = createStrip(snapshot())
  await strip.ready()

  strip.enter()
  strip.push(snapshot(item('task-1')))
  assert.equal(strip.elements.strip.hidden, false)

  strip.clock.tick(20_000)
  assert.deepEqual(strip.actions, [])

  strip.leave()
  strip.clock.tick(PROACTIVE_BUBBLE_AFTER_HOVER_COLLAPSE_MS - 100)
  assert.deepEqual(strip.actions, [])

  strip.clock.tick(100)
  assert.deepEqual(strip.actions, ['task-1:expire'])
})

test('an update of the same reminder keeps its original 12 s window', async () => {
  const strip = createStrip(snapshot(item('task-1')))
  await strip.ready()

  strip.clock.tick(6_000)
  strip.push(snapshot(item('task-1', 'Updated title', 'Updated body')))
  strip.clock.tick(PROACTIVE_BUBBLE_AUTO_COLLAPSE_MS - 6_000 - 100)
  assert.deepEqual(strip.actions, [])

  strip.clock.tick(100)
  assert.deepEqual(strip.actions, ['task-1:expire'])
})

test('a new reminder gets a fresh 12 s window instead of inheriting the old one', async () => {
  const strip = createStrip(snapshot(item('task-1')))
  await strip.ready()

  strip.clock.tick(6_000)
  strip.push(snapshot(item('task-2')))
  strip.clock.tick(PROACTIVE_BUBBLE_AUTO_COLLAPSE_MS - 100)
  assert.deepEqual(strip.actions, [])

  strip.clock.tick(100)
  assert.deepEqual(strip.actions, ['task-2:expire'])
})
