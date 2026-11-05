/**
 * Shared harness for the proactive direct-notification hook tests.
 *
 * The agenda, bracket and letter cases render the real hooks so the
 * notification payload, the chat/bubble payload and every log call come from
 * the production pipeline. This module owns the React renderer stub, the
 * browser/Electron environment mocks, the console capture and the fixture
 * builders. Test cases and their assertions stay in the test file so the
 * harness never masks a behaviour change.
 *
 * No helper prints user content; console is captured for the duration of each
 * hook run.
 */

import assert from 'node:assert/strict'
import type { TestContext } from 'node:test'

import React from 'react'

import { t as translate } from '../../src/i18n/runtime.ts'
import {
  ERRAND_STORE_STORAGE_KEY,
  PROACTIVE_BRACKET_STATE_STORAGE_KEY,
} from '../../src/lib/storage/core.ts'
import type { AppSettings, MemoryItem } from '../../src/types'

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

// ── Hook renderer ──────────────────────────────────────────────────────────

type ReactInternals = { H: unknown }
const reactInternals = (React as unknown as {
  __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: ReactInternals
}).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE

type EffectSlot = { deps?: readonly unknown[]; cleanup?: () => void }

export function createHookRenderer<P, R>(hookFn: (props: P) => R) {
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

  function unmount(): void {
    for (const effect of effects) effect?.cleanup?.()
  }

  return { render, unmount }
}

// ── Environment ────────────────────────────────────────────────────────────

export type NotificationCall = { title: string; body?: string }
export type NoticeCall = { chatContent: string; bubbleContent?: string; dedupeKey?: string }
export type ConsoleOutput = string[]

type LocalStorageMock = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
  clear: () => void
}

function createLocalStorageMock(): LocalStorageMock {
  const store = new Map<string, string>()
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => { store.set(key, String(value)) },
    removeItem: (key) => { store.delete(key) },
    clear: () => { store.clear() },
  }
}

// A real BroadcastChannel would keep the node test process alive. The fake
// also accepts addEventListener for the persona cache observer.
class FakeBroadcastChannel {
  onmessage: ((event: { data: unknown }) => void) | null = null

  addEventListener(): void {}

  postMessage(): void {}

  close(): void {}

  unref(): void {}
}

type Environment = {
  localStorage: LocalStorageMock
  clock: { now: number }
}

export function installEnvironment(
  t: TestContext,
  options: { now: number; desktopPet?: Record<string, unknown> },
): Environment {
  const clock = { now: options.now }
  const originalNow = Date.now
  Date.now = () => clock.now
  t.after(() => { Date.now = originalNow })

  const localStorage = createLocalStorageMock()
  const target = new EventTarget()
  const win = Object.assign(target, {
    localStorage,
    setTimeout: () => 0,
    clearTimeout: () => undefined,
    setInterval: () => 0,
    clearInterval: () => undefined,
    desktopPet: options.desktopPet ?? {},
  })

  Object.defineProperty(globalThis, 'window', {
    value: win,
    configurable: true,
    writable: true,
  })
  Object.defineProperty(globalThis, 'document', {
    value: { hidden: true, hasFocus: () => false },
    configurable: true,
    writable: true,
  })
  Object.defineProperty(globalThis, 'BroadcastChannel', {
    value: FakeBroadcastChannel,
    configurable: true,
    writable: true,
  })
  t.after(() => {
    Reflect.deleteProperty(globalThis, 'window')
    Reflect.deleteProperty(globalThis, 'document')
  })

  return { localStorage, clock }
}

async function flushAsync(): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
}

async function captureConsole<T>(fn: () => Promise<T>): Promise<{ result: T; output: ConsoleOutput }> {
  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  }
  const output: ConsoleOutput = []
  const record = (...args: unknown[]) => {
    output.push(args.map((value) => String(value)).join(' '))
  }
  console.log = record
  console.info = record
  console.warn = record
  console.error = record
  console.debug = record
  try {
    const result = await fn()
    return { result, output }
  } finally {
    console.log = original.log
    console.info = original.info
    console.warn = original.warn
    console.error = original.error
    console.debug = original.debug
  }
}

