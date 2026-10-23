import assert from 'node:assert/strict'
import test from 'node:test'

import {
  consumePanelSectionIntent,
  initialPanelSectionState,
  panelChatIntentDecision,
  panelSectionSnapshot,
  requestPanelSection,
} from '../shared/panelSectionIntent.js'

test('the section event and the mount catch-up share one token and open chat once', () => {
  let state = requestPanelSection(initialPanelSectionState(), 'chat-text')
  const event = panelSectionSnapshot(state)
  const catchUp = panelSectionSnapshot(state)
  state = consumePanelSectionIntent(state)

  assert.equal(event.intent, 'text')
  assert.equal(event.intentToken, 1)
  assert.deepEqual(catchUp, event)
  assert.equal(panelSectionSnapshot(state).intent, null)
  assert.equal(panelSectionSnapshot(state).intentToken, 0)

  const first = panelChatIntentDecision(0, event)
  assert.equal(first.open, true)
  const duplicate = panelChatIntentDecision(first.appliedToken, catchUp)
  assert.equal(duplicate.open, false)
  assert.equal(duplicate.appliedToken, first.appliedToken)
  const cleared = panelChatIntentDecision(duplicate.appliedToken, panelSectionSnapshot(state))
  assert.equal(cleared.open, false)
})

test('a later text request still opens chat after the first one was closed', () => {
  let state = consumePanelSectionIntent(requestPanelSection(initialPanelSectionState(), 'chat-text'))
  const first = panelChatIntentDecision(0, { intent: 'text', intentToken: 1 })
  state = requestPanelSection(state, 'chat-text')
  const again = panelSectionSnapshot(state)
  const second = panelChatIntentDecision(first.appliedToken, again)

  assert.equal(again.intentToken, 2)
  assert.equal(second.open, true)
  assert.equal(second.appliedToken, 2)
})

test('recent is one-shot too, and settings does not invent a chat token', () => {
  let state = requestPanelSection(initialPanelSectionState(), 'chat-recent')
  const recent = panelSectionSnapshot(state)
  const opened = panelChatIntentDecision(0, recent)
  const repeated = panelChatIntentDecision(opened.appliedToken, recent)
  state = requestPanelSection(consumePanelSectionIntent(state), 'settings')
  const settings = panelSectionSnapshot(state)

  assert.equal(recent.intent, 'recent')
  assert.equal(repeated.open, false)
  assert.equal(settings.section, 'settings')
  assert.equal(settings.intent, null)
  assert.equal(settings.intentToken, 0)
  assert.equal(panelChatIntentDecision(opened.appliedToken, settings).open, false)
  assert.equal(panelChatIntentDecision(opened.appliedToken, null).open, false)
})
