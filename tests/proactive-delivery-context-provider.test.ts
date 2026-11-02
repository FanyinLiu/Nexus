import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createProactiveDeliveryContextProvider } from '../electron/services/proactiveDeliveryContext.js'
import type {
  FocusState,
  ProactiveDeliveryPreferences,
} from '../shared/proactiveDelivery.js'

function atLocal(hour: number, minute = 0): number {
  return new Date(2026, 0, 1, hour, minute, 0, 0).getTime()
}

function preferences(overrides: Partial<ProactiveDeliveryPreferences> = {}): ProactiveDeliveryPreferences {
  return {
    quietStart: 23,
    quietEnd: 8,
    desktopAwarenessAllowed: true,
    awayNotificationsEnabled: false,
    ...overrides,
  }
}

function createProvider(options: {
  preferences?: ProactiveDeliveryPreferences | null
  nowMs?: number
  panelFocused?: boolean
  focusState?: FocusState
  activeWindow?: { title?: string | null; appName?: string | null } | null
  onActiveWindowRead?: () => void
}) {
  return createProactiveDeliveryContextProvider({
    isPanelFocused: () => options.panelFocused === true,
    getFocusState: () => options.focusState ?? 'active',
    getActiveWindow: async () => {
      options.onActiveWindowRead?.()
      return options.activeWindow ?? null
    },
    getPreferences: () => options.preferences ?? null,
    now: () => options.nowMs ?? atLocal(12),
  })
}

test('a fullscreen-looking active window only counts when desktop awareness is allowed', async () => {
  let reads = 0
  const allowed = createProvider({
    preferences: preferences({ desktopAwarenessAllowed: true }),
    activeWindow: { title: 'YouTube — Fullscreen', appName: 'Safari' },
    onActiveWindowRead: () => { reads += 1 },
  })
  const allowedContext = await allowed.getDeliveryContext()
  assert.equal(allowedContext.fullscreen, true)
  assert.equal(reads, 1)

  reads = 0
  const disallowed = createProvider({
    preferences: preferences({ desktopAwarenessAllowed: false }),
    activeWindow: { title: 'YouTube — Fullscreen', appName: 'Safari' },
    onActiveWindowRead: () => { reads += 1 },
  })
  const disallowedContext = await disallowed.getDeliveryContext()
  assert.equal(disallowedContext.fullscreen, false)
  assert.equal(reads, 0)
})

test('quiet hours wrap past midnight and equal bounds turn the window off', async () => {
  const wrap = createProvider({
    preferences: preferences({ quietStart: 23, quietEnd: 8 }),
    nowMs: atLocal(23, 30),
  })
  assert.equal((await wrap.getDeliveryContext()).inQuietHours, true)

  const beforeDawn = createProvider({
    preferences: preferences({ quietStart: 23, quietEnd: 8 }),
    nowMs: atLocal(7, 59),
  })
  assert.equal((await beforeDawn.getDeliveryContext()).inQuietHours, true)

  const afterWindow = createProvider({
    preferences: preferences({ quietStart: 23, quietEnd: 8 }),
    nowMs: atLocal(8, 0),
  })
  assert.equal((await afterWindow.getDeliveryContext()).inQuietHours, false)

  const dayWindow = createProvider({
    preferences: preferences({ quietStart: 9, quietEnd: 17 }),
    nowMs: atLocal(12),
  })
  assert.equal((await dayWindow.getDeliveryContext()).inQuietHours, true)

  const disabled = createProvider({
    preferences: preferences({ quietStart: 9, quietEnd: 9 }),
    nowMs: atLocal(9),
  })
  assert.equal((await disabled.getDeliveryContext()).inQuietHours, false)
})

test('panel focus, focus state and away notifications pass through', async () => {
  const provider = createProvider({
    preferences: preferences({ awayNotificationsEnabled: true }),
    panelFocused: true,
    focusState: 'idle',
  })

  const context = await provider.getDeliveryContext()
  assert.equal(context.panelFocused, true)
  assert.equal(context.focusState, 'idle')
  assert.equal(context.awayNotificationsEnabled, true)
  assert.equal(context.systemDnd, null)
  assert.equal(context.stripEnabled, true)
})

test('no preferences mean no quiet hours, no fullscreen and no away notifications', async () => {
  let reads = 0
  const provider = createProvider({
    preferences: null,
    activeWindow: { title: 'Fullscreen Player', appName: 'Game' },
    onActiveWindowRead: () => { reads += 1 },
  })

  const context = await provider.getDeliveryContext()
  assert.equal(context.inQuietHours, false)
  assert.equal(context.fullscreen, false)
  assert.equal(context.awayNotificationsEnabled, false)
  assert.equal(reads, 0)
})
