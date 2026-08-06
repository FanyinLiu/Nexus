import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createCompanionPresenceTracker } from '../electron/companionPresenceTracker.js'
import { sanitizeRuntimeStatePatch } from '../electron/windowStateSanitizers.js'
import { validateRuntimeStateUpdatePayload } from '../electron/ipc/windowPayloadSchemas.js'
import { buildRuntimeStateSnapshot, updateRuntimeState } from '../electron/windowRuntimeState.js'
import {
  COMPANION_PRESENCE_PHASES,
  RUNTIME_STATE_MAIN_ONLY_FIELDS,
  RUNTIME_STATE_SNAPSHOT_FIELD_NAMES,
} from '../shared/runtimeStateSnapshot.js'
import { RUNTIME_STATE_FIELD_NAMES } from '../shared/runtimeStateFields.js'
import { DEFAULT_RUNTIME_SNAPSHOT } from '../src/app/controllers/desktopBridgeDefaults.ts'

const VALID_PRESENCE = {
  phase: 'thinking',
  mood: 'curious',
  activeTaskLabel: 'review',
  reason: 'NEXUS_ERR_CHAT_EMPTY_CONTENT',
  updatedAt: '2026-08-06T00:00:00.000Z',
}

function createRecordingTracker() {
  const published: Array<Record<string, unknown>> = []
  const tracker = createCompanionPresenceTracker({
    publishPresence: (presence: Record<string, unknown>) => published.push(presence),
    getMood: () => 'happy',
    nowIso: () => '2026-08-06T00:00:00.000Z',
  })
  return { published, tracker }
}

test('snapshot field inventory is the 20 patchable fields plus 6 main-only fields', () => {
  assert.equal(RUNTIME_STATE_FIELD_NAMES.length, 20)
  assert.deepEqual([...RUNTIME_STATE_MAIN_ONLY_FIELDS], [
    'companionPresence',
    'petOnline',
    'panelOnline',
    'petLastSeenAt',
    'panelLastSeenAt',
    'updatedAt',
  ])
  assert.deepEqual(
    [...RUNTIME_STATE_SNAPSHOT_FIELD_NAMES],
    [...RUNTIME_STATE_FIELD_NAMES, ...RUNTIME_STATE_MAIN_ONLY_FIELDS],
  )
  assert.equal(RUNTIME_STATE_SNAPSHOT_FIELD_NAMES.length, 26)
  const overlap = RUNTIME_STATE_FIELD_NAMES.filter((name) =>
    (RUNTIME_STATE_MAIN_ONLY_FIELDS as readonly string[]).includes(name))
  assert.deepEqual(overlap, [])
})

test('companion presence phase tuple keeps the 9-phase contract', () => {
  assert.deepEqual([...COMPANION_PRESENCE_PHASES], [
    'idle',
    'online',
    'thinking',
    'speaking',
    'listening',
    'resting',
    'waiting',
    'error',
    'offline',
  ])
})

test('renderer bridge defaults omit exactly the three not-yet-computed optional fields', () => {
  const keys = Object.keys(DEFAULT_RUNTIME_SNAPSHOT)
  assert.equal(keys.length, 23)
  for (const key of keys) {
    assert.ok(
      (RUNTIME_STATE_SNAPSHOT_FIELD_NAMES as readonly string[]).includes(key),
      `default snapshot field ${key} must be part of the snapshot contract`,
    )
  }
  const omitted = RUNTIME_STATE_SNAPSHOT_FIELD_NAMES.filter((name) => !keys.includes(name))
  assert.deepEqual([...omitted].sort(), ['companionPresence', 'hearingEngine', 'hearingPhase'])
})

test('presence tracker maps the chat request lifecycle onto phases', () => {
  const { published, tracker } = createRecordingTracker()

  tracker.begin()
  assert.deepEqual(published.at(-1), {
    phase: 'thinking',
    mood: 'happy',
    updatedAt: '2026-08-06T00:00:00.000Z',
  })

  tracker.succeed()
  assert.equal(published.at(-1)?.phase, 'idle')

  tracker.begin()
  tracker.fail('offline', 'NEXUS_ERR_CHAT_UNREACHABLE')
  assert.deepEqual(published.at(-1), {
    phase: 'offline',
    mood: 'happy',
    reason: 'NEXUS_ERR_CHAT_UNREACHABLE',
    updatedAt: '2026-08-06T00:00:00.000Z',
  })

  // The failure is sticky: nothing republishes until the next lifecycle event.
  tracker.begin()
  assert.equal(published.at(-1)?.phase, 'thinking')
  tracker.fail('error', 'NEXUS_ERR_CHAT_EMPTY_CONTENT')
  assert.equal(published.at(-1)?.phase, 'error')

  // One success proves reachability again and clears the sticky failure.
  tracker.begin()
  tracker.succeed()
  assert.equal(published.at(-1)?.phase, 'idle')
})

