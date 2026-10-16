import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  nextGuideDeferral,
  normalizeGuideDeferral,
  resolveGuideLaunch,
  withGuideReshown,
} from '../src/features/onboarding/guideDeferral.ts'
import {
  loadGuideDeferral,
  loadOnboardingCompleted,
  markGuideReshown,
  markOnboardingInProgress,
  recordGuideDismiss,
} from '../src/lib/storage/onboarding.ts'
import { ONBOARDING_STORAGE_KEY, SETTINGS_STORAGE_KEY } from '../src/lib/storage/core.ts'

const FIRST = '2026-10-16T00:00:00.000Z'
const LATER = '2026-10-17T00:00:00.000Z'

function installStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  const localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, String(value)) },
    removeItem: (key: string) => { store.delete(key) },
  }
  Object.defineProperty(globalThis, 'window', {
    value: { localStorage },
    configurable: true,
    writable: true,
  })
  return localStorage
}

test('a fresh profile still opens the guide', () => {
  assert.deepEqual(resolveGuideLaunch({ completed: false, deferral: null }), {
    show: true,
    consumeReshow: false,
  })
})

test('maybe later leaves one later showing, then stops', () => {
  const once = nextGuideDeferral(null, FIRST)
  assert.deepEqual(resolveGuideLaunch({ completed: false, deferral: once }), {
    show: true,
    consumeReshow: true,
  })
  const reshown = withGuideReshown(once, LATER)
  assert.deepEqual(resolveGuideLaunch({ completed: false, deferral: reshown }), {
    show: false,
    consumeReshow: false,
  })
  const dismissedAgain = nextGuideDeferral(once, LATER)
  assert.equal(dismissedAgain.dismissCount, 2)
  assert.deepEqual(resolveGuideLaunch({ completed: false, deferral: dismissedAgain }), {
    show: false,
    consumeReshow: false,
  })
})

test('finished setup does not auto-open, even with a dismissal', () => {
  assert.deepEqual(resolveGuideLaunch({
    completed: true,
    deferral: nextGuideDeferral(null, FIRST),
  }), { show: false, consumeReshow: false })
})

test('dismissal is stored without looking like a finished setup', () => {
  const storage = installStorage()
  const saved = recordGuideDismiss(new Date(FIRST))
  assert.equal(saved?.dismissCount, 1)
  assert.equal(loadOnboardingCompleted(), false)
  assert.equal(JSON.parse(storage.getItem(ONBOARDING_STORAGE_KEY) ?? '{}').completedAt, undefined)

  markGuideReshown(new Date(LATER))
  assert.equal(loadGuideDeferral()?.reshownAt, LATER)
  assert.equal(loadOnboardingCompleted(), false)

  recordGuideDismiss(new Date(LATER))
  assert.equal(loadGuideDeferral()?.dismissCount, 2)
  assert.equal(normalizeGuideDeferral(JSON.parse(storage.getItem(ONBOARDING_STORAGE_KEY) ?? '{}'))?.dismissCount, 2)
})

test('a language save still leaves one later showing', () => {
  const storage = installStorage()
  markOnboardingInProgress()
  storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ uiLanguage: 'en-US' }))

  const saved = recordGuideDismiss(new Date(FIRST))
  assert.equal(saved?.dismissCount, 1)
  assert.equal(loadOnboardingCompleted(), false)
  const stored = JSON.parse(storage.getItem(ONBOARDING_STORAGE_KEY) ?? '{}')
  assert.equal(stored.status, 'in-progress')
  assert.equal(stored.guideDismissCount, 1)
  assert.equal(stored.completedAt, undefined)

  assert.deepEqual(resolveGuideLaunch({
    completed: loadOnboardingCompleted(),
    deferral: loadGuideDeferral(),
  }), { show: true, consumeReshow: true })

  markGuideReshown(new Date(LATER))
  const afterReshow = JSON.parse(storage.getItem(ONBOARDING_STORAGE_KEY) ?? '{}')
  assert.equal(afterReshow.status, 'in-progress')
  assert.equal(afterReshow.guideReshownAt, LATER)
  assert.deepEqual(resolveGuideLaunch({
    completed: loadOnboardingCompleted(),
    deferral: loadGuideDeferral(),
  }), { show: false, consumeReshow: false })

  recordGuideDismiss(new Date(LATER))
  const afterSecondDismiss = JSON.parse(storage.getItem(ONBOARDING_STORAGE_KEY) ?? '{}')
  assert.equal(afterSecondDismiss.status, 'in-progress')
  assert.equal(afterSecondDismiss.guideDismissCount, 2)
  assert.equal(loadOnboardingCompleted(), false)
  assert.deepEqual(resolveGuideLaunch({
    completed: loadOnboardingCompleted(),
    deferral: loadGuideDeferral(),
  }), { show: false, consumeReshow: false })
})

test('a later dismissal does not erase a finished setup', () => {
  const storage = installStorage({
    [ONBOARDING_STORAGE_KEY]: JSON.stringify({ completedAt: FIRST }),
  })
  recordGuideDismiss(new Date(LATER))
  assert.deepEqual(JSON.parse(storage.getItem(ONBOARDING_STORAGE_KEY) ?? '{}'), {
    completedAt: FIRST,
  })
  assert.equal(loadOnboardingCompleted(), true)
})
