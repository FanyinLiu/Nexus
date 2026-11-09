import assert from 'node:assert/strict'
import test from 'node:test'

import React from 'react'

import { useCompanionNotices } from '../src/hooks/chat/useCompanionNotices.ts'
import type { CompanionNoticePayload } from '../src/hooks/chat/types.ts'
import { emitSpeechStopAll, subscribeSpeechStopAll } from '../src/features/voice/speechStopBus.ts'
import type { ChatMessage, VoiceState } from '../src/types/index.ts'

type CallbackSlot = { fn: unknown; deps?: readonly unknown[] }
type ReactInternals = { H: unknown }
const reactInternals = (React as unknown as {
  __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: ReactInternals
}).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE

/**
 * Render `useCompanionNotices` through React's dispatcher. The hook only uses
 * useRef/useCallback, so one render is enough and the returned callbacks keep
 * reading the mutable busy/voice refs the test flips between steps.
 */
function renderCompanionNotices(options: {
  busyRef: { current: boolean }
  voiceStateRef: { current: VoiceState }
}) {
  const speech: string[] = []
  const messages: ChatMessage[] = []
  const errors: string[] = []
  const slots: unknown[] = []
  let cursor = 0
  const dispatcher = {
    useRef(initial: unknown) {
      const index = cursor++
      if (!(index in slots)) slots[index] = { current: initial }
      return slots[index]
    },
    useCallback(fn: unknown, deps?: readonly unknown[]) {
      const index = cursor++
      if (!(index in slots)) slots[index] = { fn, deps }
      return (slots[index] as CallbackSlot).fn
    },
  }
  function Probe() {
    return useCompanionNotices({
      ctx: {
        speakAssistantReply: async (text: string) => { speech.push(text) },
        voiceStateRef: options.voiceStateRef,
      },
      t: (key) => String(key),
      busyRef: options.busyRef,
      appendChatMessage: (message) => { messages.push(message) },
      presentPetDialogBubble: () => undefined,
      setError: (error) => { if (error) errors.push(error) },
    })
  }

  reactInternals.H = dispatcher
  try {
    return { api: Probe(), speech, messages, errors }
  } finally {
    reactInternals.H = null
  }
}

function notice(id: string): CompanionNoticePayload {
  return {
    chatContent: `chat-${id}`,
    bubbleContent: `bubble-${id}`,
    speechContent: `speech-${id}`,
    dedupeKey: `dedupe-${id}`,
  }
}

test('notices that arrive during a reply wait for idle and keep their order', async () => {
  const busyRef = { current: true }
  const voiceStateRef = { current: 'speaking' as VoiceState }
  const { api, speech, messages } = renderCompanionNotices({ busyRef, voiceStateRef })

  await api.pushCompanionNotice(notice('a'))
  await api.pushCompanionNotice(notice('b'))
  assert.deepEqual(speech, [], 'no notice speaks over the current reply')
  assert.deepEqual(messages, [])

  await api.flushDeferredCompanionNotices()
  assert.deepEqual(speech, [], 'flush is a no-op while she is still busy')

  // Interrupt the old sentence, then the user immediately sends another turn:
  // the queue must keep waiting for that new reply.
  voiceStateRef.current = 'idle'
  busyRef.current = true
  voiceStateRef.current = 'processing'
  await api.flushDeferredCompanionNotices()
  assert.deepEqual(speech, [], 'a new reply keeps the queue waiting')

  // The new reply has finished and the pet is idle.
  busyRef.current = false
  voiceStateRef.current = 'idle'
  await api.flushDeferredCompanionNotices()

  assert.deepEqual(speech, ['speech-a', 'speech-b'], 'queued notices play once, in order')
  assert.deepEqual(messages.map((message) => message.content), ['chat-a', 'chat-b'])
})

test('an idle pet delivers a notice immediately and a later queue resumes in order', async () => {
  const busyRef = { current: false }
  const voiceStateRef = { current: 'idle' as VoiceState }
  const { api, speech } = renderCompanionNotices({ busyRef, voiceStateRef })

  await api.pushCompanionNotice(notice('first'))
  assert.deepEqual(speech, ['speech-first'])

  busyRef.current = true
  voiceStateRef.current = 'speaking'
  await api.pushCompanionNotice(notice('second'))
  await api.pushCompanionNotice(notice('third'))
  assert.deepEqual(speech, ['speech-first'])

  busyRef.current = false
  voiceStateRef.current = 'idle'
  await api.flushDeferredCompanionNotices()
  assert.deepEqual(speech, ['speech-first', 'speech-second', 'speech-third'])
})

test('the stop bus clears the hook deferred queue before it can play', async () => {
  const busyRef = { current: true }
  const voiceStateRef = { current: 'speaking' as VoiceState }
  const { api, speech } = renderCompanionNotices({ busyRef, voiceStateRef })

  await api.pushCompanionNotice(notice('kept-until-stop'))
  assert.deepEqual(speech, [])

  const unsubscribe = subscribeSpeechStopAll(api.discardDeferredCompanionNotices)
  try {
    emitSpeechStopAll()
  } finally {
    unsubscribe()
  }

  busyRef.current = false
  voiceStateRef.current = 'idle'
  await api.flushDeferredCompanionNotices()
  assert.deepEqual(speech, [], 'stopped notices must not play after idle')
})
