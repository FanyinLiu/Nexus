import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { beforeEach, mock, test } from 'node:test'

import { bindStreamingAbort } from '../src/hooks/chat/streamAbort.ts'
import {
  releaseChatSubmission,
  shouldClearSubmittedInput,
  tryAcquireChatSubmission,
} from '../src/hooks/chat/submissionGuard.ts'
import { cancelActiveTurn, executeAssistantTurn } from '../src/hooks/chat/turnExecution.ts'
import { shouldIgnoreAssistantTurnResult } from '../src/hooks/chat/turnGuards.ts'
import { t } from '../src/i18n/runtime.ts'

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
      // Delegate at call time so node:test mock timers can intercept these.
      setTimeout: (handler: () => void, ms?: number) => globalThis.setTimeout(handler, ms),
      clearTimeout: (id: number) => globalThis.clearTimeout(id),
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
  let activeAbort: (() => Promise<void>) | null = null
  let resolveRequest: ((value: string) => void) | null = null
  let aborted = false

  // Setter that supports both direct values and updater functions
  // (mirrors the real implementation in useChat.ts)
  const setAbort: import('../src/hooks/chat/streamAbort.ts').AbortSetter = (abortOrUpdater) => {
    if (typeof abortOrUpdater === 'function' && abortOrUpdater.length > 0) {
      activeAbort = (abortOrUpdater as (c: (() => Promise<void>) | null) => (() => Promise<void>) | null)(activeAbort)
    } else {
      activeAbort = abortOrUpdater as (() => Promise<void>) | null
    }
  }

  const request = new Promise<string>((resolve) => {
    resolveRequest = resolve
  }) as Promise<string> & { abort: () => Promise<void> }

  request.abort = async () => {
    aborted = true
  }

  const trackedRequest = bindStreamingAbort(request, setAbort)

  assert.equal(typeof activeAbort, 'function')
  await activeAbort?.()
  assert.equal(aborted, true)

  resolveRequest?.('ok')
  assert.equal(await trackedRequest, 'ok')
  assert.equal(activeAbort, null)
})

test('bindStreamingAbort clears abort on rejection', async () => {
  let activeAbort: (() => Promise<void>) | null = null
  let rejectRequest: ((error: Error) => void) | null = null

  const setAbort: import('../src/hooks/chat/streamAbort.ts').AbortSetter = (abortOrUpdater) => {
    if (typeof abortOrUpdater === 'function' && abortOrUpdater.length > 0) {
      activeAbort = (abortOrUpdater as (c: (() => Promise<void>) | null) => (() => Promise<void>) | null)(activeAbort)
    } else {
      activeAbort = abortOrUpdater as (() => Promise<void>) | null
    }
  }

  const request = new Promise<string>((_resolve, reject) => {
    rejectRequest = reject
  }) as Promise<string> & { abort: () => Promise<void> }

  request.abort = async () => undefined

  const trackedRequest = bindStreamingAbort(request, setAbort)

  rejectRequest?.(new Error('stopped'))

  await assert.rejects(trackedRequest, { message: 'stopped' })
  assert.equal(activeAbort, null)
})

test('cancelActiveTurn invalidates the turn before invoking the active stream abort', async () => {
  let aborted = false
  let busyState = true
  let activity: 'thinking' | 'idle' = 'thinking'
  let cleanupCount = 0
  const activeTurnIdRef = { current: 9 }
  const activeStreamAbortRef: { current: (() => Promise<void>) | null } = {
    current: async () => {
      aborted = true
    },
  }
  const busyRef = { current: true }

  assert.equal(cancelActiveTurn({
    activeTurnIdRef,
    activeStreamAbortRef,
    busyRef,
    setBusy: (value) => { busyState = value },
    setAssistantActivity: (value) => { activity = value },
    onCancel: () => { cleanupCount += 1 },
  }), true)

  assert.equal(activeTurnIdRef.current, 10)
  assert.equal(activeStreamAbortRef.current, null)
  assert.equal(busyRef.current, false)
  assert.equal(busyState, false)
  assert.equal(activity, 'idle')
  assert.equal(cleanupCount, 1)
  await Promise.resolve()
  assert.equal(aborted, true)
  assert.equal(shouldIgnoreAssistantTurnResult(activeTurnIdRef, 9), true)
})

