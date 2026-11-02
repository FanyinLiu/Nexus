/**
 * The capsule chat line is proposed by the real `runFutureCapsuleTick` (the
 * body of `useFutureCapsuleScheduler`'s poll) and rendered by the real
 * `useCompanionNotices` hook. These tests drive both without rebuilding the
 * payload by hand, so they pin the chat-only contract: one assistant message,
 * no bubble, no speech, no panel activation, no pet reaction, and no inbox
 * mutation.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'

import React from 'react'

import { routeDelivery } from '../shared/proactiveDelivery.js'
import type { DeliveryContext } from '../shared/proactiveDelivery.js'
import { createProactiveInboxStore } from '../electron/services/proactiveInboxStore.js'
import { buildCapsuleProactiveMessage } from '../src/features/futureCapsule/capsuleProactiveMessage.ts'
import { buildFutureCapsuleDelivery } from '../src/features/futureCapsule/futureCapsuleDelivery.ts'
import { findDueCapsule } from '../src/features/futureCapsule/futureCapsuleStore.ts'
import type { FutureCapsuleRecord } from '../src/features/futureCapsule/futureCapsuleStore.ts'
import { useCompanionNotices } from '../src/hooks/chat/useCompanionNotices.ts'
import type { CompanionNoticePayload } from '../src/hooks/chat/types.ts'
import { runFutureCapsuleTick } from '../src/hooks/useFutureCapsuleScheduler.ts'
import { localDayKey } from '../src/lib/localDate.ts'
import { subscribePetNotify } from '../src/lib/petNotifyBus.ts'
import type { PetNotifyEvent } from '../src/lib/petNotifyBus.ts'
import { FUTURE_CAPSULE_STORE_STORAGE_KEY } from '../src/lib/storage/core.ts'
import type { AppSettings, ChatMessage, FocusState, PetDialogBubbleState } from '../src/types/index.ts'
import type { Translator } from '../src/types/i18n.ts'

const NOW = new Date(2026, 4, 1, 12, 0, 0).getTime()
const QUIET_NOW = new Date(2026, 4, 1, 2, 0, 0).getTime()

const CAPSULE: FutureCapsuleRecord = {
  id: 'capsule-1',
  message: 'Remember to breathe',
  createdAt: '2026-01-01T08:00:00.000Z',
  scheduledFor: '2020-01-01',
  status: 'pending',
}

function makeSettings(patch: Partial<AppSettings> = {}): AppSettings {
  return {
    uiLanguage: 'en-US',
    companionName: 'Nexus',
    proactiveQuietHoursStart: 23,
    proactiveQuietHoursEnd: 8,
    proactiveAwayNotificationsEnabled: true,
    contextAwarenessEnabled: false,
    activeWindowContextEnabled: false,
    companionAwarenessPaused: false,
    ...patch,
  } as unknown as AppSettings
}

function createInbox(t: TestContext) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-capsule-chat-inbox-'))
  const store = createProactiveInboxStore({
    getStorePath: () => path.join(directory, 'proactive-inbox.json'),
    now: () => NOW,
  })
  t.after(async () => {
    await store.flush()
    fs.rmSync(directory, { recursive: true, force: true })
  })
  return store
}

type CompanionNoticeApi = ReturnType<typeof useCompanionNotices>

type ReactInternals = { H: unknown }
const reactInternals = (React as unknown as {
  __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: ReactInternals
}).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE

type CallbackSlot = { fn: unknown; deps?: readonly unknown[] }

/**
 * Render the real `useCompanionNotices` hook through React's dispatcher.
 *
 * The hook only uses `useRef` and `useCallback`, so a one-shot render is
 * enough to obtain the actual push function without mounting a component or
 * reimplementing the dedupe/chat/bubble fan-out in the test.
 */