export function assertNotLeaked(text: string, secret: string, label: string): void {
  assert.equal(text.includes(secret), false, label)
}

// Compares without rendering the values in a failure diff; a notification
// payload may contain user text and must not be printed by the test runner.
export function assertSame(actual: unknown, expected: unknown, label: string): void {
  assert.equal(actual === expected, true, label)
}

// ── Fixtures ───────────────────────────────────────────────────────────────

export function makeSettings(patch: Record<string, unknown> = {}): AppSettings {
  return {
    uiLanguage: 'zh-CN',
    companionName: '星绘',
    userName: '主人',
    proactiveFrequency: 'normal',
    proactiveQuietHoursStart: 23,
    proactiveQuietHoursEnd: 8,
    proactiveAwayNotificationsEnabled: true,
    proactiveAgendaEnabled: true,
    proactiveBracketEnabled: true,
    proactiveLetterEnabled: false,
    proactiveAwayNotificationThresholdMinutes: 240,
    companionRelationshipType: 'friend',
    memoryPaused: false,
    contextAwarenessEnabled: false,
    activeWindowContextEnabled: false,
    companionAwarenessPaused: false,
    typingAwarenessEnabled: false,
    apiProviderId: 'openai',
    apiBaseUrl: 'https://example.invalid',
    model: 'test-model',
    apiKey: 'test-key',
    systemPrompt: 'You are a warm companion.',
    activeCharacterProfileId: '',
    ...patch,
  } as unknown as AppSettings
}

export function makeLoop(
  patch: Partial<MemoryItem> & Pick<MemoryItem, 'id' | 'content' | 'createdAt'>,
): MemoryItem {
  return {
    category: 'goal',
    source: 'chat',
    kind: 'open_loop',
    loopStatus: 'open',
    enabled: true,
    status: 'active',
    ...patch,
  }
}

// ── Agenda hook ────────────────────────────────────────────────────────────

export type AgendaRun = {
  logs: Array<{ title: string; detail: string }>
  notices: NoticeCall[]
  notifications: NotificationCall[]
  consoleOutput: ConsoleOutput
}

export async function runAgenda(
  t: TestContext,
  options: { now: number; memories: MemoryItem[]; settings?: Record<string, unknown> },
): Promise<AgendaRun> {
  const notifications: NotificationCall[] = []
  installEnvironment(t, {
    now: options.now,
    desktopPet: {
      showProactiveNotification: async (payload: NotificationCall) => {
        notifications.push(payload)
      },
    },
  })

  const { useProactiveAgenda } = await import('../../src/hooks/useProactiveAgenda.ts')
  const logs: Array<{ title: string; detail: string }> = []
  const notices: NoticeCall[] = []
  const settings = makeSettings({
    proactiveAgendaEnabled: true,
    proactiveAwayNotificationsEnabled: true,
    ...options.settings,
  })
  const settingsRef = { current: settings }
  const memoriesRef = { current: options.memories }
  const focusStateRef = { current: 'active' as const }
  const renderer = createHookRenderer(useProactiveAgenda)

  const { output } = await captureConsole(async () => {
    renderer.render({
      enabled: true,
      settingsRef,
      memoriesRef,
      dailyMemoriesRef: { current: {} },
      setMemories: (next: MemoryItem[]) => { memoriesRef.current = next },
      focusState: 'active' as const,
      focusStateRef,
      idleSecondsRef: { current: 0 },
      busyRef: { current: false },
      pushCompanionNotice: async (payload: NoticeCall) => { notices.push(payload) },
      t: translate,
      onLog: (title: string, detail: string) => { logs.push({ title, detail }) },
    })
    await flushAsync()
  })
  renderer.unmount()

  return { logs, notices, notifications, consoleOutput: output }
}

