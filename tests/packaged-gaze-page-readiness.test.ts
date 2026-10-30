import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  APP_DOCUMENT_TIMEOUT_MS,
  FATAL_DOCUMENT_CODE,
  classifyStorageProbe,
  isPetViewUrl,
  isStorageSecurityError,
  selectPetPageTargets,
  shouldRetryEvaluateError,
  waitForAppDocument,
} from '../scripts/lib/packaged-gaze-page-readiness.mjs'

function target(id: string, url: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    type: 'page',
    url,
    webSocketDebuggerUrl: `ws://127.0.0.1:47829/devtools/page/${id}`,
    ...extra,
  }
}

function probe(overrides: Record<string, unknown> = {}) {
  return {
    href: 'http://127.0.0.1:47822/index.html?view=pet',
    readyState: 'complete',
    view: 'pet',
    storage: 'ok',
    errorName: '',
    errorMessage: '',
    ...overrides,
  }
}

test('isPetViewUrl accepts only app documents with the pet view query', () => {
  assert.equal(isPetViewUrl('http://127.0.0.1:47822/index.html?view=pet'), true)
  assert.equal(isPetViewUrl('file:///opt/nexus/dist/index.html?view=pet'), true)
  assert.equal(isPetViewUrl('http://127.0.0.1:47822/index.html?view=panel'), false)
  assert.equal(isPetViewUrl('about:blank'), false)
  assert.equal(isPetViewUrl('http://127.0.0.1:47822/index.html?ref=/view=pet'), false)
  assert.equal(isPetViewUrl(null), false)
})

test('selectPetPageTargets drops non-pet and unattachable targets', () => {
  const pet = target('B', 'http://127.0.0.1:47822/index.html?view=pet')
  const pages = [
    target('A', 'http://127.0.0.1:47822/index.html?view=panel&section=chat'),
    target('C', 'about:blank'),
    target('D', 'http://127.0.0.1:47822/index.html?view=pet', { type: 'service_worker' }),
    target('E', 'http://127.0.0.1:47822/index.html?view=pet', { webSocketDebuggerUrl: '' }),
    pet,
  ]

  assert.deepEqual(selectPetPageTargets(pages), [pet])
})

test('selectPetPageTargets is order independent', () => {
  const early = target('0A', 'http://127.0.0.1:47822/index.html?view=pet')
  const late = target('7F', 'http://127.0.0.1:47822/index.html?view=pet')

  const forward = selectPetPageTargets([late, early]).map((page) => page.id)
  const backward = selectPetPageTargets([early, late]).map((page) => page.id)

  assert.deepEqual(forward, ['0A', '7F'])
  assert.deepEqual(backward, forward)
})

test('classifyStorageProbe accepts a committed pet document', () => {
  assert.equal(classifyStorageProbe(probe()).state, 'ready')
  assert.equal(classifyStorageProbe(probe({ readyState: 'interactive' })).state, 'ready')
})

test('classifyStorageProbe retries the pre-commit storage SecurityError', () => {
  const verdict = classifyStorageProbe(probe({
    href: 'about:blank',
    view: '',
    readyState: 'complete',
    storage: 'error',
    errorName: 'SecurityError',
    errorMessage: "Failed to read the 'localStorage' property from 'Window': Access is denied for this document.",
  }))

  assert.equal(verdict.state, 'retry')
  assert.match(verdict.reason, /SecurityError/)
})

test('classifyStorageProbe retries while the app document is still parsing', () => {
  assert.equal(classifyStorageProbe(probe({ readyState: 'loading' })).state, 'retry')
  assert.equal(classifyStorageProbe(null).state, 'retry')
})

test('classifyStorageProbe retries while the renderer is on about:blank', () => {
  assert.equal(classifyStorageProbe(probe({ href: 'about:blank', view: '' })).state, 'retry')
})

test('classifyStorageProbe fails fast on a non-SecurityError storage failure', () => {
  const verdict = classifyStorageProbe(probe({
    storage: 'error',
    errorName: 'QuotaExceededError',
    errorMessage: 'The quota has been exceeded.',
  }))

  assert.equal(verdict.state, 'fatal')
  assert.match(verdict.reason, /QuotaExceededError/)
})

test('classifyStorageProbe fails fast when attached to the wrong renderer view', () => {
  const verdict = classifyStorageProbe(probe({ href: 'http://127.0.0.1:47822/index.html?view=panel', view: 'panel' }))

  assert.equal(verdict.state, 'fatal')
  assert.match(verdict.reason, /wrong renderer view/)
})

test('shouldRetryEvaluateError only tolerates navigation churn', () => {
  assert.equal(shouldRetryEvaluateError('Execution context was destroyed.'), true)
  assert.equal(shouldRetryEvaluateError('Cannot find context with specified id'), true)
  assert.equal(shouldRetryEvaluateError('Target closed'), true)
  assert.equal(shouldRetryEvaluateError("SecurityError: Failed to read the 'localStorage' property from 'Window'"), false)
  assert.equal(shouldRetryEvaluateError('timeout Runtime.evaluate'), false)
  assert.equal(shouldRetryEvaluateError(undefined), false)
})

