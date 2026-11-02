/**
 * The capsule chat line is proposed by `deliverDueCapsule` and rendered by the
 * real `useCompanionNotices` hook. These tests drive that hook without a React
 * tree to pin the chat-only contract: one assistant message, no bubble, no
 * speech, no panel activation, and no inbox mutation.
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
import {
  buildCapsuleProactiveMessage,
  deliverDueCapsule,
} from '../src/features/futureCapsule/capsuleProactiveMessage.ts'
import type { CapsuleDeliveryText } from '../src/features/futureCapsule/capsuleProactiveMessage.ts'
import { buildFutureCapsuleDelivery } from '../src/features/futureCapsule/futureCapsuleDelivery.ts'
import {
  findDueCapsule,
  markDelivered as markPersistedCapsule,
} from '../src/features/futureCapsule/futureCapsuleStore.ts'
import type { FutureCapsuleRecord } from '../src/features/futureCapsule/futureCapsuleStore.ts'
import { useCompanionNotices } from '../src/hooks/chat/useCompanionNotices.ts'
import type { CompanionNoticePayload } from '../src/hooks/chat/types.ts'
import { localDayKey } from '../src/lib/localDate.ts'
import { FUTURE_CAPSULE_STORE_STORAGE_KEY } from '../src/lib/storage/core.ts'
import type { ChatMessage, PetDialogBubbleState } from '../src/types/index.ts'
import type { Translator } from '../src/types/i18n.ts'

const NOW = 1_700_000_000_000

const CAPSULE: FutureCapsuleRecord = {
  id: 'capsule-1',
  message: 'Remember to breathe',
  createdAt: '2026-01-01T08:00:00.000Z',
  scheduledFor: '2026-02-01',
  status: 'pending',
}

const DELIVERY: CapsuleDeliveryText = {
  title: 'A note from your past self',
  body: 'Nexus: 31 days ago you wrote a note for today. Reading it back: "Remember to breathe"',
}

function makeContext(overrides: Partial<DeliveryContext> = {}): DeliveryContext {
  return {
    panelFocused: false,
    fullscreen: false,
    focusState: 'active',
    inQuietHours: false,
    systemDnd: null,
    awayNotificationsEnabled: false,
    stripEnabled: true,
    ...overrides,
  }
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

/** The exact payload `useFutureCapsuleScheduler` hands to the chat line. */
function capsuleChatPayload(text: string, capsuleId: string): CompanionNoticePayload {
  return {
    chatContent: text,
    bubbleContent: '',
    dedupeKey: `capsule:${capsuleId}`,
  }
}

function createLocalStorageMock() {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, String(value)) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => { store.clear() },
  }
}

function installCapsuleStorage(): void {
  Object.defineProperty(globalThis, 'window', {
    value: { localStorage: createLocalStorageMock() },
    configurable: true,
    writable: true,
  })
}

function seedCapsules(capsules: FutureCapsuleRecord[]): void {
  window.localStorage.setItem(FUTURE_CAPSULE_STORE_STORAGE_KEY, JSON.stringify(capsules))
}

function installPanelBridgeSpies() {
  const calls: string[] = []
  const desktopPet: Record<string, () => Promise<void>> = {}
  for (const method of ['openPanel', 'showPanel', 'focusPanel', 'raisePanel', 'restorePanel']) {
    desktopPet[method] = async () => { calls.push(method) }
  }
  Object.defineProperty(globalThis, 'window', {
    value: { desktopPet },
    configurable: true,
    writable: true,
  })
  return calls
}

test('pushCompanionNotice with the same capsule dedupe key appends one chat line', async () => {
  const { api, chatMessages, bubbles, speech } = createCompanionNoticeSpies()
  const payload = capsuleChatPayload('first line\nsecond line', CAPSULE.id)

  await api.pushCompanionNotice(payload)
  await api.pushCompanionNotice({ ...payload })

  assert.equal(chatMessages.length, 1, 'the dedupe key keeps a capsule on one entry')
  assert.equal(chatMessages[0]?.role, 'assistant')
  assert.equal(chatMessages[0]?.content, 'first line\nsecond line')
  assert.equal(bubbles.length, 0)
  assert.equal(speech.length, 0)
})

test('the silent capsule line is chat-only: no bubble, no speech, no panel', async () => {
  const panelCalls = installPanelBridgeSpies()
  const { api, chatMessages, bubbles, speech } = createCompanionNoticeSpies()
  const text = 'the whole capsule text, kept verbatim'
  const payload = capsuleChatPayload(text, CAPSULE.id)

  assert.equal('speechContent' in payload, false)
  assert.equal('proactiveTitle' in payload, false)
  assert.equal(payload.bubbleContent, '')

  await api.pushCompanionNotice(payload)

  assert.equal(chatMessages.length, 1)
  assert.equal(chatMessages[0]?.role, 'assistant')
  assert.equal(chatMessages[0]?.content, text)
  assert.deepEqual(bubbles, [], 'an empty bubbleContent must not draw a bubble')
  assert.deepEqual(speech, [], 'the line is never spoken')
  assert.deepEqual(panelCalls, [], 'the line must not open, raise or focus the panel')
})

test('the silent chat line leaves the inbox unread count and status untouched', async (t) => {
  const store = createInbox(t)
  const message = buildCapsuleProactiveMessage(CAPSULE, DELIVERY, NOW)
  store.upsert(message)

  const before = store.list()
  const { api, chatMessages } = createCompanionNoticeSpies()
  await api.pushCompanionNotice(capsuleChatPayload(message.fullBody ?? DELIVERY.body, CAPSULE.id))
  const after = store.list()

  assert.equal(chatMessages.length, 1)
  assert.equal(after.unreadCount, before.unreadCount)
  assert.equal(after.unreadCount, 1)
  const beforeEntry = before.entries.find((entry) => entry.id === message.id)
  const afterEntry = after.entries.find((entry) => entry.id === message.id)
  assert.equal(beforeEntry?.status, 'unread')
  assert.equal(afterEntry?.status, beforeEntry?.status)
})

test('after a restart the capsule is not due, so its chat line stays at one', async () => {
  installCapsuleStorage()
  const dueToday: FutureCapsuleRecord = { ...CAPSULE, scheduledFor: localDayKey(NOW) }
  seedCapsules([dueToday])
  const chatLines: string[] = []

  async function runTick(): Promise<boolean> {
    const due = findDueCapsule(new Date(NOW))
    if (!due) return false

    const delivery = buildFutureCapsuleDelivery({
      uiLanguage: 'en-US',
      companionName: 'Nexus',
      capsule: due,
      now: new Date(NOW),
    })
    await deliverDueCapsule({
      capsule: due,
      delivery,
      now: NOW,
      useLegacyPath: false,
      deliver: async ({ message, context }) => routeDelivery(message, context),
      buildContext: () => makeContext(),
      preferences: {
        quietStart: 22,
        quietEnd: 8,
        desktopAwarenessAllowed: true,
        awayNotificationsEnabled: true,
      },
      pushChatLine: async (text) => { chatLines.push(text) },
      markDelivered: (id) => { markPersistedCapsule(id, new Date(NOW)) },
      isStopped: () => false,
    })
    return true
  }

  assert.equal(await runTick(), true)
  assert.equal(chatLines.length, 1)

  // A restarted store module re-reads the persisted state from scratch.
  const restarted = await import(
    '../src/features/futureCapsule/futureCapsuleStore.ts?capsule-chat-restart=1'
  )
  assert.equal(restarted.findDueCapsule(new Date(NOW)), null)
  assert.equal(await runTick(), false)
  assert.equal(chatLines.length, 1)
})
