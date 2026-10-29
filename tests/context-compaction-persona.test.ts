import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

import {
  clearCompactionCache,
  compactMessagesForRequest,
  formatCompactionContext,
  summarizeOlderMessages,
} from '../src/features/chat/contextCompaction.ts'
import { getChatPromptStrings } from '../src/features/chat/prompts/index.ts'
import type { AppSettings, ChatMessage, UiLanguage } from '../src/types'

const LOCALES: UiLanguage[] = ['en-US', 'zh-CN', 'zh-TW', 'ja', 'ko']

const speakers = { userName: 'Klein', companionName: '星绘' }

const settings = {
  apiProviderId: 'openai',
  apiBaseUrl: 'https://api.example/v1',
  apiKey: 'test-key',
  model: 'gpt-4o-mini',
  uiLanguage: 'en-US',
} as unknown as AppSettings

function message(index: number, role: 'user' | 'assistant', content: string): ChatMessage {
  return {
    id: String(index),
    role,
    content,
    createdAt: `2026-10-29T00:00:0${index}.000Z`,
  }
}

function captureCompleteChat() {
  const calls: Array<{ messages: Array<{ role: string; content: string }> }> = []
  Object.defineProperty(globalThis, 'window', {
    value: {
      desktopPet: {
        completeChat: async (payload: { messages: Array<{ role: string; content: string }> }) => {
          calls.push(payload)
          return { content: 'recap from the model' }
        },
      },
    },
    configurable: true,
    writable: true,
  })
  return calls
}

beforeEach(() => {
  clearCompactionCache()
})

test('the dropped transcript is labelled with the two speakers, never "AI"', () => {
  const history = [
    message(1, 'user', '今晚吃什么'),
    message(2, 'assistant', '……随便。你决定。'),
    message(3, 'user', '那吃面'),
    message(4, 'assistant', '嗯。'),
    message(5, 'user', '你刚才是不是偷偷笑了'),
    message(6, 'assistant', '没有。'),
  ]

  const { compacted, olderMessagesText } = compactMessagesForRequest(history, 4, 100_000, speakers)

  assert.equal(compacted, true)
  assert.ok(olderMessagesText)
  assert.match(olderMessagesText ?? '', /^Klein: 今晚吃什么/m)
  assert.match(olderMessagesText ?? '', /^星绘: ……随便。你决定。/m)
  assert.doesNotMatch(olderMessagesText ?? '', /(^|\n)User:/)
  assert.doesNotMatch(olderMessagesText ?? '', /(^|\n)AI:/)
})

test('missing names fall back to neutral speaker words, still not "AI"', () => {
  const history = [
    message(1, 'user', 'one'),
    message(2, 'assistant', 'two'),
    message(3, 'user', 'three'),
    message(4, 'assistant', 'four'),
    message(5, 'user', 'five'),
    message(6, 'assistant', 'six'),
  ]

  const { olderMessagesText } = compactMessagesForRequest(history, 4, 100_000)

  assert.match(olderMessagesText ?? '', /^User: one/m)
  assert.match(olderMessagesText ?? '', /^Companion: two/m)
  assert.doesNotMatch(olderMessagesText ?? '', /(^|\n)AI:/)
})

test('the summary instruction carries both names and never calls her an assistant', async () => {
  const calls = captureCompleteChat()

  const summary = await summarizeOlderMessages(
    'Klein: 今晚吃什么\n星绘: ……随便。你决定。',
    settings,
    speakers,
  )

  assert.equal(summary, 'recap from the model')
  assert.equal(calls.length, 1)
  const system = calls[0].messages[0].content
  assert.match(system, /Klein/)
  assert.match(system, /星绘/)
  assert.doesNotMatch(system, /assistant/i)
  // The recap is hers: first person, her voice, her nicknames and jokes.
  assert.match(system, /first person/i)
  assert.match(system, /running jokes/i)
  assert.match(system, /nicknames/i)
})

test('every locale has a persona-aware instruction and recap wrapper', () => {
  for (const uiLanguage of LOCALES) {
    const prompts = getChatPromptStrings(uiLanguage)
    const instruction = prompts.compactionSummaryInstruction({
      companionName: '星绘',
      userName: 'Klein',
    })
    assert.match(instruction, /星绘/, uiLanguage)
    assert.match(instruction, /Klein/, uiLanguage)
    assert.doesNotMatch(instruction, /assistant/i, uiLanguage)

    const wrapper = prompts.compactionContext('recap body')
    assert.ok(wrapper.includes('recap body'), uiLanguage)
    assert.ok(wrapper.length > 'recap body'.length, uiLanguage)
  }
})

test('formatCompactionContext asks her to keep her established voice', () => {
  const english = formatCompactionContext('summary text', 'en-US')
  assert.match(english, /keep speaking in your established voice/i)
  assert.match(english, /summary text/)

  const chinese = formatCompactionContext('回顾内容', 'zh-CN')
  assert.match(chinese, /你自己的语气/)
  assert.match(chinese, /回顾内容/)
})

test('the summary cache key is still the transcript text alone', async () => {
  const calls = captureCompleteChat()
  const text = 'Klein: 在吗\n星绘: 嗯。'

  const first = await summarizeOlderMessages(text, settings, speakers)
  const second = await summarizeOlderMessages(text, settings, {
    userName: 'Someone else',
    companionName: 'Another name',
  })

  assert.equal(first, second)
  assert.equal(calls.length, 1)
})
