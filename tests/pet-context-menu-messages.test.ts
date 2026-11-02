import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import type { DeliveryContext } from '../shared/proactiveDelivery.js'
import { mainT } from '../electron/mainMessages.js'
import { MAIN_MESSAGES, MAIN_MESSAGE_LOCALES } from '../electron/mainMessagesTable.js'
import {
  PET_CONTEXT_MENU_CLOSE_GRACE_MS,
  buildPetContextMenuTemplate,
  popupPetContextMenu,
} from '../electron/petContextMenu.js'
import type { ProactiveInboxEntryView } from '../src/features/proactive/proactiveInboxOverlay.ts'
import { createProactiveInboxOverlayController } from '../src/features/proactive/proactiveInboxOverlayController.ts'
import { createPetMenuOpenHandler } from '../src/features/proactive/petMenuOpen.ts'

type PetMenuTemplate = ReturnType<typeof buildPetContextMenuTemplate>

const CONTEXT: DeliveryContext = {
  panelFocused: false,
  fullscreen: false,
  focusState: 'active',
  inQuietHours: false,
  systemDnd: null,
  awayNotificationsEnabled: false,
  stripEnabled: true,
}

function noopHandlers() {
  return {
    chat: () => {},
    settings: () => {},
    resetPosition: () => {},
    hidePet: () => {},
    quit: () => {},
  }
}

test('the main messages table has menu.messages in all five locales', () => {
  const expected: Record<string, string> = {
    'zh-CN': '消息',
    'zh-TW': '訊息',
    'en-US': 'Messages',
    ja: 'メッセージ',
    ko: '메시지',
  }

  assert.deepEqual([...MAIN_MESSAGE_LOCALES], Object.keys(expected))
  for (const locale of MAIN_MESSAGE_LOCALES) {
    assert.equal(MAIN_MESSAGES[locale]['menu.messages'], expected[locale], locale)
  }
})

test('the pet menu template puts Messages first and keeps the other items', () => {
  const calls: string[] = []
  const template = buildPetContextMenuTemplate({
    messages: () => calls.push('messages'),
    chat: () => calls.push('chat'),
    settings: () => calls.push('settings'),
    resetPosition: () => calls.push('resetPosition'),
    hidePet: () => calls.push('hidePet'),
    quit: () => calls.push('quit'),
  })

  assert.equal(template[0].label, mainT('menu.messages'))
  assert.equal(template[0].label, 'Messages')
  assert.equal(template[1].label, mainT('menu.chat'))
  assert.equal(template[2].label, mainT('menu.settings'))
  assert.equal(template[4].type, 'separator')

  ;(template[0].click as (() => void) | undefined)?.()
  assert.deepEqual(calls, ['messages'])
})

test('choosing Messages resolves the menu promise to messages', async () => {
  let template: PetMenuTemplate | null = null
  let onClose: (() => void) | null = null

  const pending = popupPetContextMenu({
    popup: (next, close) => {
      template = next
      onClose = close
    },
    handlers: noopHandlers(),
  })

  assert.ok(template && onClose)
  ;(template[0].click as (() => void) | undefined)?.()
  onClose?.()

  assert.equal(await pending, 'messages')
})

test('closing without a click resolves null after the close grace period', async () => {
  let onClose: (() => void) | null = null
  let scheduled: (() => void) | null = null
  let graceMs = 0

  const pending = popupPetContextMenu({
    popup: (_template, close) => {
      onClose = close
    },
    handlers: noopHandlers(),
    schedule: (callback, ms) => {
      scheduled = callback
      graceMs = ms
      return 0 as unknown as ReturnType<typeof setTimeout>
    },
    cancel: () => {},
  })

  assert.ok(onClose)
  onClose()
  assert.equal(graceMs, PET_CONTEXT_MENU_CLOSE_GRACE_MS)
  assert.equal(graceMs, 250)
  assert.ok(scheduled)
  scheduled()

  assert.equal(await pending, null)
})

