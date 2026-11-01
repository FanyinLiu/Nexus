import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'

import { emitPetNotify, subscribePetNotify } from '../src/lib/petNotifyBus.ts'

const cleanups: Array<() => void> = []

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
})

test('pet notifications reach every subscriber synchronously in emit order', () => {
  const seen: string[] = []
  cleanups.push(subscribePetNotify((event) => {
    seen.push(`first:${event.type}`)
    // A subscriber must observe the notification before emit returns.
    if (event.type === 'mood') assert.equal(event.mood, 'thinking')
  }))
  cleanups.push(subscribePetNotify((event) => {
    seen.push(`second:${event.type}`)
  }))

  emitPetNotify({ type: 'mood', mood: 'thinking' })
  emitPetNotify({ type: 'status', text: 'working', duration: 1_200 })

  assert.deepEqual(seen, [
    'first:mood',
    'second:mood',
    'first:status',
    'second:status',
  ])
})

test('unsubscribe is idempotent and prevents duplicate delivery after a StrictMode-style remount', () => {
  const seen: string[] = []
  const listener = (event: { type: string }) => { seen.push(event.type) }
  const unsubscribe = subscribePetNotify(listener)

  emitPetNotify({ type: 'performance_cue_clear' })
  unsubscribe()
  unsubscribe()
  emitPetNotify({ type: 'mood', mood: 'idle' })

  // Remount re-registers the same function once; the set holds one copy.
  cleanups.push(subscribePetNotify(listener))
  emitPetNotify({ type: 'status', text: 'remounted' })

  assert.deepEqual(seen, ['performance_cue_clear', 'status'])
})
