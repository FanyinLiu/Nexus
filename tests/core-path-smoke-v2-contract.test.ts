import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const readSmoke = () => readFile(new URL('../scripts/core-path-smoke.cjs', import.meta.url), 'utf8')

test('core path smoke verifies V2 first and keeps legacy fallback', async () => {
  const source = await readSmoke()

  for (const selector of [
    '.nexus-panel-v2',
    '.nexus-panel-v2__stage',
    '.nexus-panel-v2__utility[data-settings-opener="true"]',
    '.nexus-panel-v2__menu',
    '.chat-sheet-v2',
    '.chat-sheet-v2__input',
    '.chat-sheet-v2__send',
    '.chat-sheet-v2__back',
  ]) {
    assert.match(source, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }

  assert.match(source, /state\.panelSurface === 'v2'/)
  assert.match(source, /state\.hasV2Root\s*&&\s*state\.hasV2Stage\s*&&\s*state\.hasV2Utility/)
  assert.match(source, /\.nexus-panel-v2__menu button:first-of-type/)
  assert.match(source, /\.nexus-panel-v2__menu button:nth-of-type\(2\)/)
  assert.match(source, /\.chat-sheet-v2__back/)
  assert.match(source, /\.settings-v2__home-card:last-of-type/)
  assert.match(source, /data-settings-v2-destination/)
  assert.match(source, /settings-model-section\.is-active/)
  assert.match(source, /settings-v3-page/)
  assert.match(source, /settings-v3-toolbar button/)
  assert.match(source, /!element\.disabled/)
  assert.match(source, /getComputedStyle\(element\)/)

  assert.match(source, /\.desktop-pet-root--panel/)
  assert.match(source, /\.panel-window__header-actions--hero \.panel-window__icon-button/)
  assert.match(source, /\.companion-chat__composer textarea/)
  assert.match(source, /\.composer__actions \.primary-button/)
  assert.doesNotMatch(source, /querySelector\([^)]*mic|querySelector\([^)]*voice/i)
  assert.match(source, /panelSurface: panelReady\.panelSurface/)
  assert.match(source, /chatEntry,/)
})
