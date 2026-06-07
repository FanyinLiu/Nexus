import assert from 'node:assert/strict'
import { test } from 'node:test'

import { SessionStore, tokenize } from '../src/core/sessions/SessionStore.ts'

test('SessionStore returns defensive session and message snapshots', () => {
  const store = new SessionStore()
  const created = store.createSession('conversation-a', 'Title')
  created.messageCount = 99
  created.title = 'mutated'

  const appended = store.appendMessage(created.id, {
    role: 'user',
    content: 'Find the red notebook',
    timestamp: 100,
  })
  appended.content = 'mutated content'

  const listed = store.listSessions('conversation-a')
  assert.equal(listed.length, 1)
  assert.equal(listed[0]?.messageCount, 1)
  assert.equal(listed[0]?.title, 'Title')

  const messages = store.getMessages(created.id)
  assert.equal(messages.length, 1)
  assert.equal(messages[0]?.content, 'Find the red notebook')
  messages[0]!.content = 'caller mutation'
  assert.equal(store.getMessages(created.id)[0]?.content, 'Find the red notebook')

  const hit = store.search('red notebook')[0]
  assert.equal(hit?.snippet, 'Find the red notebook')
  assert.equal(hit?.score, 2)
})

test('SessionStore keeps deleted sessions out of the search index', () => {
  const store = new SessionStore()
  const session = store.createSession('conversation-a')
  store.appendMessage(session.id, {
    role: 'assistant',
    content: 'The hidden phrase should disappear after deletion',
    timestamp: 200,
  })
  assert.equal(store.search('hidden phrase').length, 1)

  store.deleteSession(session.id)

  assert.equal(store.getSession(session.id), undefined)
  assert.deepEqual(store.getMessages(session.id), [])
  assert.deepEqual(store.search('hidden phrase'), [])
})

test('SessionStore search scopes, scores, and normalizes limits', () => {
  const store = new SessionStore()
  const first = store.createSession('conversation-a')
  const second = store.createSession('conversation-b')
  store.appendMessage(first.id, {
    role: 'user',
    content: 'alpha beta gamma',
    timestamp: 100,
  })
  store.appendMessage(first.id, {
    role: 'assistant',
    content: 'alpha beta',
    timestamp: 300,
  })
  store.appendMessage(second.id, {
    role: 'assistant',
    content: 'alpha beta delta',
    timestamp: 200,
  })

  const scoped = store.search('alpha beta', { sessionId: first.id, minScore: 2 })
  assert.equal(scoped.length, 2)
  assert.ok(scoped.every((hit) => hit.sessionId === first.id))
  assert.deepEqual(scoped.map((hit) => hit.timestamp), [300, 100])

  assert.equal(store.search('alpha beta', { limit: 1 }).length, 1)
  assert.equal(store.search('alpha beta', { limit: 0 }).length, 3)
  assert.equal(store.search('alpha beta', { limit: -1 }).length, 3)
  assert.equal(store.search('alpha beta', { minScore: Number.NaN }).length, 3)
})

test('tokenize supports CJK character fallback and stopword filtering', () => {
  assert.deepEqual(tokenize('我们 今天 看 星绘'), ['今天', '今', '天', '看', '星绘', '星', '绘'])
  assert.deepEqual(tokenize('a the of B useful'), ['useful'])
})