test('isStorageSecurityError matches only the opaque-document storage denial', () => {
  assert.equal(isStorageSecurityError(
    "SecurityError: Failed to read the 'localStorage' property from 'Window': Access is denied for this document.",
  ), true)
  assert.equal(isStorageSecurityError(
    "SecurityError: Failed to read the 'sessionStorage' property from 'Window': Access is denied for this document.",
  ), true)
  assert.equal(isStorageSecurityError('QuotaExceededError: The quota has been exceeded.'), false)
  assert.equal(isStorageSecurityError('SecurityError: Blocked a frame with origin'), false)
  assert.equal(isStorageSecurityError(undefined), false)
})

const preCommitProbe = probe({
  href: 'about:blank',
  view: '',
  readyState: 'complete',
  storage: 'error',
  errorName: 'SecurityError',
  errorMessage: "Failed to read the 'localStorage' property from 'Window': Access is denied for this document.",
})

function fakeClock(pollMs: number) {
  const clock = { time: 0 }
  return {
    clock,
    now: () => clock.time,
    sleep: async (ms: number) => { clock.time += ms },
    pollMs,
  }
}

test('waitForAppDocument retries the pre-commit SecurityError until the document commits', async () => {
  const results = [preCommitProbe, preCommitProbe, probe()]
  const clock = fakeClock(200)

  const verdict = await waitForAppDocument({
    evaluate: async () => results.shift(),
    now: clock.now,
    sleep: clock.sleep,
    pollMs: clock.pollMs,
  })

  assert.equal(verdict.state, 'ready')
  assert.equal(results.length, 0)
})

test('waitForAppDocument retries execution-context churn', async () => {
  let call = 0
  const clock = fakeClock(200)

  const verdict = await waitForAppDocument({
    evaluate: async () => {
      call += 1
      if (call === 1) throw new Error('Execution context was destroyed.')
      return probe()
    },
    now: clock.now,
    sleep: clock.sleep,
    pollMs: clock.pollMs,
  })

  assert.equal(verdict.state, 'ready')
  assert.equal(call, 2)
})

test('waitForAppDocument fails with the last reason when storage never becomes readable', async () => {
  const clock = fakeClock(200)

  await assert.rejects(
    waitForAppDocument({
      evaluate: async () => preCommitProbe,
      now: clock.now,
      sleep: clock.sleep,
      pollMs: clock.pollMs,
    }),
    (error: Error) => {
      assert.match(error.message, new RegExp(`within ${APP_DOCUMENT_TIMEOUT_MS}ms`))
      assert.match(error.message, /SecurityError/)
      return true
    },
  )
})

test('waitForAppDocument can require the reloaded document to run the seed', async () => {
  const results = [probe({ seeded: false }), probe({ seeded: false }), probe({ seeded: true })]
  const clock = fakeClock(200)

  const verdict = await waitForAppDocument({
    evaluate: async () => results.shift(),
    requireSeeded: true,
    now: clock.now,
    sleep: clock.sleep,
    pollMs: clock.pollMs,
  })

  assert.equal(verdict.state, 'ready')
  assert.equal(results.length, 0)
})

test('waitForAppDocument reports when the seed never lands in the reloaded document', async () => {
  const clock = fakeClock(200)

  await assert.rejects(
    waitForAppDocument({
      evaluate: async () => probe({ seeded: false }),
      requireSeeded: true,
      now: clock.now,
      sleep: clock.sleep,
      pollMs: clock.pollMs,
    }),
    /to run the smoke seed/,
  )
})

test('waitForAppDocument fails fast on a broken app document', async () => {
  let calls = 0
  const clock = fakeClock(200)

  await assert.rejects(
    waitForAppDocument({
      evaluate: async () => {
        calls += 1
        return probe({ storage: 'error', errorName: 'QuotaExceededError', errorMessage: 'The quota has been exceeded.' })
      },
      now: clock.now,
      sleep: clock.sleep,
      pollMs: clock.pollMs,
    }),
    (error: Error & { code?: string }) => {
      assert.equal(error.code, FATAL_DOCUMENT_CODE)
      return true
    },
  )
  assert.equal(calls, 1)
})

test('waitForAppDocument fails fast on a non-navigation evaluate error', async () => {
  let calls = 0
  const clock = fakeClock(200)

  await assert.rejects(
    waitForAppDocument({
      evaluate: async () => {
        calls += 1
        throw new Error('timeout Runtime.evaluate')
      },
      now: clock.now,
      sleep: clock.sleep,
      pollMs: clock.pollMs,
    }),
    (error: Error & { code?: string }) => {
      assert.equal(error.code, FATAL_DOCUMENT_CODE)
      assert.match(error.message, /not scriptable/)
      return true
    },
  )
  assert.equal(calls, 1)
})
