import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  HearingRuntime,
  type HearingRuntimeSnapshot,
} from '../src/features/hearing/hearingRuntime.ts'
import type { SenseVoiceStreamSession } from '../src/features/hearing/localSenseVoice.ts'
import type { TencentAsrStreamSession } from '../src/features/hearing/tencentAsr.ts'

test('idle phase clears the active hearing engine and stale speech level', () => {
  const runtime = new HearingRuntime()
  const snapshots: HearingRuntimeSnapshot[] = []
  runtime.subscribe(() => snapshots.push(runtime.getSnapshot()))

  runtime.activateEngine('sensevoice')
  runtime.setPhase('listening')
  runtime.setSpeechLevel(0.8)
  runtime.setPhase('idle')

  const snapshot = runtime.getSnapshot()
  assert.equal(snapshot.phase, 'idle')
  assert.equal(snapshot.engine, 'none')
  assert.equal(snapshot.speechLevel, 0)
  assert.equal(snapshots.at(-1)?.engine, 'none')
})

test('clearing the active STT session returns hearing runtime to idle', () => {
  const runtime = new HearingRuntime()
  const session = {
    abort() {},
    async stop() {
      return { text: '', audioSamples: null, sampleRate: 16_000, voiceEmotion: null }
    },
  } as SenseVoiceStreamSession

  runtime.setSensevoiceSession(session)
  runtime.setPhase('listening')
  runtime.setSensevoiceSession(null)

  const snapshot = runtime.getSnapshot()
  assert.equal(snapshot.phase, 'idle')
  assert.equal(snapshot.engine, 'none')
})

test('dispose aborts active sessions and publishes the final idle snapshot before unsubscribing', () => {
  const runtime = new HearingRuntime()
  let aborted = false
  let lastSnapshot: HearingRuntimeSnapshot | null = null
  let notifications = 0

  const session = {
    abort() { aborted = true },
    async stop() {
      return { text: '', audioSamples: null, sampleRate: 16_000 }
    },
  } as TencentAsrStreamSession

  runtime.setTencentAsrSession(session)
  runtime.setPhase('listening')
  runtime.setSpeechLevel(0.6)
  runtime.subscribe(() => {
    notifications += 1
    lastSnapshot = runtime.getSnapshot()
  })

  runtime.dispose()
  runtime.setPhase('listening')

  assert.equal(aborted, true)
  assert.equal(notifications, 1)
  assert.equal(lastSnapshot?.phase, 'idle')
  assert.equal(lastSnapshot?.engine, 'none')
  assert.equal(lastSnapshot?.speechLevel, 0)
})
