import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

import { requestAssistantReplyStreaming } from '../src/features/chat/runtime.ts'
import { getCoreRuntime } from '../src/lib/coreRuntime.ts'
import { loadSettings } from '../src/lib/storage.ts'
import type { AppSettings } from '../src/types/app.ts'
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
} from '../src/types/chat.ts'
import type { MemoryRecallContext } from '../src/types/memory.ts'

class MemoryStorage {
  private data = new Map<string, string>()

  getItem(key: string) {
    return this.data.get(key) ?? null
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
  const store = new MemoryStorage()
  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage: store,
      setTimeout: (handler: TimerHandler, timeout?: number, ...args: unknown[]) => (
        setTimeout(handler as () => void, timeout, ...args) as unknown as number
      ),
      clearTimeout: (id?: number) => clearTimeout(id as unknown as NodeJS.Timeout),
      addEventListener: () => undefined,
    },
    configurable: true,
    writable: true,
  })
  const runtime = getCoreRuntime()
  runtime.authStore.restore({ profiles: [] })
  runtime.costTracker.clear()
  runtime.refreshBudgetConfig({})
})

function makeChatSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    ...loadSettings(),
    apiProviderId: 'deepseek',
    apiBaseUrl: 'https://api.deepseek.com',
    apiKey: 'primary-key',
    model: 'deepseek-v4-flash',
    chatFailoverEnabled: false,
    smartModelRoutingEnabled: false,
    ...overrides,
  }
}

const memoryContext: MemoryRecallContext = {
  longTerm: [],
  daily: [],
  semantic: [],
  searchModeUsed: 'keyword',
  vectorSearchAvailable: false,
}

test('streaming assistant runtime does not require the non-streaming completeChat bridge', async () => {
  const history: ChatMessage[] = [{
    id: 'user-1',
    role: 'user',
    content: 'hello streaming nexus',
    createdAt: '2026-06-04T12:00:00.000Z',
  }]
  const deltas: Array<{ delta: string; done: boolean }> = []
  let executedPayload: ChatCompletionRequest | undefined

  const desktopPet = {
    completeChatStream: (
      payload: ChatCompletionRequest,
      onDelta: (delta: string, done: boolean) => void,
    ) => {
      executedPayload = payload
      onDelta('stream-', false)
      onDelta('ok', true)
      const request = Promise.resolve({ content: 'stream-ok' }) as Promise<ChatCompletionResponse> & {
        abort?: () => Promise<void>
      }
      request.abort = async () => undefined
      return request
    },
    personaLoadSoul: async () => '',
    personaLoadMemory: async () => '',
  }

  Object.assign(globalThis.window, { desktopPet })

  const result = await requestAssistantReplyStreaming(
    makeChatSettings(),
    history,
    memoryContext,
    (delta, done) => deltas.push({ delta, done }),
  )

  assert.equal('completeChat' in desktopPet, false)
  assert.equal(result.response.content, 'stream-ok')
  assert.equal(result.providerId, 'deepseek')
  assert.equal(executedPayload?.providerId, 'deepseek')
  assert.deepEqual(deltas, [
    { delta: 'stream-', done: false },
    { delta: 'ok', done: true },
  ])
})
