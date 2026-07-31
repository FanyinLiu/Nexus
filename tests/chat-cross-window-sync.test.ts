import assert from 'node:assert/strict'
import { register } from 'node:module'
import { test } from 'node:test'

import React from 'react'

import type { ChatMessage } from '../src/types/chat.ts'

// The hook under test uses bundler-style imports (directory / extensionless),
// which only resolve through the hooks registered here. Registration must
// happen before the dynamic imports inside each test.
register(new URL('./helpers/bundler-import-hooks.mjs', import.meta.url))

type LocalStorageMock = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
  clear: () => void
}

function createLocalStorageMock(initial: Record<string, string> = {}): LocalStorageMock {
  const store = new Map(Object.entries(initial))
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => { store.set(key, String(value)) },
    removeItem: (key) => { store.delete(key) },
    clear: () => { store.clear() },
  }
}

class FakeBroadcastChannel {
  static channels = new Map<string, Set<FakeBroadcastChannel>>()

  readonly name: string
  onmessage: ((event: { data: unknown }) => void) | null = null

  constructor(name: string) {
    this.name = name
    const peers = FakeBroadcastChannel.channels.get(name) ?? new Set()
    peers.add(this)
    FakeBroadcastChannel.channels.set(name, peers)
  }

  postMessage(data: unknown) {
    for (const peer of FakeBroadcastChannel.channels.get(this.name) ?? []) {
      if (peer === this) continue
      peer.onmessage?.({ data })
    }
  }

  close() {
    FakeBroadcastChannel.channels.get(this.name)?.delete(this)
  }
}

// ---------------------------------------------------------------------------
// Minimal React dispatcher. There is no DOM renderer in this environment, so
// the real hook runs against a hand-rolled hook table on React's shared
// internals: slots back useState/useRef, effects run synchronously after each
// "render" when their deps change (like an act() flush).
// ---------------------------------------------------------------------------

type ReactInternals = { H: unknown }
const reactInternals = (React as unknown as {
  __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: ReactInternals
}).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE

type EffectSlot = { deps?: readonly unknown[]; cleanup?: () => void }