export const AGENDA_MEMORY_TEXT = '周四下午三点在国贸和小林对一下季度方案，顺便把上周的发票带过去'

// ── Bracket hook ───────────────────────────────────────────────────────────

export type BracketRun = {
  notices: NoticeCall[]
  notifications: NotificationCall[]
  consoleOutput: ConsoleOutput
}

export async function runBracket(
  t: TestContext,
  options: {
    now: number
    settings?: Record<string, unknown>
    bracketState?: Record<string, unknown>
    errands?: Array<Record<string, unknown>>
  },
): Promise<BracketRun> {
  const notifications: NotificationCall[] = []
  const env = installEnvironment(t, {
    now: options.now,
    desktopPet: {
      showProactiveNotification: async (payload: NotificationCall) => {
        notifications.push(payload)
      },
    },
  })
  if (options.bracketState) {
    env.localStorage.setItem(
      PROACTIVE_BRACKET_STATE_STORAGE_KEY,
      JSON.stringify(options.bracketState),
    )
  }
  if (options.errands) {
    env.localStorage.setItem(ERRAND_STORE_STORAGE_KEY, JSON.stringify(options.errands))
  }

  const { useBracketScheduler } = await import('../../src/hooks/useBracketScheduler.ts')
  const notices: NoticeCall[] = []
  const renderer = createHookRenderer(useBracketScheduler)
  const { output } = await captureConsole(async () => {
    renderer.render({
      settings: makeSettings({
        proactiveBracketEnabled: true,
        proactiveLetterEnabled: false,
        ...options.settings,
      }),
      messages: [],
      memories: [],
      panelCollapsed: false,
      enabled: true,
      pushCompanionNotice: async (payload: NoticeCall) => { notices.push(payload) },
      focusState: 'active' as const,
      onEvent: () => undefined,
    })
    await flushAsync()
  })
  renderer.unmount()

  return { notices, notifications, consoleOutput: output }
}

export const EVENING_TOPIC = '搬家的事'
export const ERRAND_PROMPT = '帮我查一下下周去杭州的高铁'
export const ERRAND_RESULT = 'G7311 08:05 出发，11:12 到杭州东'

// ── Weekly letter hook ─────────────────────────────────────────────────────

export const LETTER_GREETING = '亲爱的你，这周辛苦了。'
export const LETTER_BODY = '这周你完成了季度方案，也去看了房子。'

export async function runLetter(
  t: TestContext,
  options: { now: number; companionName: string },
): Promise<{ notifications: NotificationCall[]; consoleOutput: ConsoleOutput }> {
  const notifications: NotificationCall[] = []
  installEnvironment(t, {
    now: options.now,
    desktopPet: {
      completeChat: async () => ({
        content: JSON.stringify({
          greeting: LETTER_GREETING,
          summary: LETTER_BODY,
          suggestion: '下周留一点时间给自己。',
          intention: '慢一点也没关系。',
          experiment: '每天散步十分钟。',
          closing: '下周见。',
        }),
      }),
      showProactiveNotification: async (payload: NotificationCall) => {
        notifications.push(payload)
      },
    },
  })

  const { useLetterScheduler } = await import('../../src/hooks/useLetterScheduler.ts')
  const renderer = createHookRenderer(useLetterScheduler)
  const memories = [makeLoop({
    id: 'letter-memory',
    content: '这周完成了季度方案',
    createdAt: new Date(options.now - DAY).toISOString(),
  })]

  const { output } = await captureConsole(async () => {
    renderer.render({
      settings: makeSettings({
        proactiveLetterEnabled: true,
        companionName: options.companionName,
      }),
      messages: [],
      memories,
      dailyMemories: {},
      focusState: 'away' as const,
      enabled: true,
      onEvent: () => undefined,
    })
    await flushAsync()
  })
  renderer.unmount()

  return { notifications, consoleOutput: output }
}

// Sunday 19:00 local is the letter slot.
export const LETTER_NOW = new Date(2026, 3, 26, 19, 0, 0).getTime()
