import assert from 'node:assert/strict'
import { test } from 'node:test'

import { AVAILABLE_LOCALES, ensureLocaleLoaded } from '../src/i18n/runtime.ts'
import type { AppLocale } from '../src/types/index.ts'

/**
 * The address field of the chat section used to be called a "text endpoint
 * URL", which is plumbing wording nobody outside the codebase knows. It now
 * reads like the simple settings page does: the address of the chat service
 * she talks to.
 */
const ENDPOINT_COPY: Record<AppLocale, string> = {
  'zh-CN': '聊天服务地址',
  'zh-TW': '聊天服務地址',
  'en-US': 'Chat service address',
  ja: 'チャットサービスのアドレス',
  ko: '채팅 서비스 주소',
}

const OLD_ENDPOINT_WORDS = /文本接口地址|文字介面地址|エンドポイント|엔드포인트|\bendpoint\b/i

test('the chat service address field reads like the simple settings page in every locale', async () => {
  for (const locale of AVAILABLE_LOCALES) {
    const dictionary = await ensureLocaleLoaded(locale)
    const value = dictionary['settings.model.endpoint_url']
    assert.equal(value, ENDPOINT_COPY[locale], `${locale}:settings.model.endpoint_url`)
    assert.doesNotMatch(value, OLD_ENDPOINT_WORDS, `${locale}:settings.model.endpoint_url`)
  }
})
