/**
 * A reminder whose playback fails must stay log-only: the chat line and the
 * bubble survive, no error surfaces, and the diagnostic log carries no
 * reminder text. The test drives the real controller and the real
 * companion-notice hook through the shared reminder controller harness, so the
 * log line under assertion is the production one.
 *
 * Only synthetic marker copy is used; every assertion checks that a marker
 * never appears rather than printing user content.
 */

import assert from 'node:assert/strict'
import { register } from 'node:module'
import { test } from 'node:test'

import type { ReminderTask } from '../src/types/index.ts'

register(new URL('./helpers/bundler-import-hooks.mjs', import.meta.url))

const { createControllerSession, makeTask } = await import('./helpers/reminderControllerHarness.ts')

test('a failed reminder playback log never carries the reminder text', async () => {
  const REMINDER_TITLE = 'SYNTH-R2-TITLE-7f3a'
  const REMINDER_TEXT = 'SYNTH-R2-BODY-c91d remember to stretch'
  const REMINDER_SPEECH = 'SYNTH-R2-SPEECH-4be2 time to stretch'
  const task: ReminderTask = {
    ...makeTask(),
    title: REMINDER_TITLE,
    prompt: REMINDER_TEXT,
    speechText: REMINDER_SPEECH,
  }
  const warnings: string[] = []
  const originalWarn = console.warn
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')) }
  const session = createControllerSession({
    speakAssistantReply: async () => { throw new Error('synthetic playback failure') },
    // Interpolate reported params so a leaked chat line exposes the reminder copy.
    t: (key, params) => `${key} ${Object.values(params ?? {}).join(' ')}`.trim(),
  })
  try {
    await session.trigger(task)
    const failureLogs = warnings.filter((line) => line.includes('[companionNotice] speech playback failed:'))
    assert.equal(failureLogs.length, 1, 'the failed notice playback is still log-only')
    for (const line of failureLogs) {
      for (const text of [REMINDER_TITLE, REMINDER_TEXT, REMINDER_SPEECH]) {
        assert.ok(!line.includes(text), `the playback log must not carry reminder text: ${text}`)
      }
    }
  } finally {
    session.unmount()
    console.warn = originalWarn
  }
})
