import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

function assertOnlyLazyLegacyImport(source: string, legacyName: string) {
  assert.match(
    source,
    new RegExp(`const ${legacyName} = lazy\\(\\(\\) => import\\(['"]\\./${legacyName}['"]\\)\\)`),
  )
  assert.equal(
    source.match(new RegExp(`import\\(['"]\\./${legacyName}['"]\\)`, 'g'))?.length,
    1,
    `${legacyName} should be loaded by exactly one local dynamic import`,
  )
  assert.doesNotMatch(
    source,
    new RegExp(`import\\s+(?:[A-Za-z_$][\\w$]*|\\{[\\s\\S]*?\\})\\s+from\\s+['"]\\./${legacyName}['"]`),
    `${legacyName} must not be statically imported by the thin route`,
  )
}

test('PanelView is a thin V2-first route and keeps legacy behavior lazy', async () => {
  const [panel, legacyPanel] = await Promise.all([
    read('src/app/views/PanelView.tsx'),
    read('src/app/views/LegacyPanelView.tsx'),
  ])

  assertOnlyLazyLegacyImport(panel, 'LegacyPanelView')
  assert.match(
    panel,
    /const useCompanionV2 = new URLSearchParams\(window\.location\.search\)\.get\('uiV2'\) !== '0'\s*&&\s*\(settings\.vtsEnabled \|\| Boolean\(petModel\.spriteAtlas\) \|\| Boolean\(petModel\.modelPath\)\)/,
  )
  assert.match(panel, /const visionEnabled = modelSupportsVision\(settings\.model\)/)
  assert.match(panel, /const \{ pendingImage, setPendingImage \} = chat/)
  assert.match(panel, /if \(!visionEnabled && pendingImage\)\s*\{\s*setPendingImage\(null\)/)
  assert.match(panel, /<CompanionPanelV2/)
  assert.match(panel, /safetyLayer=\{<CrisisHotlinePanel locale=\{settings\.uiLanguage\} \/>\}/)
  assert.match(panel, /settingsDrawer=\{settingsDrawer\}/)
  assert.match(panel, /onboardingGuide=\{onboardingGuide\}/)
  const companionPanelProps = panel.match(/<CompanionPanelV2[\s\S]*?\/>/)?.[0]
  assert.ok(companionPanelProps, 'thin PanelView should render a complete CompanionPanelV2 element')
  assert.doesNotMatch(companionPanelProps, /memory=|autonomyState=|focusState=|contextScheduler=/)
  for (const legacyOnly of [
    'useAmbientWeather',
    'useCrisisPanelState',
    'Image4PresenceHeader',
    'Live2DCanvas',
    'image4-composer',
  ]) {
    assert.doesNotMatch(panel, new RegExp(legacyOnly), `${legacyOnly} must stay out of thin PanelView`)
    assert.match(legacyPanel, new RegExp(legacyOnly), `${legacyOnly} must remain in LegacyPanelView`)
  }
  assert.match(legacyPanel, /buildImage4ChatPreviewMessages/)
})

test('PetView is a pure V2-first route and keeps legacy runtime hooks lazy', async () => {
  const [pet, legacyPet] = await Promise.all([
    read('src/app/views/PetView.tsx'),
    read('src/app/views/LegacyPetView.tsx'),
  ])

  assertOnlyLazyLegacyImport(pet, 'LegacyPetView')
  assert.match(
    pet,
    /const useCompanionV2 = new URLSearchParams\(window\.location\.search\)\.get\('uiV2'\) !== '0'\s*&&\s*!settings\.vtsEnabled\s*&&\s*!petModel\.spriteAtlas\s*&&\s*Boolean\(petModel\.modelPath\)/,
  )
  assert.match(pet, /const roamCapable = !settings\.vtsEnabled && Boolean\(petModel\.spriteAtlas\)/)
  assert.match(pet, /updatePetWindowState\?\.\(\{ roamCapable \}\)/)
  assert.match(pet, /\}, \[roamCapable\]\)/)
  assert.match(pet, /const hasModalOverlay = Boolean\(settingsDrawer\) \|\| Boolean\(onboardingGuide\)/)
  assert.match(
    pet,
    /<div aria-hidden=\{hasModalOverlay \? true : undefined\} inert=\{hasModalOverlay \? true : undefined\}>[\s\S]*?<FramelessCompanionSurface[\s\S]*?paused=\{hasModalOverlay\}/,
  )
  assert.match(pet, /modalOpen=\{hasModalOverlay\}/)
  assert.match(pet, /\{settingsDrawer\}\s*\{onboardingGuide\}/)
  for (const legacyOnly of [
    'useVTSBridge',
    'useAmbientWeather',
    'useSpeechLevelSnapshot',
    'subscribePetWindowState',
    'RAIL_COLLAPSE_DELAY_MS',
    'PetMicBars',
    'SpritePetCanvas',
  ]) {
    assert.doesNotMatch(pet, new RegExp(legacyOnly), `${legacyOnly} must stay out of thin PetView`)
    assert.match(legacyPet, new RegExp(legacyOnly), `${legacyOnly} must remain in LegacyPetView`)
  }
  assert.match(legacyPet, /data-settings-opener="true"/)
  assert.match(legacyPet, /modalOpen: boolean/)
  assert.match(legacyPet, /paused=\{modalOpen\}/)
  const legacySection = legacyPet.match(/<section[\s\S]*?>/)?.[0]
  assert.ok(legacySection, 'LegacyPetView should render one pet-window section')
  assert.match(legacySection, /className="pet-window"/)
  assert.match(legacySection, /aria-hidden=\{modalOpen \? true : undefined\}/)
  assert.match(legacySection, /inert=\{modalOpen \? true : undefined\}/)
  assert.doesNotMatch(legacyPet, /desktop-pet-root|settingsDrawer|onboardingGuide/)
  assert.doesNotMatch(legacyPet, /<FramelessCompanionSurface/)
})
