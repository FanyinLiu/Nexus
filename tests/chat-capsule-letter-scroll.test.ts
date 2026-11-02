import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  getChatHistoryScrollTop,
  getChatMessageStartScrollTop,
  getChatSheetScrollTarget,
  type ChatScrollArticleElement,
  type ChatScrollHistoryElement,
} from '../src/features/uiV2/chatSheetScroll.ts'

const sheetPath = new URL('../src/features/uiV2/ChatSheetV2.tsx', import.meta.url)
const scrollHookPath = new URL('../src/features/uiV2/useChatSheetScroll.ts', import.meta.url)

function fakeArticle(
  id: string,
  offsetTop: number,
  offsetParent: unknown,
): ChatScrollArticleElement {
  return {
    offsetTop,
    offsetParent,
    getAttribute: (name: string) => (name === 'data-message-id' ? id : null),
  }
}

function fakeHistory(options: {
  offsetTop?: number
  offsetParent?: unknown
  scrollHeight?: number
  articles?: ChatScrollArticleElement[]
} = {}): ChatScrollHistoryElement {
  return {
    offsetTop: options.offsetTop ?? 0,
    offsetParent: options.offsetParent ?? null,
    scrollHeight: options.scrollHeight ?? 1200,
    querySelectorAll: () => options.articles ?? [],
  }
}

test('capsule letter as the latest message starts at the message top', () => {
  assert.equal(getChatSheetScrollTarget({ id: 'a1', capsuleLetter: { body: 'hi' } }), 'message-start')
})

test('plain assistant, user, empty, and earlier-capsule histories keep the bottom target', () => {
  assert.equal(getChatSheetScrollTarget({ id: 'a1' }), 'bottom')
  assert.equal(getChatSheetScrollTarget({ id: 'u1' }), 'bottom')
  assert.equal(getChatSheetScrollTarget(undefined), 'bottom')
  // The target only looks at the latest message, not any earlier capsule.
  assert.equal(getChatSheetScrollTarget({ id: 'a2' }), 'bottom')
})

test('message-start scrollTop uses offsetTop when the article is parented by the history', () => {
  const history = { offsetTop: 40 }
  const article = { offsetTop: 320, offsetParent: history }
  assert.equal(getChatMessageStartScrollTop(article, history), 320)
})

test('message-start scrollTop subtracts the history offset when they share an ancestor', () => {
  const sharedParent = {}
  const history = { offsetTop: 40 }
  const article = { offsetTop: 320, offsetParent: sharedParent }
  assert.equal(getChatMessageStartScrollTop(article, history), 280)
})

test('message-start scrollTop never goes negative', () => {
  const history = { offsetTop: 200 }
  const article = { offsetTop: 40, offsetParent: {} }
  assert.equal(getChatMessageStartScrollTop(article, history), 0)
})

test('history scrollTop anchors a capsule article instead of the bottom', () => {
  const history = fakeHistory({ offsetTop: 0, scrollHeight: 1200 })
  const articles = [fakeArticle('a1', 120, history), fakeArticle('a2', 360, history)]
  history.querySelectorAll = () => articles
  assert.equal(getChatHistoryScrollTop(history, [{ id: 'a1' }, { id: 'a2', capsuleLetter: {} }]), 360)
})

test('history scrollTop falls back to the bottom for plain latest messages', () => {
  const history = fakeHistory({
    scrollHeight: 1200,
    articles: [fakeArticle('a1', 120, null)],
  })
  assert.equal(getChatHistoryScrollTop(history, [{ id: 'a1' }]), 1200)
})

test('history scrollTop falls back to the bottom when the capsule article is missing', () => {
  const history = fakeHistory({
    scrollHeight: 1200,
    articles: [fakeArticle('a1', 120, null)],
  })
  assert.equal(getChatHistoryScrollTop(history, [{ id: 'a9', capsuleLetter: {} }]), 1200)
})

test('the chat sheet delegates scroll anchoring to the capsule-aware hook', async () => {
  const [sheetSource, scrollHookSource] = await Promise.all([
    readFile(sheetPath, 'utf8'),
    readFile(scrollHookPath, 'utf8'),
  ])

  const scrollToLatestBlock = scrollHookSource.match(
    /const scrollToLatest = useCallback\(\([\s\S]*?\n {2}\}, \[\]\)/,
  )?.[0] ?? ''
  assert.match(scrollToLatestBlock, /getChatHistoryScrollTop\(history, messagesRef\.current\)/)
  assert.doesNotMatch(scrollToLatestBlock, /top:\s*history\.scrollHeight/)
  assert.doesNotMatch(scrollHookSource, /scrollIntoView/)
  assert.match(sheetSource, /useChatSheetScroll\(\{ messages, scheduleFrame \}\)/)
  assert.match(sheetSource, /data-message-id=\{message\.id\}/)
})
