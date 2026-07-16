import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const panelSource = readFileSync(new URL('../src/app/views/PanelView.tsx', import.meta.url), 'utf8')
const petSource = readFileSync(new URL('../src/app/views/PetView.tsx', import.meta.url), 'utf8')
const legacyPanelSource = readFileSync(new URL('../src/app/views/LegacyPanelView.tsx', import.meta.url), 'utf8')
const legacyPetSource = readFileSync(new URL('../src/app/views/LegacyPetView.tsx', import.meta.url), 'utf8')
const windowSettingsSource = readFileSync(new URL('../src/features/settingsV3/WindowSectionV3.tsx', import.meta.url), 'utf8')
const settingsRouterSource = readFileSync(new URL('../src/components/SettingsDrawerActiveSection.tsx', import.meta.url), 'utf8')
const toolsSettingsSource = readFileSync(new URL('../src/features/settingsV3/ToolsSectionV3.tsx', import.meta.url), 'utf8')

test('V2 companion paths suppress legacy ambient weather polling and scene clocks', () => {
  for (const [name, source] of [['panel', panelSource], ['pet', petSource]] as const) {
    assert.match(source, /const useCompanionV2 = new URLSearchParams\(window\.location\.search\)/)
    assert.doesNotMatch(
      source,
      /useAmbientWeather|setInterval\(update, 60 \* 1000\)/,
      `${name} thin route must not own legacy environment work`,
    )
  }
  assert.match(legacyPanelSource, /const ambientWeather = useAmbientWeather\(/)
  assert.match(legacyPetSource, /const ambientWeather = useAmbientWeather\(/)
  assert.match(legacyPanelSource, /window\.setInterval\(update, 60 \* 1000\)/)
  assert.match(legacyPetSource, /window\.setInterval\(update, 60 \* 1000\)/)
})

test('Window Settings V3 keeps legacy environment controls behind an explicit route guard', () => {
  for (const legacyControl of [
    'petSceneLocation',
    'petWeatherPreview',
    'petTimePreview',
    'ambientWeatherEnabled',
    'toolWeatherDefaultLocation',
  ]) {
    assert.match(windowSettingsSource, new RegExp(legacyControl))
  }

  assert.match(windowSettingsSource, /showLegacyEnvironmentControls\s*\?\s*\(/)
  assert.match(
    settingsRouterSource,
    /const supportsPanelCompanionV2 = draft\.vtsEnabled \|\| Boolean\(petModel\.spriteAtlas\) \|\| Boolean\(petModel\.modelPath\)/,
  )
  assert.match(
    settingsRouterSource,
    /const supportsPetCompanionV2 = !draft\.vtsEnabled && !petModel\.spriteAtlas && Boolean\(petModel\.modelPath\)/,
  )
  assert.match(
    settingsRouterSource,
    /const supportsCompanionV2 = isPetView \? supportsPetCompanionV2 : supportsPanelCompanionV2/,
  )
  assert.match(
    settingsRouterSource,
    /const showLegacyEnvironmentControls = routeParams\.get\('uiV2'\) === '0' \|\| !supportsCompanionV2/,
  )
  assert.match(settingsRouterSource, /showLegacyEnvironmentControls=\{showLegacyEnvironmentControls\}/)
  assert.match(windowSettingsSource, /launchOnStartup/)
  assert.match(windowSettingsSource, /isPinned/)
  assert.match(windowSettingsSource, /clickThrough/)
})

test('active Tools Settings V3 owns one weather city entry and explains its network boundary', () => {
  assert.equal((toolsSettingsSource.match(/value=\{draft\.toolWeatherDefaultLocation\}/g) ?? []).length, 1)
  assert.equal((toolsSettingsSource.match(/toolWeatherDefaultLocation: event\.target\.value/g) ?? []).length, 1)
  assert.match(toolsSettingsSource, /settings\.tools\.weather_privacy_title/)
  assert.match(toolsSettingsSource, /settings\.tools\.weather_privacy_note/)
})
