import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

import { isFailoverEligibleError } from '../src/features/failover/runtime.ts'

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

test('chat provider configuration errors do not trigger failover', () => {
  assert.equal(
    isFailoverEligibleError(new Error('模型返回了空内容（reasoningLength=1280），请检查接口兼容性或关闭该模型的 Thinking。')),
    false,
  )
  assert.equal(
    isFailoverEligibleError(new Error('模型请求失败（状态码：404）')),
    false,
  )
})

test('network errors still trigger provider failover', () => {
  assert.equal(isFailoverEligibleError(new Error('fetch failed')), true)
})