test('presence tracker coalesces overlapping requests and treats abort as neutral', () => {
  const { published, tracker } = createRecordingTracker()

  tracker.begin()
  tracker.begin()
  assert.equal(published.filter((entry) => entry.phase === 'thinking').length, 1)

  // A failure while another request is in flight stays hidden behind
  // 'thinking' until the last request winds down.
  tracker.fail('offline', 'NEXUS_ERR_CHAT_UNREACHABLE')
  assert.equal(published.at(-1)?.phase, 'thinking')
  tracker.cancel()
  assert.equal(published.at(-1)?.phase, 'offline')

  // Abort without a recorded failure returns to neutral, never to 'error'.
  tracker.succeed()
  tracker.begin()
  tracker.cancel()
  assert.equal(published.at(-1)?.phase, 'idle')

  for (const entry of published) {
    assert.ok(
      (COMPANION_PRESENCE_PHASES as readonly string[]).includes(String(entry.phase)),
      `tracker emitted unknown phase ${String(entry.phase)}`,
    )
  }
})

test('sanitizeRuntimeStatePatch passes a valid companion presence object', () => {
  const out = sanitizeRuntimeStatePatch({
    mood: 'happy',
    companionPresence: { ...VALID_PRESENCE, unknownNested: 'drop' },
  })

  assert.deepEqual({ ...(out as Record<string, unknown>) }, {
    mood: 'happy',
    companionPresence: VALID_PRESENCE,
  })
})

test('sanitizeRuntimeStatePatch drops malformed companion presence values', () => {
  assert.equal(sanitizeRuntimeStatePatch({ companionPresence: 'thinking' }).companionPresence, undefined)
  assert.equal(
    sanitizeRuntimeStatePatch({ companionPresence: { ...VALID_PRESENCE, phase: 'bogus' } }).companionPresence,
    undefined,
  )
  assert.equal(
    sanitizeRuntimeStatePatch({ companionPresence: { phase: 'idle', updatedAt: 'x' } }).companionPresence,
    undefined,
  )
})

test('sanitizeRuntimeStatePatch clamps companion presence strings', () => {
  const out = sanitizeRuntimeStatePatch({
    companionPresence: { ...VALID_PRESENCE, reason: 'x'.repeat(300) },
  })
  const presence = (out as Record<string, { reason: string }>).companionPresence
  assert.equal(presence.reason.length, 256)
})

test('IPC runtime-state update schema accepts and normalizes companion presence', () => {
  assert.deepEqual(
    validateRuntimeStateUpdatePayload({
      companionPresence: { ...VALID_PRESENCE, unknownNested: 'drop' },
    }),
    { companionPresence: VALID_PRESENCE },
  )

  assert.throws(
    () => validateRuntimeStateUpdatePayload({
      companionPresence: { ...VALID_PRESENCE, phase: 'bogus' },
    }),
    /Invalid IPC payload for runtime-state:update/,
  )
  assert.throws(
    () => validateRuntimeStateUpdatePayload({
      companionPresence: { phase: 'idle', updatedAt: 'x' },
    }),
    /Invalid IPC payload for runtime-state:update/,
  )
})

test('main-originated presence flows through updateRuntimeState into the broadcast snapshot', () => {
  // Before any chat lifecycle event the field is legitimately absent, and the
  // snapshot keys stay a subset of the shared contract tuple.
  const initialKeys = Object.keys(buildRuntimeStateSnapshot())
  assert.equal(initialKeys.length, 23)
  for (const key of initialKeys) {
    assert.ok((RUNTIME_STATE_SNAPSHOT_FIELD_NAMES as readonly string[]).includes(key))
  }

  const tracker = createCompanionPresenceTracker({
    publishPresence: (presence: Record<string, unknown>) => updateRuntimeState({ companionPresence: presence }),
    getMood: () => buildRuntimeStateSnapshot().mood,
    nowIso: () => '2026-08-06T00:00:00.000Z',
  })

  tracker.begin()
  assert.deepEqual(buildRuntimeStateSnapshot().companionPresence, {
    phase: 'thinking',
    mood: 'idle',
    updatedAt: '2026-08-06T00:00:00.000Z',
  })

  tracker.fail('offline', 'NEXUS_ERR_CHAT_UNREACHABLE')
  assert.deepEqual(buildRuntimeStateSnapshot().companionPresence, {
    phase: 'offline',
    mood: 'idle',
    reason: 'NEXUS_ERR_CHAT_UNREACHABLE',
    updatedAt: '2026-08-06T00:00:00.000Z',
  })

  // The sanitizer is the gate for every patch — malformed presence never
  // reaches the snapshot even when pushed through the internal entry point.
  updateRuntimeState({ companionPresence: { phase: 'bogus' } })
  assert.deepEqual(buildRuntimeStateSnapshot().companionPresence, {
    phase: 'offline',
    mood: 'idle',
    reason: 'NEXUS_ERR_CHAT_UNREACHABLE',
    updatedAt: '2026-08-06T00:00:00.000Z',
  })

  // The same presence object passes the renderer-facing IPC validator, so the
  // two main-side gates agree on the field.
  const validated = validateRuntimeStateUpdatePayload({ companionPresence: VALID_PRESENCE })
  assert.deepEqual(validated, { companionPresence: VALID_PRESENCE })
})
