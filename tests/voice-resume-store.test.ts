import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'

import { voiceResumeStore } from '../src/features/voice/voiceResumeStore.ts'

afterEach(() => {
  voiceResumeStore.clear()
})

test('voice resume store records remaining text after an interruption', () => {
  voiceResumeStore.setActiveText('Hello there, this is a long reply.')
  voiceResumeStore.recordChunkPlayed('Hello there, ')
  voiceResumeStore.markInterrupted()

  const pending = voiceResumeStore.peekPendingResume()
  assert.equal(pending?.remainingText, 'this is a long reply.')
  assert.equal(pending?.originalText, 'Hello there, this is a long reply.')
  assert.equal(typeof pending?.interruptedAt, 'number')
})

test('voice resume store clears stale pending resumes when new speech starts', () => {
  voiceResumeStore.setActiveText('First reply should be resumable.')
  voiceResumeStore.recordChunkPlayed('First ')
  voiceResumeStore.markInterrupted()
  assert.ok(voiceResumeStore.peekPendingResume())

  voiceResumeStore.setActiveText('Second reply has started.')

  assert.equal(voiceResumeStore.peekPendingResume(), null)
})

test('voice resume store returns defensive snapshots to callers and subscribers', () => {
  const seen: Array<string | null> = []
  const unsubscribe = voiceResumeStore.subscribe((snapshot) => {
    seen.push(snapshot?.remainingText ?? null)
    if (snapshot) {
      snapshot.remainingText = 'mutated by subscriber'
    }
  })

  voiceResumeStore.setActiveText('Read this sentence aloud.')
  voiceResumeStore.recordChunkPlayed('Read ')
  voiceResumeStore.markInterrupted()

  const peeked = voiceResumeStore.peekPendingResume()
  assert.equal(peeked?.remainingText, 'this sentence aloud.')
  if (peeked) {
    peeked.remainingText = 'mutated by caller'
  }
  assert.equal(voiceResumeStore.peekPendingResume()?.remainingText, 'this sentence aloud.')

  const popped = voiceResumeStore.popPendingResume()
  assert.equal(popped?.remainingText, 'this sentence aloud.')
  assert.equal(voiceResumeStore.peekPendingResume(), null)
  assert.deepEqual(seen, [null, 'this sentence aloud.', null])

  unsubscribe()
})

test('voice resume store clears completed or fully played speech without pending resume', () => {
  voiceResumeStore.setActiveText('Complete reply.')
  voiceResumeStore.recordChunkPlayed('Complete reply.')
  voiceResumeStore.markInterrupted()
  assert.equal(voiceResumeStore.peekPendingResume(), null)

  voiceResumeStore.setActiveText('Another reply.')
  voiceResumeStore.markCompleted()
  assert.equal(voiceResumeStore.peekPendingResume(), null)
})
