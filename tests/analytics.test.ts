import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

import { getAnalyticsConsent, setAnalyticsConsent } from '../src/features/analytics/consent.ts'
import { resetAnalyticsSession } from '../src/features/analytics/session.ts'
import { createTracker, trackWithConsent } from '../src/features/analytics/tracker.ts'
import type { AnalyticsEvent } from '../src/types/analytics.ts'

const ANALYTICS_CONSENT_STORAGE_KEY = 'nexus:analytics:consent'

class MemoryStorage {
  private data = new Map<string, string>()

  getItem(key: string) {
    return this.data.has(key) ? this.data.get(key)! : null
  }

  setItem(key: string, value: string) {
    this.data.set(key, String(value))
  }

  removeItem(key: string) {
    this.data.delete(key)
  }

  clear() {
    this.data.clear()
  }
}

beforeEach(() => {
  resetAnalyticsSession()
  Object.defineProperty(globalThis, 'window', {
    value: { localStorage: new MemoryStorage() },
    configurable: true,
    writable: true,
  })
})

test('createTracker sends a session-stamped event to every sink and isolates failures', async () => {
  const received: AnalyticsEvent[] = []
  const tracker = createTracker([
    async (event) => {
      received.push(event)
    },
    async () => {
      throw new Error('sink failed')
    },
  ])

  await tracker('app.bootstrap', { mode: 'test' })

  assert.equal(received.length, 1)
  assert.equal(received[0].name, 'app.bootstrap')
  assert.deepEqual(received[0].payload, { mode: 'test' })
  assert.match(received[0].timestamp, /^\d{4}-\d{2}-\d{2}T/)
  assert.ok(received[0].sessionId.length > 0)
})

test('analytics consent is best-effort and survives unavailable storage', () => {
  setAnalyticsConsent(true)
  assert.equal(window.localStorage.getItem(ANALYTICS_CONSENT_STORAGE_KEY), 'granted')
  assert.equal(getAnalyticsConsent(), true)

  setAnalyticsConsent(false)
  assert.equal(window.localStorage.getItem(ANALYTICS_CONSENT_STORAGE_KEY), null)
  assert.equal(getAnalyticsConsent(), false)

  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage: {
        getItem() {
          throw new Error('blocked')
        },
        setItem() {
          throw new Error('blocked')
        },
        removeItem() {
          throw new Error('blocked')
        },
      },
    },
    configurable: true,
    writable: true,
  })

  assert.equal(getAnalyticsConsent(), false)
  assert.doesNotThrow(() => setAnalyticsConsent(true))
  assert.doesNotThrow(() => setAnalyticsConsent(false))
})

test('trackWithConsent does not emit analytics before consent', async () => {
  const debugCalls: unknown[][] = []
  const originalDebug = console.debug
  console.debug = (...args: unknown[]) => {
    debugCalls.push(args)
  }

  try {
    await trackWithConsent('app.bootstrap', { source: 'initApp' })
  } finally {
    console.debug = originalDebug
  }

  assert.equal(
    debugCalls.some((args) => args[0] === '[analytics]' && args[1] === 'app.bootstrap'),
    false,
  )
})
