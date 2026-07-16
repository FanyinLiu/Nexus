import assert from 'node:assert/strict'
import test from 'node:test'
import { getSettingsTabScrollLeft } from '../src/features/uiV2/settingsTabScroll.ts'

test('settings tab scroll helper reveals a tab clipped on the left', () => {
  assert.equal(getSettingsTabScrollLeft({
    navScrollLeft: 120,
    navClientWidth: 240,
    tabOffsetLeft: 80,
    tabWidth: 60,
  }), 80)
})

test('settings tab scroll helper reveals a tab clipped on the right', () => {
  assert.equal(getSettingsTabScrollLeft({
    navScrollLeft: 120,
    navClientWidth: 240,
    tabOffsetLeft: 330,
    tabWidth: 80,
  }), 170)
})

test('settings tab scroll helper leaves an already visible tab alone', () => {
  assert.equal(getSettingsTabScrollLeft({
    navScrollLeft: 120,
    navClientWidth: 240,
    tabOffsetLeft: 180,
    tabWidth: 80,
  }), 120)
})
