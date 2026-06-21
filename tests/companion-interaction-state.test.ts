import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildQuietObservationSummary } from '../src/features/context/companionAwareness.ts'
import { createNexusInteractionState } from '../src/features/context/companionInteractionState.ts'

test('Nexus interaction state suppresses quiet observation after direct interaction', () => {
  const timestamps = [
    '2026-06-21T17:00:30.000Z',
    '2026-06-21T17:10:00.000Z',
  ]
  const interactionState = createNexusInteractionState(
    '2026-06-21T17:00:00.000Z',
    () => timestamps.shift() ?? '2026-06-21T17:10:00.000Z',
  )

  assert.equal(interactionState.nexusOpenSince, '2026-06-21T17:00:00.000Z')
  assert.equal(interactionState.markNexusInteraction(), '2026-06-21T17:00:30.000Z')

  assert.equal(buildQuietObservationSummary({
    enabled: true,
    nexusOpenSince: interactionState.nexusOpenSince,
    lastNexusInteractionAt: interactionState.getLastNexusInteractionAt(),
    now: '2026-06-21T17:01:30.000Z',
    activeWindowTitle: 'main.ts - Visual Studio Code',
    uiLanguage: 'zh-CN',
  }), null)

  assert.equal(interactionState.markNexusInteraction(), '2026-06-21T17:10:00.000Z')
  const summary = buildQuietObservationSummary({
    enabled: true,
    nexusOpenSince: interactionState.nexusOpenSince,
    lastNexusInteractionAt: interactionState.getLastNexusInteractionAt(),
    now: '2026-06-21T17:45:00.000Z',
    activeWindowTitle: 'main.ts - Visual Studio Code',
    uiLanguage: 'zh-CN',
  })

  assert.equal(summary?.elapsedLabel, '半小时左右')
  assert.equal(summary?.activeElsewhere, true)
  assert.equal(summary?.shouldStaySilent, true)
})

test('Nexus interaction state does not carry interaction timestamps across app sessions', () => {
  const previousSession = createNexusInteractionState(
    '2026-06-21T15:00:00.000Z',
    () => '2026-06-21T16:59:30.000Z',
  )
  previousSession.markNexusInteraction()

  const currentSession = createNexusInteractionState('2026-06-21T17:00:00.000Z')

  assert.equal(currentSession.nexusOpenSince, '2026-06-21T17:00:00.000Z')
  assert.equal(currentSession.getLastNexusInteractionAt(), '2026-06-21T17:00:00.000Z')
})
