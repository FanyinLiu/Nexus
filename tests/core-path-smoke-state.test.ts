import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isSettingsEntryReady, isV2PanelReady } from '../scripts/core-path-smoke-state.cjs'

const v2Panel = {
  panelSurface: 'v2',
  hasV2Root: true,
  hasV2Stage: true,
  hasV2Utility: true,
  panelWidth: 300,
  panelHeight: 600,
}

test('the V2 panel is ready once its stage, utility button and size are there', () => {
  assert.equal(isV2PanelReady(v2Panel), true)
  assert.equal(isV2PanelReady({ ...v2Panel, hasV2Stage: false }), false)
  assert.equal(isV2PanelReady({ ...v2Panel, hasV2Utility: false }), false)
  assert.equal(isV2PanelReady({ ...v2Panel, panelWidth: 200 }), false)
  assert.equal(isV2PanelReady({ ...v2Panel, panelHeight: 400 }), false)
})

test('the legacy panel is ready once its chat parts are there', () => {
  const legacy = {
    panelSurface: 'legacy',
    hasRoot: true,
    hasPanel: true,
    hasToolbar: true,
    hasSettingsButton: true,
    hasComposer: true,
    hasSendButton: true,
    panelWidth: 300,
    panelHeight: 600,
  }
  assert.equal(isV2PanelReady(legacy), true)
  assert.equal(isV2PanelReady({ ...legacy, hasComposer: false }), false)
  assert.equal(isV2PanelReady({ ...legacy, hasSendButton: false }), false)
})

test('the settings drawer is ready on the V2 home and on the V2 connect page', () => {
  assert.equal(isSettingsEntryReady({
    hasSettingsDrawer: true,
    hasSettingsV2: true,
    hasSettingsV2Home: true,
    hasSettingsV2AdvancedCard: true,
  }), true)
  assert.equal(isSettingsEntryReady({
    hasSettingsDrawer: true,
    hasSettingsV2: true,
    settingsV2Destination: 'connect',
    hasV2ModelContent: true,
  }), true)
  assert.equal(isSettingsEntryReady({
    hasSettingsDrawer: true,
    hasSettingsV2: true,
    settingsV2Destination: 'voice',
    hasV2ModelContent: true,
  }), false)
})

test('the legacy settings home is ready when the drawer shows its model card', () => {
  assert.equal(isSettingsEntryReady({
    hasSettingsDrawer: true,
    hasSettingsHome: true,
    hasModelCard: true,
  }), true)
  assert.equal(isSettingsEntryReady({
    hasSettingsDrawer: true,
    hasSettingsHome: true,
    hasModelCard: false,
  }), false)
  assert.equal(isSettingsEntryReady({
    hasSettingsHome: true,
    hasModelCard: true,
  }), false)
})