function createHookRenderer<P, R>(hookFn: (props: P) => R) {
  const slots: unknown[] = []
  const effects: EffectSlot[] = []
  let cursor = 0
  let pending: Array<{ index: number; callback: () => void | (() => void) }> = []

  const dispatcher = {
    useState(initial: unknown) {
      const index = cursor++
      if (!(index in slots)) {
        slots[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial
      }
      const setState = (value: unknown) => {
        slots[index] = typeof value === 'function'
          ? (value as (prev: unknown) => unknown)(slots[index])
          : value
      }
      return [slots[index], setState]
    },
    useRef(initial: unknown) {
      const index = cursor++
      if (!(index in slots)) slots[index] = { current: initial }
      return slots[index]
    },
    useCallback(fn: unknown) {
      cursor++
      return fn
    },
    useMemo(fn: () => unknown) {
      cursor++
      return fn()
    },
    useEffect(callback: () => void | (() => void), deps?: readonly unknown[]) {
      const index = cursor++
      const prev = effects[index]
      const changed = !prev
        || deps === undefined
        || prev.deps === undefined
        || deps.length !== prev.deps.length
        || deps.some((dep, i) => !Object.is(dep, prev.deps![i]))
      if (changed) {
        effects[index] = { deps }
        pending.push({ index, callback })
      }
    },
  }

  function render(props: P): R {
    cursor = 0
    pending = []
    reactInternals.H = dispatcher
    let result: R
    try {
      result = hookFn(props)
    } finally {
      reactInternals.H = null
    }
    for (const { index, callback } of pending) {
      const slot = effects[index]
      slot.cleanup?.()
      const cleanup = callback()
      slot.cleanup = typeof cleanup === 'function' ? cleanup : undefined
    }
    return result
  }

  function unmount() {
    for (const effect of effects) effect?.cleanup?.()
  }

  return { render, unmount }
}

// ---------------------------------------------------------------------------

function installWindow() {
  const target = new EventTarget()
  const localStorage = createLocalStorageMock()
  const win = Object.assign(target, {
    localStorage,
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  })
  Object.defineProperty(globalThis, 'window', {
    value: win,
    configurable: true,
    writable: true,
  })
  Object.defineProperty(globalThis, 'BroadcastChannel', {
    value: FakeBroadcastChannel,
    configurable: true,
    writable: true,
  })
  return win
}

type ChatStorageModule = typeof import('../src/lib/storage.ts')
type ChatPersistenceModule = typeof import('../src/hooks/chat/useChatPersistence.ts')

// saveChatMessages debounces its writeJson by 500ms; wait past that before
// asserting on what did (or did not) hit localStorage / the sync channel.
const DEBOUNCE_GRACE_MS = 650

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function makeMessage(id: string, role: ChatMessage['role'], content: string, at: number): ChatMessage {
  return { id, role, content, createdAt: new Date(at).toISOString() }
}

async function setup() {
  // No FakeBroadcastChannel.reset() here: the storage core's syncChannel is
  // created once at module load and stays registered for the whole process —
  // clearing the registry would orphan it, like a closed channel in prod.
  const win = installWindow()

  const { useChatPersistence } = await import('../src/hooks/chat/useChatPersistence.ts') as ChatPersistenceModule
  const storage = await import('../src/lib/storage.ts') as ChatStorageModule
  const { CHAT_STORAGE_KEY, loadChatMessages, onStorageChange } = storage

  let current: ChatMessage[] = []
  const renderer = createHookRenderer(useChatPersistence)
  let hook!: ReturnType<typeof useChatPersistence>
  const render = () => {
    hook = renderer.render({
      messages: current,
      setMessages: (next: ChatMessage[]) => {
        current = next
        render()
      },
    })
  }
  const rerenderWith = (next: ChatMessage[]) => {
    current = next
    render()
  }

  // Count writes reaching this window's own storage for the chat key, and
  // every chat payload broadcast to peers. A remote apply must produce zero
  // of both; a local turn must produce exactly one of each.
  let chatWrites = 0
  const baseSetItem = win.localStorage.setItem
  win.localStorage.setItem = (key: string, value: string) => {
    if (key === CHAT_STORAGE_KEY) chatWrites += 1
    baseSetItem(key, value)
  }

  const observer = new FakeBroadcastChannel('nexus-storage-sync')
  let chatBroadcasts = 0
  observer.onmessage = (event) => {
    if ((event.data as { key?: string })?.key === CHAT_STORAGE_KEY) chatBroadcasts += 1
  }

  // Mirrors the subscription in useDesktopBridge: a peer window's write
  // notification applies the persisted messages through the owning hook.
  const subscribeRemoteChat = () => onStorageChange(
    CHAT_STORAGE_KEY,
    () => hook.applyRemoteMessages(loadChatMessages()),
  )

  // Simulates the other window: it persists to the shared localStorage and
  // posts the write notification from its own channel instance.
  const simulateRemoteWrite = (messages: ChatMessage[]) => {
    baseSetItem(CHAT_STORAGE_KEY, JSON.stringify(messages))
    const writer = new FakeBroadcastChannel('nexus-storage-sync')
    writer.postMessage({ key: CHAT_STORAGE_KEY, value: messages, timestamp: Date.now() })
    writer.close()
  }

  const cleanup = (unsubscribe?: () => void) => {
    unsubscribe?.()
    renderer.unmount()
    observer.close()
  }

  // The observer also sees the simulated remote write itself (like a third
  // window would). Baseline both counters after that trigger so the
  // assertions measure only what the local hook adds afterwards.
  const resetCounts = () => {
    chatWrites = 0
    chatBroadcasts = 0
  }

  return {
    CHAT_STORAGE_KEY,
    render,
    rerenderWith,
    subscribeRemoteChat,
    simulateRemoteWrite,
    cleanup,
    resetCounts,
    get current() { return current },
    get chatWrites() { return chatWrites },
    get chatBroadcasts() { return chatBroadcasts },
  }
}

test('BroadcastChannel write notification applies the remote chat messages', async () => {
  const env = await setup()
  env.render()
  const unsubscribe = env.subscribeRemoteChat()

  const remote = [
    makeMessage('remote-1', 'user', 'voice turn from the pet window', 1_000),
    makeMessage('remote-2', 'assistant', 'answer recorded while the panel was closed', 2_000),
  ]
  env.simulateRemoteWrite(remote)

  assert.deepEqual(env.current, remote)

  env.cleanup(unsubscribe)
})

test('applying remote chat messages does not echo back into storage or the sync channel', async () => {
  const env = await setup()
  env.render()
  const unsubscribe = env.subscribeRemoteChat()

  env.simulateRemoteWrite([makeMessage('remote-1', 'user', 'hello from the other window', 1_000)])
  assert.equal(env.current.length, 1)
  env.resetCounts()

  await sleep(DEBOUNCE_GRACE_MS)
  assert.equal(env.chatWrites, 0, 'remote apply must not re-save chat messages')
  assert.equal(env.chatBroadcasts, 0, 'remote apply must not re-broadcast the chat key')

  // Control: a genuine local turn on the same hook instance does persist and
  // broadcast, so the zeros above come from the skip flag, not a dead hook.
  env.rerenderWith([...env.current, makeMessage('local-1', 'user', 'typed locally', 3_000)])
  await sleep(DEBOUNCE_GRACE_MS)
  assert.equal(env.chatWrites, 1)
  assert.equal(env.chatBroadcasts, 1)

  env.cleanup(unsubscribe)
})

test('re-render with an unchanged message signature does not re-save or re-broadcast', async () => {
  const env = await setup()
  const initial = [
    makeMessage('initial-1', 'user', 'first local turn', 1_000),
    makeMessage('initial-2', 'assistant', 'first local answer', 2_000),
  ]
  env.rerenderWith(initial)
  await sleep(DEBOUNCE_GRACE_MS)
  assert.equal(env.chatWrites, 0, 'initial mount never saves')

  // Same messages, new array identity: the signature matches the last saved
  // one, so the save effect exits before touching storage.
  env.rerenderWith([...initial])
  await sleep(DEBOUNCE_GRACE_MS)
  assert.equal(env.chatWrites, 0)
  assert.equal(env.chatBroadcasts, 0)

  // The signature only covers length + last message (id, content length,
  // tone). Editing an earlier message leaves it unchanged and must not save.
  env.rerenderWith([makeMessage('initial-1', 'user', 'first local turn, edited in place', 1_000), initial[1]])
  await sleep(DEBOUNCE_GRACE_MS)
  assert.equal(env.chatWrites, 0)
  assert.equal(env.chatBroadcasts, 0)

  // Control: a new last message changes the signature and saves once.
  env.rerenderWith([...env.current, makeMessage('local-2', 'user', 'new turn', 3_000)])
  await sleep(DEBOUNCE_GRACE_MS)
  assert.equal(env.chatWrites, 1)
  assert.equal(env.chatBroadcasts, 1)

  env.cleanup()
})
