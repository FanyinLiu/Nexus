import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

import {
  BackgroundChatBudgetExhaustedError,
  acquireBackgroundChatLease,
  isBackgroundChatLeaseAvailable,
  releaseBackgroundChatLease,
  resetBackgroundChatPolicyForTests,
  runLockedBackgroundChat,
} from '../src/features/autonomy/backgroundChatPolicy.ts'

beforeEach(() => {
  resetBackgroundChatPolicyForTests()
})

test('a busy background-chat lock does not spend the model budget', async () => {
  const held = acquireBackgroundChatLease()
  assert.ok(held)
  let spent = 0
  let ran = 0

  await assert.rejects(
    () => runLockedBackgroundChat({
      tryConsumeBudget: () => {
        spent += 1
        return true
      },
      run: async () => {
        ran += 1
        return 'skipped'
      },
    }),
    /background chat lease busy/,
  )
  assert.equal(spent, 0)
  assert.equal(ran, 0)
  assert.equal(isBackgroundChatLeaseAvailable(), false)

  assert.equal(releaseBackgroundChatLease(held), true)
  const result = await runLockedBackgroundChat({
    tryConsumeBudget: () => {
      spent += 1
      return true
    },
    run: async () => {
      ran += 1
      return 'ok'
    },
  })

  assert.equal(result, 'ok')
  assert.equal(spent, 1)
  assert.equal(ran, 1)
  assert.equal(isBackgroundChatLeaseAvailable(), true)
})

test('an exhausted budget does not run the call and releases the lock', async () => {
  let ran = 0
  let recorded = 0

  await assert.rejects(
    () => runLockedBackgroundChat({
      tryConsumeBudget: () => false,
      onRunError: () => { recorded += 1 },
      run: async () => {
        ran += 1
        return 'nope'
      },
    }),
    (error: unknown) => error instanceof BackgroundChatBudgetExhaustedError,
  )

  assert.equal(ran, 0)
  assert.equal(recorded, 0)
  assert.equal(isBackgroundChatLeaseAvailable(), true)

  const lease = acquireBackgroundChatLease()
  assert.ok(lease)
  assert.equal(releaseBackgroundChatLease(lease), true)
})

test('a model error is recorded while the lock is still held, then the lock is released', async () => {
  let heldDuringError = false

  await assert.rejects(
    () => runLockedBackgroundChat({
      tryConsumeBudget: () => true,
      onRunError: () => {
        heldDuringError = !isBackgroundChatLeaseAvailable()
      },
      run: async () => {
        throw new Error('provider down')
      },
    }),
    /provider down/,
  )

  assert.equal(heldDuringError, true)
  assert.equal(isBackgroundChatLeaseAvailable(), true)
})