test('a macOS click that arrives after close still wins during the grace period', async () => {
  let template: PetMenuTemplate | null = null
  let onClose: (() => void) | null = null
  let scheduled: (() => void) | null = null

  const pending = popupPetContextMenu({
    popup: (next, close) => {
      template = next
      onClose = close
    },
    handlers: noopHandlers(),
    schedule: (callback) => {
      scheduled = callback
      return 0 as unknown as ReturnType<typeof setTimeout>
    },
    cancel: () => {},
  })

  assert.ok(template && onClose)
  onClose()
  ;(template[0].click as (() => void) | undefined)?.()
  scheduled()

  assert.equal(await pending, 'messages')
})

test('a messages result opens the overlay and any other result does not', async () => {
  let openedMessages = 0
  await createPetMenuOpenHandler({
    openPetMenu: async () => 'messages',
    openInboxOverlay: () => {
      openedMessages += 1
    },
  })()
  assert.equal(openedMessages, 1)

  let openedNull = 0
  await createPetMenuOpenHandler({
    openPetMenu: async () => null,
    openInboxOverlay: () => {
      openedNull += 1
    },
  })()
  assert.equal(openedNull, 0)

  let openErrors = 0
  await createPetMenuOpenHandler({
    openPetMenu: async () => {
      throw new Error('menu failed')
    },
    openInboxOverlay: () => {
      openedNull += 1
    },
    onError: () => {
      openErrors += 1
    },
  })()
  assert.equal(openErrors, 1)
  assert.equal(openedNull, 0)
})

test('menu-open at unreadCount 0 opens the controller on its read entries', async () => {
  const now = 1_000_000_000
  const readEntry: ProactiveInboxEntryView = {
    id: 'read-only',
    source: 'reminder',
    kind: 'reminder_follow_up',
    priority: 'normal',
    title: 'Read only',
    body: 'Already read',
    actions: ['open'],
    createdAt: now - 1_000,
    status: 'done',
    updatedAt: now - 1_000,
  }

  const controller = createProactiveInboxOverlayController({
    bridge: {
      list: async () => ({
        entries: [readEntry],
        unreadCount: 0,
        removedIds: [],
      }),
      update: async () => ({ updated: false, unreadCount: 0 }),
      deliver: async () => null,
      openConversation: () => {},
    },
    buildDeliveryPayload: async (message) => ({
      message,
      context: CONTEXT,
      preferences: {
        quietStart: 0,
        quietEnd: 0,
        desktopAwarenessAllowed: false,
        awayNotificationsEnabled: false,
      },
    }),
    logger: { warn: () => {} },
    setTimeout: () => 0,
    clearTimeout: () => {},
    nowMs: () => now,
  })

  let opening: Promise<void> | null = null
  await createPetMenuOpenHandler({
    openPetMenu: async () => 'messages',
    openInboxOverlay: () => {
      opening = controller.open()
    },
  })()
  await opening

  const snapshot = controller.getSnapshot()
  assert.equal(snapshot.open, true)
  assert.equal(snapshot.unreadCount, 0)
  assert.deepEqual(snapshot.rows.map((entry) => entry.id), ['read-only'])
  assert.equal(snapshot.rows[0].read, true)
  controller.dispose()
})

test('only the v2 context-menu gesture calls openPetMenu, never click or pointer handlers', () => {
  const surface = readFileSync(
    new URL('../src/features/uiV2/FramelessCompanionSurface.tsx', import.meta.url),
    'utf8',
  )
  const occurrences = [...surface.matchAll(/openPetMenu\(\)/g)]
  assert.equal(occurrences.length, 1)

  const contextStart = surface.indexOf('onContextMenu={')
  const contextEnd = surface.indexOf('onDoubleClick=', contextStart)
  assert.ok(contextStart >= 0 && contextEnd > contextStart)
  const contextHandler = surface.slice(contextStart, contextEnd)
  assert.match(contextHandler, /event\.preventDefault\(\)/)
  assert.match(contextHandler, /openPetMenu\(\)/)
  assert.ok(occurrences[0].index > contextStart && occurrences[0].index < contextEnd)
  assert.doesNotMatch(contextHandler, /onClick=|onPointerDown=/)

  const petView = readFileSync(
    new URL('../src/app/views/PetView.tsx', import.meta.url),
    'utf8',
  )
  assert.match(petView, /<FramelessCompanionSurface[\s\S]*?openPetMenu=\{openPetMenu\}/)
})
