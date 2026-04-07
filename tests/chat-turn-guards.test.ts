import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

import { bindStreamingAbort } from '../src/hooks/chat/streamAbort.ts'
import { shouldIgnoreAssistantTurnResult } from '../src/hooks/chat/turnGuards.ts'

beforeEach(() => {
  const store = new Map<string, string>()

  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
        removeItem: (key: string) => store.delete(key),
        clear: () => store.clear(),
      },
    },
    configurable: true,
    writable: true,
  })
})

test('ignores a late assistant turn when a newer turn is active', () => {
  const activeTurnIdRef = { current: 2 }

  assert.equal(shouldIgnoreAssistantTurnResult(activeTurnIdRef, 1), true)
  assert.equal(shouldIgnoreAssistantTurnResult(activeTurnIdRef, 2), false)
})

test('bindStreamingAbort registers abort and clears it after resolve', async () => {
  let activeAbort: (() => Promise<void>) | null | undefined
  let resolveRequest: ((value: string) => void) | null = null
  let aborted = false

  const request = new Promise<string>((resolve) => {
    resolveRequest = resolve
  }) as Promise<string> & { abort: () => Promise<void> }

  request.abort = async () => {
    aborted = true
  }

  const trackedRequest = bindStreamingAbort(request, (abort) => {
    activeAbort = abort
  })

  assert.equal(typeof activeAbort, 'function')
  await activeAbort?.()
  assert.equal(aborted, true)

  resolveRequest?.('ok')
  assert.equal(await trackedRequest, 'ok')
  assert.equal(activeAbort, null)
})

test('bindStreamingAbort clears abort on rejection', async () => {
  let activeAbort: (() => Promise<void>) | null | undefined
  let rejectRequest: ((error: Error) => void) | null = null

  const request = new Promise<string>((_resolve, reject) => {
    rejectRequest = reject
  }) as Promise<string> & { abort: () => Promise<void> }

  request.abort = async () => undefined

  const trackedRequest = bindStreamingAbort(request, (abort) => {
    activeAbort = abort
  })

  rejectRequest?.(new Error('stopped'))

  await assert.rejects(trackedRequest, { message: 'stopped' })
  assert.equal(activeAbort, null)
})
