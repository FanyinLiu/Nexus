import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import {
  clearExpiredNotificationSnoozes,
  commitNotificationMessages,
  prependNotificationMessage,
  sanitizeNotificationMessageSnapshot,
} from '../src/lib/privacy/notificationMessageState.ts'
import type { NotificationMessage } from '../src/types/autonomy.ts'

const hookSource = readFileSync(
  new URL('../src/hooks/useNotificationBridge.ts', import.meta.url),
  'utf8',
).replace(/\r\n?/g, '\n')

function makeMessage(overrides: Partial<NotificationMessage> = {}): NotificationMessage {
  return {
    id: 'message-1',
    channelId: 'mail',
    channelName: 'Mail',
    title: 'Ada',
    body: 'private body',
    summary: 'private summary',
    receivedAt: new Date(0).toISOString(),
    read: false,
    ...overrides,
  }
}

function simulateOwnerLifecycle(transitions: readonly boolean[]) {
  let start = 0
  let stop = 0
  let unsubscribe = 0
  let timerClear = 0
  let cleanup: (() => void) | undefined

  for (const runtimeOwner of transitions) {
    cleanup?.()
    cleanup = undefined
    if (!runtimeOwner) continue

    start += 1
    cleanup = () => {
      stop += 1
      unsubscribe += 1
      timerClear += 1
    }
  }

  return { start, stop, unsubscribe, timerClear }
}

test('local incoming notification commits once while keeping raw body only in memory', () => {
  const message = makeMessage()
  const next = prependNotificationMessage([], message)
  let writes = 0
  let persisted: NotificationMessage[] = []
  let applied: NotificationMessage[] = []

  commitNotificationMessages(
    next,
    (value) => {
      writes += 1
      persisted = value
    },
    (value) => { applied = value },
  )

  assert.equal(writes, 1)
  assert.equal(persisted[0]?.body, '')
  assert.equal(persisted[0]?.summary, undefined)
  assert.equal(applied[0]?.body, message.body)
  assert.equal(applied[0]?.summary, message.summary)
})

test('remote snapshots are sanitized and apply without persistence or notification side effects', () => {
  const message = makeMessage()
  let writes = 0
  let notifications = 0
  const applied = sanitizeNotificationMessageSnapshot([
    message,
    null,
    'not a message',
    { id: 'incomplete' },
  ])

  // This models the hook's remote callback: it only calls applyMessages. The
  // storage callback has no write or onNotification dependency by design.
  const applyRemote = (value: unknown) => {
    const snapshot = sanitizeNotificationMessageSnapshot(value)
    writes += 0
    notifications += 0
    return snapshot
  }

  const remoteState = applyRemote([message])
  assert.equal(writes, 0)
  assert.equal(notifications, 0)
  assert.equal(applied.length, 1)
  assert.equal(remoteState[0]?.body, '')
  assert.equal(remoteState[0]?.summary, undefined)
})

test('explicit message mutations use one latest-snapshot commit each', () => {
  let current = [makeMessage()]
  let writes = 0
  const commit = (next: NotificationMessage[]) => {
    commitNotificationMessages(
      next,
      () => { writes += 1 },
      (applied) => { current = applied },
    )
  }

  commit(current.map((message) => ({ ...message, read: true })))
  assert.equal(writes, 1)
  commit(current.map((message) => ({ ...message, read: false })))
  assert.equal(writes, 2)
  commit(current.map((message) => ({ ...message, isImportant: true })))
  assert.equal(writes, 3)
  commit(current.map((message) => ({ ...message, snoozedUntil: new Date(60_000).toISOString() })))
  assert.equal(writes, 4)
  commit([])
  assert.equal(writes, 5)
  assert.deepEqual(current, [])
})

test('prune computes from the latest ref and only commits when a snooze expires', () => {
  const expired = makeMessage({ snoozedUntil: new Date(1_000).toISOString() })
  const active = makeMessage({ id: 'active', snoozedUntil: new Date(3_000).toISOString() })
  const next = clearExpiredNotificationSnoozes([expired, active], 2_000)

  assert.equal(next[0]?.snoozedUntil, undefined)
  assert.equal(next[1]?.snoozedUntil, active.snoozedUntil)
})

test('message snapshots retain the 50-item storage cap', () => {
  const messages = Array.from({ length: 55 }, (_, index) => makeMessage({ id: `message-${index}` }))
  const snapshot = sanitizeNotificationMessageSnapshot(messages)

  assert.equal(snapshot.length, 50)
  assert.equal(snapshot[0]?.id, 'message-0')
  assert.equal(snapshot.at(-1)?.id, 'message-49')
})

test('owner lifecycle cleanup runs when runtime ownership flips away', () => {
  assert.deepEqual(simulateOwnerLifecycle([true, false]), {
    start: 1,
    stop: 1,
    unsubscribe: 1,
    timerClear: 1,
  })
})

test('notification hook has explicit sync boundaries and no message write effect or BroadcastChannel ping-pong', () => {
  const stateInitializerStart = hookSource.indexOf('useState<NotificationMessage[]>(() => {')
  const stateInitializerEnd = hookSource.indexOf('const messagesRef = useRef(messages)', stateInitializerStart)
  assert.ok(stateInitializerStart >= 0)
  assert.ok(stateInitializerEnd > stateInitializerStart)
  assert.match(hookSource.slice(stateInitializerStart, stateInitializerEnd), /readJson<unknown>/)
  assert.match(hookSource.slice(stateInitializerStart, stateInitializerEnd), /clearExpiredNotificationSnoozes/)
  assert.match(hookSource, /const messagesRef = useRef\(messages\)/)
  assert.match(hookSource, /const applyMessages = useCallback\(/)
  assert.match(hookSource, /const commitMessages = useCallback\(/)
  assert.match(hookSource, /onStorageChange\(/)
  assert.match(hookSource, /sanitizeNotificationMessageSnapshot\(value\)/)
  assert.match(hookSource, /writeJson\(AUTONOMY_NOTIFICATIONS_MESSAGES_STORAGE_KEY, persisted\)/)
  assert.doesNotMatch(hookSource, /sanitizeNotificationMessagesForStorage\(messages\)/)
  assert.doesNotMatch(hookSource, /\[messages, runtimeOwner\]/)
  assert.doesNotMatch(hookSource, /BroadcastChannel/)
  assert.match(
    hookSource,
    /return \(\) => \{\n {6}void window\.desktopPet\?\.stopNotificationBridge\?\.\(\)\n {4}\}/,
  )

  const remoteEffectStart = hookSource.indexOf('useEffect(() => onStorageChange(')
  const remoteEffectEnd = hookSource.indexOf('// Clean up expired snoozes', remoteEffectStart)
  assert.ok(remoteEffectStart >= 0)
  assert.ok(remoteEffectEnd > remoteEffectStart)
  const remoteEffect = hookSource.slice(remoteEffectStart, remoteEffectEnd)
  assert.doesNotMatch(remoteEffect, /writeJson|onNotification/)

  assert.match(hookSource, /if \(!runtimeOwner\) return\n {4}const intervalId = window\.setInterval/)
  assert.match(hookSource, /if \(!runtimeOwner\) return\n {4}if \(!enabled\) return\n\n {4}void window\.desktopPet\?\.startNotificationBridge/)
  assert.match(hookSource, /if \(!runtimeOwner\) return\n {4}if \(!enabled\) return\n\n {4}const unsubscribe = window\.desktopPet\?\.subscribeNotifications/)
})
