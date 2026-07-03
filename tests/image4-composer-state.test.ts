import assert from 'node:assert/strict'
import { test } from 'node:test'

import { deriveImage4ComposerState } from '../src/app/views/image4ComposerState.ts'

test('Image4 composer state stays idle with an empty composer', () => {
  const state = deriveImage4ComposerState({
    busy: false,
    input: '   ',
    hasPendingImage: false,
    hasNotificationReply: false,
    canSendNotificationReply: false,
    voiceState: 'idle',
  })

  assert.equal(state.mode, 'idle')
  assert.equal(state.sendState, 'disabled')
  assert.equal(state.sendDisabled, true)
  assert.equal(state.hasDraft, false)
  assert.equal(state.voiceMode, 'idle')
})

test('Image4 composer state marks text draft as ready to send', () => {
  const state = deriveImage4ComposerState({
    busy: false,
    input: '今晚继续优化主对话框',
    hasPendingImage: false,
    hasNotificationReply: false,
    canSendNotificationReply: false,
    voiceState: 'idle',
  })

  assert.equal(state.mode, 'drafting')
  assert.equal(state.sendState, 'ready')
  assert.equal(state.sendDisabled, false)
  assert.equal(state.hasText, true)
})

test('Image4 composer state treats a pending image as a draft', () => {
  const state = deriveImage4ComposerState({
    busy: false,
    input: '',
    hasPendingImage: true,
    hasNotificationReply: false,
    canSendNotificationReply: false,
    voiceState: 'idle',
  })

  assert.equal(state.mode, 'drafting')
  assert.equal(state.sendState, 'ready')
  assert.equal(state.hasAttachment, true)
})

test('Image4 composer state keeps notification reply visible until reply can send', () => {
  const blocked = deriveImage4ComposerState({
    busy: false,
    input: '',
    hasPendingImage: false,
    hasNotificationReply: true,
    canSendNotificationReply: false,
    voiceState: 'idle',
  })
  const ready = deriveImage4ComposerState({
    busy: false,
    input: '收到',
    hasPendingImage: false,
    hasNotificationReply: true,
    canSendNotificationReply: true,
    voiceState: 'idle',
  })

  assert.equal(blocked.mode, 'drafting')
  assert.equal(blocked.sendState, 'disabled')
  assert.equal(blocked.sendDisabled, true)
  assert.equal(ready.mode, 'drafting')
  assert.equal(ready.sendState, 'ready')
  assert.equal(ready.sendDisabled, false)
})

test('Image4 composer state separates passive streaming from interrupted draft', () => {
  const streaming = deriveImage4ComposerState({
    busy: true,
    input: '',
    hasPendingImage: false,
    hasNotificationReply: false,
    canSendNotificationReply: false,
    voiceState: 'idle',
  })
  const interrupted = deriveImage4ComposerState({
    busy: true,
    input: '等等，换个方向',
    hasPendingImage: false,
    hasNotificationReply: false,
    canSendNotificationReply: false,
    voiceState: 'idle',
  })

  assert.equal(streaming.mode, 'streaming')
  assert.equal(streaming.sendState, 'busy')
  assert.equal(streaming.sendDisabled, true)
  assert.equal(interrupted.mode, 'interrupted')
  assert.equal(interrupted.sendState, 'busy')
  assert.equal(interrupted.sendDisabled, true)
})

test('Image4 composer state exposes voice mode without changing send readiness', () => {
  for (const voiceState of ['listening', 'processing', 'speaking'] as const) {
    const state = deriveImage4ComposerState({
      busy: false,
      input: '',
      hasPendingImage: false,
      hasNotificationReply: false,
      canSendNotificationReply: false,
      voiceState,
    })

    assert.equal(state.mode, 'idle')
    assert.equal(state.sendState, 'disabled')
    assert.equal(state.voiceMode, voiceState)
  }
})