test('hard timeout invalidates the turnId so a tool-phase abort stays silent and issues no follow-up', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const activeTurnIdRef = { current: 0 }
    const activeStreamAbortRef: { current: (() => Promise<void>) | null } = { current: null }
    const busyRef = { current: false }
    const voiceStateRef = { current: 'idle' as string }
    let busyState = false
    let abortCalls = 0
    const errors: Array<string | null> = []
    const busEventTypes: string[] = []
    const followUpRequests: string[] = []
    const appendedFailureMessages: string[] = []

    // Rejects the in-flight tool call, mirroring what a transport abort does
    // to a turn that is stuck in the tool-execution phase.
    let rejectToolCall: (error: Error) => void = () => undefined

    const ctx = {
      appendVoiceTrace: () => undefined,
      busEmit: (event: { type: string }) => { busEventTypes.push(event.type) },
      clearPetPerformanceCue: () => undefined,
      setLiveTranscript: () => undefined,
      setMood: () => undefined,
      setVoiceState: (state: string) => { voiceStateRef.current = state },
      updatePetStatus: () => undefined,
      updateVoicePipeline: () => undefined,
      voiceStateRef,
    }

    const resultPromise = executeAssistantTurn(
      {
        ctx,
        setBusy: (value) => { busyState = value },
        setError: (value) => { errors.push(value) },
        busyRef,
        activeTurnIdRef,
        activeStreamAbortRef,
        runAssistantReplyTurn: async ({ isLatestTurn }) => {
          // Tool-execution phase: register the stream abort the way the real
          // runner does via bindStreamingAbort, then hang on the tool call.
          activeStreamAbortRef.current = async () => {
            abortCalls += 1
            rejectToolCall(new Error('The operation was aborted'))
          }
          try {
            await new Promise((_, reject) => { rejectToolCall = reject })
            return true
          } catch (error) {
            // Mirrors assistantReply's catch: only the latest turn may issue
            // follow-up requests or surface a failure message.
            if (isLatestTurn()) {
              followUpRequests.push('retry-request')
              appendedFailureMessages.push((error as Error).message)
            }
            return false
          }
        },
        flushDeferredCompanionNotices: async () => undefined,
      },
      {
        fromVoice: false,
        content: '帮我查一下日程',
        traceLabel: 'T1',
      } as never,
    )

    // Let the turn start and register its abort before the timeout fires.
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(typeof activeStreamAbortRef.current, 'function')

    mock.timers.tick(90_000)
    const sendSucceeded = await resultPromise
    // Flush the runner's post-abort continuation.
    await new Promise((resolve) => setImmediate(resolve))

    assert.equal(sendSucceeded, false)
    assert.equal(abortCalls, 1)
    // Turn start consumed id 1; the timeout must invalidate it like
    // cancelActiveTurn does, otherwise the stale-turn guard never engages.
    assert.equal(activeTurnIdRef.current, 2)
    assert.equal(shouldIgnoreAssistantTurnResult(activeTurnIdRef, 1), true)
    assert.deepEqual(followUpRequests, [])
    assert.deepEqual(appendedFailureMessages, [])
    assert.equal(busyRef.current, false)
    assert.equal(busyState, false)
    // The timeout surfaces its own copy — never the pseudo 'aborted' error.
    assert.equal(errors.at(-1), t('humanize.timeout'))
    assert.equal(busEventTypes.includes('session:aborted'), false)
    // The timeout fired while the turn left voiceState at 'processing'; the
    // finally-block safety reset skips stale turns, so the timeout path must
    // unwind it itself.
    assert.equal(voiceStateRef.current, 'idle')
    assert.equal(busEventTypes.includes('session:completed'), true)
  } finally {
    mock.timers.reset()
  }
})

test('submission lock rejects classification-pending duplicates, preserves a new draft, and releases in finally', async () => {
  const lock = { current: false }

  assert.equal(tryAcquireChatSubmission(lock), true)
  assert.equal(tryAcquireChatSubmission(lock), false)
  assert.equal(shouldClearSubmittedInput('new draft', 'submitted content'), false)
  assert.equal(shouldClearSubmittedInput('submitted content', 'submitted content'), true)
  assert.equal(shouldClearSubmittedInput('hello ', 'hello '), true)
  assert.equal(shouldClearSubmittedInput('hello', 'hello '), false)

  let classificationRejected = false
  try {
    await Promise.reject(new Error('classification failed'))
  } catch {
    classificationRejected = true
  } finally {
    releaseChatSubmission(lock)
  }

  assert.equal(classificationRejected, true)
  assert.equal(lock.current, false)
  assert.equal(tryAcquireChatSubmission(lock), true)
})

test('submission lock releases before the assistant turn and clears against the raw composer snapshot', async () => {
  const source = await readFile(new URL('../src/hooks/chat/sendMessage.ts', import.meta.url), 'utf8')
  const executeIndex = source.indexOf('return executeAssistantTurn(')
  const releaseBeforeExecuteIndex = source.lastIndexOf('releaseChatSubmission(submissionLockRef)', executeIndex)
  const finallyReleaseIndex = source.indexOf('releaseChatSubmission(submissionLockRef)', executeIndex)
  const snapshotIndex = source.indexOf('const composerSnapshot = !rawContent ? inputRef.current : null')

  assert.ok(executeIndex >= 0)
  assert.ok(releaseBeforeExecuteIndex > snapshotIndex)
  assert.ok(releaseBeforeExecuteIndex < executeIndex)
  assert.ok(finallyReleaseIndex > executeIndex)
  assert.match(source, /composerSnapshot !== null && shouldClearSubmittedInput\(inputRef\.current, composerSnapshot\)/)
  assert.match(source, /The lock only protects slash handling and preflight classification/)
})
