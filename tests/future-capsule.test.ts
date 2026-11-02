import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildFutureCapsuleDelivery,
  daysBetween,
} from '../src/features/futureCapsule/futureCapsuleDelivery.ts'
import { ensureLocaleLoaded } from '../src/i18n/runtime.ts'
import {
  enqueueFutureCapsule,
  loadFutureCapsules,
} from '../src/features/futureCapsule/futureCapsuleStore.ts'
import { FUTURE_CAPSULE_STORE_STORAGE_KEY } from '../src/lib/storage/core.ts'

function createLocalStorageMock(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, String(value)) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => { store.clear() },
  }
}

function installStorage(initial: Record<string, string> = {}) {
  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage: createLocalStorageMock(initial),
    },
    configurable: true,
    writable: true,
  })
}

// ── daysBetween ──────────────────────────────────────────────────────────

test('daysBetween: future timestamp returns 0', () => {
  const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  assert.equal(daysBetween(future, new Date()), 0)
})

test('daysBetween: same instant returns 0', () => {
  const now = new Date()
  assert.equal(daysBetween(now.toISOString(), now), 0)
})

test('daysBetween: ~30 days ago returns 30', () => {
  const now = new Date('2026-04-30T12:00:00Z')
  const earlier = new Date('2026-03-31T12:00:00Z').toISOString()
  assert.equal(daysBetween(earlier, now), 30)
})

test('daysBetween: less than a day rounds up to 1 (so the body never says "0 days")', () => {
  const now = new Date()
  const earlier = new Date(now.getTime() - 60 * 60 * 1000).toISOString()  // 1h ago
  assert.equal(daysBetween(earlier, now), 1)
})

test('daysBetween: malformed ISO returns 0', () => {
  assert.equal(daysBetween('not-an-iso', new Date()), 0)
})

// ── buildFutureCapsuleDelivery ───────────────────────────────────────────

const baseCapsule = {
  id: 'x',
  message: 'hi',
  createdAt: '2026-03-31T12:00:00Z',
  scheduledFor: '2026-04-30',
  status: 'pending' as const,
}

test('buildFutureCapsuleDelivery: zh-CN opener counts the days and keeps the letter out of it', async () => {
  await ensureLocaleLoaded('zh-CN')
  const result = buildFutureCapsuleDelivery({
    uiLanguage: 'zh-CN',
    capsule: { ...baseCapsule, message: '记得善待自己' },
    now: new Date('2026-04-30T12:00:00Z'),
  })
  assert.equal(result.opener, '你30 天前写给今天的信，到了。')
  assert.equal(result.header, '给今天的你')
  assert.equal(result.letterBody, '记得善待自己')
  assert.equal(result.writtenAt, '2026-03-31T12:00:00.000Z')
  assert.doesNotMatch(result.opener, /记得善待自己/, 'the opener never carries the letter')
})

test('buildFutureCapsuleDelivery: a title becomes the card header, not the notification title', async () => {
  await ensureLocaleLoaded('en-US')
  const now = new Date('2026-04-30T12:00:00Z')
  const untitled = buildFutureCapsuleDelivery({
    uiLanguage: 'en-US',
    capsule: baseCapsule,
    now,
  })
  const titled = buildFutureCapsuleDelivery({
    uiLanguage: 'en-US',
    capsule: { ...baseCapsule, title: '  after the album  ' },
    now,
  })
  assert.equal(untitled.header, 'To you, today')
  assert.equal(titled.header, 'after the album')
  assert.equal(untitled.notificationTitle, titled.notificationTitle)
  assert.equal(titled.notificationTitle, 'A note from your past self')
})

test('buildFutureCapsuleDelivery: the letter body is verbatim, never trimmed or quoted', async () => {
  await ensureLocaleLoaded('en-US')
  const original = `line one\n\n${'y'.repeat(300)} end`
  const result = buildFutureCapsuleDelivery({
    uiLanguage: 'en-US',
    capsule: { ...baseCapsule, message: original },
    now: new Date('2026-04-30T12:00:00Z'),
  })
  assert.equal(result.letterBody, original)
  assert.ok(result.letterBody.includes('\n\n'), 'the letter keeps its authored line breaks')
})

test('buildFutureCapsuleDelivery: the opener never names the companion', async () => {
  await ensureLocaleLoaded('en-US')
  const result = buildFutureCapsuleDelivery({
    uiLanguage: 'en-US',
    capsule: baseCapsule,
    now: new Date('2026-04-30T12:00:00Z'),
  })
  assert.doesNotMatch(result.opener, /Nexus|Companion/)
  assert.match(result.opener, /The letter you wrote .* for today is here\./)
})

test('buildFutureCapsuleDelivery: each of the 5 locales returns a non-empty distinct opener', async () => {
  const locales = ['en-US', 'zh-CN', 'zh-TW', 'ja', 'ko'] as const
  const openers = []
  for (const locale of locales) {
    await ensureLocaleLoaded(locale)
    openers.push(buildFutureCapsuleDelivery({
      uiLanguage: locale,
      capsule: baseCapsule,
      now: new Date('2026-04-30T12:00:00Z'),
    }).opener)
  }
  for (const opener of openers) {
    assert.ok(opener.length > 0, 'expected non-empty opener')
  }
  assert.equal(new Set(openers).size, locales.length, 'each locale should produce a distinct copy')
})

test('buildFutureCapsuleDelivery: returns the unchanged routing title', async () => {
  await ensureLocaleLoaded('zh-CN')
  const result = buildFutureCapsuleDelivery({
    uiLanguage: 'zh-CN',
    capsule: baseCapsule,
    now: new Date('2026-04-30T12:00:00Z'),
  })
  assert.equal(result.notificationTitle, '过去的你给现在的你')
})

// ── future capsule store ────────────────────────────────────────────────────

test('loadFutureCapsules compacts malformed stored capsules and trims text fields', () => {
  installStorage()
  const live = {
    id: 'capsule-live',
    message: '  remember this  ',
    createdAt: '2026-04-01T00:00:00.000Z',
    scheduledFor: '2026-06-04',
    status: 'pending',
    title: '  launch week  ',
  }
  window.localStorage.setItem(FUTURE_CAPSULE_STORE_STORAGE_KEY, JSON.stringify([
    live,
    { ...live, id: 'bad-date', scheduledFor: '2026-13-99' },
    { ...live, id: 'bad-created', createdAt: 'not-a-date' },
    { ...live, id: 'blank-message', message: '   ' },
    { ...live, id: 'bad-status', status: 'queued' },
  ]))

  const capsules = loadFutureCapsules()

  assert.deepEqual(capsules, [{
    id: 'capsule-live',
    message: 'remember this',
    createdAt: '2026-04-01T00:00:00.000Z',
    scheduledFor: '2026-06-04',
    status: 'pending',
    title: 'launch week',
  }])
  assert.deepEqual(
    JSON.parse(window.localStorage.getItem(FUTURE_CAPSULE_STORE_STORAGE_KEY) ?? '[]'),
    capsules,
  )
})

test('enqueueFutureCapsule rejects invalid calendar dates', () => {
  installStorage()

  assert.equal(enqueueFutureCapsule({
    message: 'invalid month',
    scheduledFor: '2026-13-01',
  }), null)
  assert.equal(enqueueFutureCapsule({
    message: 'invalid day',
    scheduledFor: '2026-02-30',
  }), null)
  assert.equal(loadFutureCapsules().length, 0)
})