function renderCompanionNotices(
  config: Parameters<typeof useCompanionNotices>[0],
): CompanionNoticeApi {
  const slots: unknown[] = []
  let cursor = 0
  const dispatcher = {
    useRef(initial: unknown) {
      const index = cursor++
      if (!(index in slots)) slots[index] = { current: initial }
      return slots[index]
    },
    useCallback(fn: unknown, deps?: readonly unknown[]) {
      const index = cursor++
      // No re-render happens here, so the first closure stays valid.
      if (!(index in slots)) slots[index] = { fn, deps }
      return (slots[index] as CallbackSlot).fn
    },
  }
  function Probe() {
    return useCompanionNotices(config)
  }
  reactInternals.H = dispatcher
  try {
    return Probe()
  } finally {
    reactInternals.H = null
  }
}

function createCompanionNoticeSpies() {
  const chatMessages: ChatMessage[] = []
  const bubbles: PetDialogBubbleState[] = []
  const speech: string[] = []
  const api = renderCompanionNotices({
    ctx: {
      speakAssistantReply: async (text) => { speech.push(text) },
      voiceStateRef: { current: 'idle' },
    },
    t: ((key: string) => key) as unknown as Translator,
    busyRef: { current: false },
    appendChatMessage: (message) => { chatMessages.push(message) },
    presentPetDialogBubble: (bubble) => { bubbles.push(bubble) },
    setError: () => undefined,
  })
  return { api, chatMessages, bubbles, speech }
}

/** The exact payload the real tick hands to the chat line, plus its bridge traffic. */
type TickEnvironment = {
  now: number
  settings: AppSettings
  payloads: CompanionNoticePayload[]
  bridgeCalls: Array<{ method: string; args: unknown[] }>
  runTick: () => Promise<void>
}

/** Preload method names the capsule delivery path is allowed to touch. */
const CAPSULE_BRIDGE_ALLOWLIST = new Set([
  'deliverProactiveMessage',
  'showProactiveNotification',
  'getDesktopContext',
])

/**
 * Run the production tick against a seeded capsule store and a recording
 * `window.desktopPet`. The Proxy records every method access and call, so an
 * unexpected bridge call (a panel raise, say) cannot slip through unnoticed.
 */
function installTickEnvironment(
  t: TestContext,
  options: {
    now?: number
    capsule?: FutureCapsuleRecord
    settings?: Partial<AppSettings>
    focusState?: FocusState
    desktopContext?: { activeWindowTitle: string; activeWindowAppName: string } | null
  } = {},
): TickEnvironment {
  const now = options.now ?? NOW
  const capsule = options.capsule ?? CAPSULE
  const settings = makeSettings(options.settings)
  const store = new Map<string, string>([[FUTURE_CAPSULE_STORE_STORAGE_KEY, JSON.stringify([capsule])]])
  const localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, String(value)) },
    removeItem: (key: string) => { store.delete(key) },
  }

  const payloads: CompanionNoticePayload[] = []
  const bridgeCalls: Array<{ method: string; args: unknown[] }> = []
  const handlers: Record<string, (payload: unknown) => unknown> = {
    deliverProactiveMessage: (payload) => {
      const { message, context } = payload as Parameters<typeof routeDelivery>
      return routeDelivery(message, context)
    },
    getDesktopContext: () => options.desktopContext ?? null,
  }
  const desktopPet = new Proxy({}, {
    get(_target, property) {
      if (typeof property !== 'string') return undefined
      return async (...args: unknown[]) => {
        bridgeCalls.push({ method: property, args })
        return handlers[property]?.(args[0])
      }
    },
  })

  Object.defineProperty(globalThis, 'window', {
    value: { localStorage, desktopPet },
    configurable: true,
    writable: true,
  })
  t.after(() => { Reflect.deleteProperty(globalThis, 'window') })

  return {
    now,
    settings,
    payloads,
    bridgeCalls,
    runTick: () => runFutureCapsuleTick({
      settings,
      now,
      ...(options.focusState ? { focusState: options.focusState } : {}),
      pushCompanionNotice: async (payload) => { payloads.push(payload) },
    }, () => false),
  }
}

