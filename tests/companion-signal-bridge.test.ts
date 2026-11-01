import assert from 'node:assert/strict'
import { register } from 'node:module'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { AppSettings } from '../src/types'

register(new URL('./helpers/tsx-test-loader.mjs', import.meta.url))
const { useCompanionSignalBridge } = await import('../src/app/controllers/useCompanionSignalBridge.ts')

type Bridge = ReturnType<typeof useCompanionSignalBridge>

const minimalSettings = { uiLanguage: 'zh-CN' } as unknown as AppSettings

// Server rendering never commits effects, so the bridge is observed in its
// pre-install state — exactly the state useChat sees on the very first render.
function renderBridge(): Bridge {
  const settingsRef = { current: minimalSettings }
  let captured: Bridge | null = null
  function BridgeProbe() {
    captured = useCompanionSignalBridge({ settingsRef })
    return null
  }
  renderToStaticMarkup(React.createElement(BridgeProbe))
  assert.ok(captured)
  return captured
}

test('the companion signal bridge exposes the full stable deps surface', () => {
  const bridge = renderBridge()
  assert.deepEqual(Object.keys(bridge.companionSignals).sort(), [
    'commitOnThisDayPromptText',
    'consumeAnniversaryPromptText',
    'consumeMessageFollowUpPromptText',
    'consumeMilestonePromptText',
    'consumeOnThisDayPromptText',
    'getAffectGuidancePromptText',
    'getEmotionAttitudeText',
    'getEmotionPromptText',
    'getEmotionSnapshot',
    'getRelationshipPromptText',
    'getRhythmPromptText',
    'onAssistantReplyDelivered',
    'onAssistantReplyFailed',
    'onUserMoodSignal',
  ])
})

test('an uninstalled bridge yields empty defaults and swallows callbacks', () => {
  const { companionSignals } = renderBridge()
  assert.equal(companionSignals.getEmotionPromptText(), '')
  assert.equal(companionSignals.getRelationshipPromptText(), '')
  assert.equal(companionSignals.getRhythmPromptText(), '')
  assert.equal(companionSignals.consumeMilestonePromptText(), '')
  assert.equal(companionSignals.consumeMessageFollowUpPromptText(), '')
  assert.equal(companionSignals.getEmotionSnapshot(), undefined)
  assert.doesNotThrow(() => companionSignals.onAssistantReplyFailed())
  assert.doesNotThrow(() => companionSignals.onAssistantReplyDelivered({
    source: 'text',
    displayText: 'hello',
    spokenText: 'hello',
  }))
})

test('the prompt wrapper reads through the getter ref', () => {
  const bridge = renderBridge()
  bridge.emotionPromptGetterRef.current = () => 'X'
  assert.equal(bridge.companionSignals.getEmotionPromptText(), 'X')
})
