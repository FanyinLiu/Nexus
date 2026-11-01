import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

import { isFailoverEligibleError } from '../src/features/failover/runtime.ts'
import { MAIN_MESSAGES, MAIN_MESSAGE_LOCALES } from '../electron/mainMessagesTable.js'

const SAMPLE_PARAMS = {
  status: '503',
  code: '45000000',
  reason: 'socket hang up',
  message: 'raw',
  count: '3',
  appName: 'Nexus',
} as const

function fillMessage(template: string) {
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (match, name: string) => (
    Object.hasOwn(SAMPLE_PARAMS, name)
      ? SAMPLE_PARAMS[name as keyof typeof SAMPLE_PARAMS]
      : match
  ))
}

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

test('every localized main-process message classifies like its zh-CN source', () => {
  for (const [key, zhTemplate] of Object.entries(MAIN_MESSAGES['zh-CN'])) {
    const zhEligible = isFailoverEligibleError(new Error(fillMessage(zhTemplate)))
    for (const locale of MAIN_MESSAGE_LOCALES) {
      const localized = fillMessage(MAIN_MESSAGES[locale][key])
      assert.equal(
        isFailoverEligibleError(new Error(localized)),
        zhEligible,
        `${locale} ${key} disagrees with zh-CN on failover eligibility: ${localized}`,
      )
    }
  }
})