/** Expected chat text for a capsule: the verbatim copy, not the display clip. */
function expectedChatText(capsule: FutureCapsuleRecord, now: number): string {
  const delivery = buildFutureCapsuleDelivery({
    uiLanguage: 'en-US',
    companionName: 'Nexus',
    capsule,
    now: new Date(now),
  })
  return delivery.fullBody
}

test('the real tick sends one history-only payload with the full capsule text', async (t) => {
  const capsule: FutureCapsuleRecord = {
    ...CAPSULE,
    message: 'Remember to breathe\nand to rest',
  }
  const env = installTickEnvironment(t, { capsule, now: NOW })

  await env.runTick()

  assert.equal(env.payloads.length, 1, 'one capsule means exactly one chat line')
  const payload = env.payloads[0]
  assert.ok(payload)
  assert.equal(payload.chatContent, expectedChatText(capsule, NOW))
  assert.equal(payload.chatContent.includes('\n'), true, 'the line keeps the authored text')
  assert.equal(payload.bubbleContent, '', 'an empty bubble suppresses the pet bubble')
  assert.equal(payload.dedupeKey, `capsule:${capsule.id}`)
  assert.equal(payload.petReaction, false, 'the line is history only, the pet must not react')
  assert.equal('speechContent' in payload, false, 'the capsule line is never spoken')
  assert.equal('proactiveTitle' in payload, false, 'the line is not a router bubble')
})

test('pushCompanionNotice with the real capsule dedupe key appends one chat line', async (t) => {
  const env = installTickEnvironment(t)
  await env.runTick()
  const payload = env.payloads[0]
  assert.ok(payload)

  const { api, chatMessages, bubbles, speech } = createCompanionNoticeSpies()
  await api.pushCompanionNotice(payload)
  await api.pushCompanionNotice({ ...payload })

  assert.equal(chatMessages.length, 1, 'the dedupe key keeps a capsule on one entry')
  assert.equal(chatMessages[0]?.role, 'assistant')
  assert.equal(chatMessages[0]?.content, payload.chatContent)
  assert.equal(bubbles.length, 0)
  assert.equal(speech.length, 0)
})

for (const scenario of [
  {
    name: 'normal focus',
    options: { now: NOW } as const,
    expected: { fullscreen: false, inQuietHours: false },
  },
  {
    name: 'quiet hours',
    options: { now: QUIET_NOW } as const,
    expected: { fullscreen: false, inQuietHours: true },
  },
  {
    name: 'fullscreen',
    options: {
      now: NOW,
      settings: { contextAwarenessEnabled: true, activeWindowContextEnabled: true },
      desktopContext: { activeWindowTitle: 'Fullscreen video', activeWindowAppName: 'Safari' },
    } as const,
    expected: { fullscreen: true, inQuietHours: false },
  },
]) {
  test(`the capsule tick is chat-only in ${scenario.name}: no bubble, speech or panel`, async (t) => {
    const env = installTickEnvironment(t, scenario.options)

    await env.runTick()

    assert.equal(env.payloads.length, 1)
    const deliverCall = env.bridgeCalls.find((call) => call.method === 'deliverProactiveMessage')
    assert.ok(deliverCall, 'the capsule must reach the router')
    const deliveredContext = (deliverCall.args[0] as { context: DeliveryContext }).context
    assert.deepEqual(
      { fullscreen: deliveredContext.fullscreen, inQuietHours: deliveredContext.inQuietHours },
      scenario.expected,
      'the scenario must actually drive the intended routing context',
    )
    // The delivery path may only talk to the router, the notification bridge
    // and the desktop-context reader. Any other preload method — panel open,
    // raise, focus, window state — is a contract violation.
    const unexpectedCalls = env.bridgeCalls.filter(
      (call) => !CAPSULE_BRIDGE_ALLOWLIST.has(call.method),
    )
    assert.deepEqual(
      unexpectedCalls.map((call) => call.method),
      [],
      'the capsule tick must not call any panel / window bridge method',
    )

    const payload = env.payloads[0]
    assert.ok(payload)
    // A panel-opening request would be a field on the notice payload (for
    // example `openPanel`); the payload carries the chat line and nothing else.
    assert.deepEqual(
      Object.keys(payload).sort(),
      ['bubbleContent', 'chatContent', 'dedupeKey', 'petReaction'],
    )

    const { api, chatMessages, bubbles, speech } = createCompanionNoticeSpies()
    await api.pushCompanionNotice(payload)

    assert.equal(chatMessages.length, 1)
    assert.equal(chatMessages[0]?.role, 'assistant')
    assert.equal(chatMessages[0]?.content, payload.chatContent)
    assert.deepEqual(bubbles, [], 'an empty bubbleContent must not draw a bubble')
    assert.deepEqual(speech, [], 'the line is never spoken')
  })
}

