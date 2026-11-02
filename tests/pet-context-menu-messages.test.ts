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
import { companionStageGestures } from '../src/features/uiV2/companionStageGestures.ts'

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
    'zh-CN': '小本子',
    'zh-TW': '小本子',
    'en-US': 'Notebook',
    ja: 'メモ帳',
    ko: '수첩',
  }

  assert.deepEqual([...MAIN_MESSAGE_LOCALES], Object.keys(expected))
  for (const locale of MAIN_MESSAGE_LOCALES) {
    assert.equal(MAIN_MESSAGES[locale]['menu.messages'], expected[locale], locale)
  }
})

test('the pet menu template puts Notebook first and keeps the other items', () => {
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
  assert.equal(template[0].label, 'Notebook')
  assert.equal(template[1].label, mainT('menu.chat'))
  assert.equal(template[2].label, mainT('menu.settings'))
  assert.equal(template[4].type, 'separator')

  ;(template[0].click as (() => void) | undefined)?.()
  assert.deepEqual(calls, ['messages'])
})

test('choosing Notebook resolves the menu promise to messages', async () => {
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

async function flushAsync(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

test('a left click or double click without a visible note never opens the inbox overlay', async () => {
  let overlayOpens = 0
  let menuCalls = 0
  const pointerDowns: number[] = []
  let doubleClicks = 0

  // The real renderer callback wired to a fake native menu that picked Messages.
  const openPetMenu = createPetMenuOpenHandler({
    openPetMenu: async () => {
      menuCalls += 1
      return 'messages'
    },
    openInboxOverlay: () => {
      overlayOpens += 1
    },
  })

  companionStageGestures.pointerDown({ button: 0 }, (event) => {
    pointerDowns.push(event.button)
  })
  companionStageGestures.doubleClick(() => {
    doubleClicks += 1
  })
  await flushAsync()

  assert.deepEqual(pointerDowns, [0])
  assert.equal(doubleClicks, 1)
  assert.equal(menuCalls, 0)
  assert.equal(overlayOpens, 0)

  let prevented = 0
  companionStageGestures.contextMenu(
    {
      preventDefault: () => {
        prevented += 1
      },
    },
    () => {
      void openPetMenu()
    },
  )
  assert.equal(prevented, 1)
  assert.equal(menuCalls, 1)
  await flushAsync()
  assert.equal(overlayOpens, 1)

  // A dismissed native menu resolves null and must not open the overlay.
  let nullOverlayOpens = 0
  const dismissedMenu = createPetMenuOpenHandler({
    openPetMenu: async () => null,
    openInboxOverlay: () => {
      nullOverlayOpens += 1
    },
  })
  companionStageGestures.contextMenu({ preventDefault: () => {} }, () => {
    void dismissedMenu()
  })
  await flushAsync()
  assert.equal(nullOverlayOpens, 0)
})

test('the companion surface wires its stage gestures through the gesture module', () => {
  const surface = readFileSync(
    new URL('../src/features/uiV2/FramelessCompanionSurface.tsx', import.meta.url),
    'utf8',
  )
  const stage = surface.match(/className="nexus-companion-v2__character-hit[\s\S]*?\n {6}>/)?.[0]
  assert.ok(stage, 'character stage element must exist')

  assert.match(
    stage,
    /onPointerDown=\{\(event\) => companionStageGestures\.pointerDown\(event, handleCharacterPointerDown\)\}/,
  )
  assert.match(stage, /onClick=\{handleCharacterClick\}/)
  assert.match(
    stage,
    /onContextMenu=\{\(event\) => companionStageGestures\.contextMenu\(event, openPetMenu\)\}/,
  )
  assert.match(
    stage,
    /onDoubleClick=\{\(\) => companionStageGestures\.doubleClick\(\s*voice\.toggleVoiceConversation,\s*singleClickGateRef\.current/,
  )
  // The three inline gesture props route through the module; the click
  // handler does the same and is asserted in the gesture test.
  assert.equal(
    (stage.match(/companionStageGestures\.(pointerDown|contextMenu|doubleClick)\(/g) ?? []).length,
    3,
  )
  // `openPetMenu` reaches JSX only as the context-menu argument.
  assert.equal((stage.match(/openPetMenu/g) ?? []).length, 1)

  const petView = readFileSync(
    new URL('../src/app/views/PetView.tsx', import.meta.url),
    'utf8',
  )
  assert.match(petView, /<FramelessCompanionSurface[\s\S]*?openPetMenu=\{openPetMenu\}/)
})
