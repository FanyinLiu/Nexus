import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const readSource = (url: URL) => readFileSync(url, 'utf8').replace(/\r\n?/g, '\n')
const appCss = readSource(new URL('../src/app/App.css', import.meta.url))
const appSource = readSource(new URL('../src/app/App.tsx', import.meta.url))
const panelSceneCss = readSource(new URL('../src/features/panelScene/panel-scene.css', import.meta.url))
const panelSceneIndex = readSource(new URL('../src/features/panelScene/index.ts', import.meta.url))
const legacyPanelSource = readSource(new URL('../src/app/views/LegacyPanelView.tsx', import.meta.url))
const legacyPetSource = readSource(new URL('../src/app/views/LegacyPetView.tsx', import.meta.url))

test('legacy panel scene owns one lazy feature CSS boundary', () => {
  assert.match(panelSceneIndex, /^import '\.\/panel-scene\.css'\n/)
  assert.doesNotMatch(appSource, /panel-scene\.css/)
  assert.match(legacyPanelSource, /from '\.\.\/\.\.\/features\/panelScene'/)
  assert.match(legacyPetSource, /from '\.\.\/\.\.\/features\/panelScene'/)
})

test('panel scene CSS keeps the complete weather and time-of-day contract', () => {
  for (const selector of [
    '.panel-scene-layer',
    '.weather-ambient',
    '.weather-ambient--rain',
    '.weather-ambient--heavy_snow',
    '.weather-ambient--gale',
    '.scene-sunlight',
    '.scene-backdrop',
    '.scene-backdrop__art',
  ]) {
    assert.match(panelSceneCss, new RegExp(`(^|\\n)${selector.replaceAll('.', '\\.')}[\\s.{:-]`), `missing ${selector}`)
  }

  assert.equal((panelSceneCss.match(/@keyframes weather-/g) ?? []).length, 12)
  assert.equal((panelSceneCss.match(/@media \(prefers-reduced-motion: reduce\)/g) ?? []).length, 2)
  assert.match(panelSceneCss, /html\[data-theme='warm-day'\] \.panel-scene-layer \.scene-backdrop/)
})

test('App.css no longer duplicates the scene feature while retaining toolbar weather UI', () => {
  assert.doesNotMatch(appCss, /(^|\n)\.panel-scene-layer(?:\s|\.|\{|__)/)
  assert.doesNotMatch(appCss, /(^|\n)\.weather-ambient(?:\s|\.|\{|--|__)/)
  assert.doesNotMatch(appCss, /(^|\n)\.scene-(?:sunlight|backdrop)(?:\s|\.|\{|--|__)/)
  assert.doesNotMatch(appCss, /@keyframes weather-/)
  assert.match(appCss, /(^|\n)\.ambient-weather-chip \{/)
  assert.match(appCss, /\.companion-chat__toolbar \.ambient-weather-chip/)
})