test('the silent capsule line moves no pet presence or mood', async (t) => {
  const env = installTickEnvironment(t)
  await env.runTick()
  const payload = env.payloads[0]
  assert.ok(payload)

  const events: PetNotifyEvent[] = []
  const unsubscribe = subscribePetNotify((event) => { events.push(event) })
  t.after(unsubscribe)

  const { api, chatMessages } = createCompanionNoticeSpies()
  await api.pushCompanionNotice(payload)

  assert.equal(chatMessages.length, 1)
  assert.deepEqual(events, [], 'a quiet delivery must not animate the pet')
})

test('a normal notice without the flag still wakes presence and mood', async (t) => {
  const events: PetNotifyEvent[] = []
  const unsubscribe = subscribePetNotify((event) => { events.push(event) })
  t.after(unsubscribe)

  const { api, chatMessages } = createCompanionNoticeSpies()
  await api.pushCompanionNotice({ chatContent: 'an ordinary companion line' })

  assert.equal(chatMessages.length, 1)
  assert.deepEqual(events, [
    { type: 'presence_activity' },
    { type: 'mood', mood: 'happy' },
  ])
})

test('the silent chat line leaves the inbox unread count and status untouched', async (t) => {
  const env = installTickEnvironment(t)
  const store = createInbox(t)
  const delivery = buildFutureCapsuleDelivery({
    uiLanguage: 'en-US',
    companionName: 'Nexus',
    capsule: CAPSULE,
    now: new Date(NOW),
  })
  const message = buildCapsuleProactiveMessage(CAPSULE, delivery, NOW)
  store.upsert(message)

  const before = store.list()
  await env.runTick()

  const payload = env.payloads[0]
  assert.ok(payload)
  assert.equal(payload.chatContent, message.fullBody ?? delivery.body)
  const { api, chatMessages } = createCompanionNoticeSpies()
  await api.pushCompanionNotice(payload)
  const after = store.list()

  assert.equal(chatMessages.length, 1)
  assert.equal(after.unreadCount, before.unreadCount)
  assert.equal(after.unreadCount, 1)
  const beforeEntry = before.entries.find((entry) => entry.id === message.id)
  const afterEntry = after.entries.find((entry) => entry.id === message.id)
  assert.equal(beforeEntry?.status, 'unread')
  assert.equal(afterEntry?.status, beforeEntry?.status)
})

test('after a restart the capsule is not due, so its chat line stays at one', async (t) => {
  const capsule: FutureCapsuleRecord = { ...CAPSULE, scheduledFor: localDayKey(NOW) }
  const env = installTickEnvironment(t, { capsule })

  await env.runTick()
  assert.equal(env.payloads.length, 1)
  assert.equal(findDueCapsule(new Date(NOW)), null)

  // A restarted store module re-reads the persisted state from scratch.
  const restarted = await import(
    '../src/features/futureCapsule/futureCapsuleStore.ts?capsule-chat-restart=1'
  )
  assert.equal(restarted.findDueCapsule(new Date(NOW)), null)

  await env.runTick()
  assert.equal(env.payloads.length, 1, 'the delivered capsule never reaches chat twice')
})
