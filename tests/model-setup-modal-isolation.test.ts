import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

function sliceFrom(source: string, marker: string, endMarker: string) {
  const start = source.indexOf(marker)
  const end = source.indexOf(endMarker, start + marker.length)
  assert.ok(start >= 0, `missing source marker: ${marker}`)
  assert.ok(end > start, `missing source end marker: ${endMarker}`)
  return source.slice(start, end)
}

test('App owns ModelSetupOverlay visibility and forwards the shared modal state to both panel routes', async () => {
  const [app, panel] = await Promise.all([
    read('src/app/App.tsx'),
    read('src/app/views/PanelView.tsx'),
  ])

  assert.match(app, /useState\(false\)/)
  assert.match(app, /const \[modelSetupOverlayOpen, setModelSetupOverlayOpen\]/)
  assert.match(app, /const handleModelSetupVisibilityChange = useCallback\(\(visible: boolean\) => \{[\s\S]*setModelSetupOverlayOpen\(visible\)/)
  assert.match(app, /const modelSetupOverlayActive = controller\.view === 'panel'[\s\S]*!competingModalOpen/)
  assert.match(app, /<ModelSetupOverlay\s+suppressed\s+onVisibilityChange=\{handleModelSetupVisibilityChange\}/)
  assert.match(app, /suppressed=\{competingModalOpen\}[\s\S]*onVisibilityChange=\{handleModelSetupVisibilityChange\}/)

  const panelCall = sliceFrom(app, '<PanelView', '\n      />')
  assert.match(panelCall, /modelSetupOverlayOpen=\{modelSetupOverlayActive\}/)

  const v2Call = sliceFrom(panel, '<CompanionPanelV2', '\n      />')
  const legacyCall = sliceFrom(panel, '<LegacyPanelView', '\n      />')
  assert.match(v2Call, /modelSetupOverlayOpen=\{modelSetupOverlayOpen\}/)
  assert.match(legacyCall, /modelSetupOverlayOpen=\{modelSetupOverlayOpen\}/)
  assert.match(panel, /uiV2.*!== '0'/)
})

test('V2 and legacy panel backgrounds share hasModalOverlay for model setup isolation', async () => {
  const [v2, legacy] = await Promise.all([
    read('src/features/uiV2/CompanionPanelV2.tsx'),
    read('src/app/views/LegacyPanelView.tsx'),
  ])

  assert.match(v2, /const hasModalOverlay = Boolean\(settingsDrawer\) \|\| Boolean\(onboardingGuide\) \|\| modelSetupOverlayOpen/)
  const v2Experience = sliceFrom(v2, 'className={`nexus-panel-v2__experience', '\n      >')
  assert.match(v2Experience, /aria-hidden=\{hasModalOverlay \? true : undefined\}/)
  assert.match(v2Experience, /inert=\{hasModalOverlay \? true : undefined\}/)

  assert.match(legacy, /const hasModalOverlay = Boolean\(settingsDrawer\) \|\| Boolean\(onboardingGuide\) \|\| modelSetupOverlayOpen/)
  const legacyBacking = sliceFrom(legacy, '<section\n        className={`panel-window', '\n      >')
  assert.match(legacyBacking, /aria-hidden=\{hasModalOverlay \? true : undefined\}/)
  assert.match(legacyBacking, /inert=\{hasModalOverlay \? true : undefined\}/)
})

test('ModelSetupOverlay has synchronous first focus, guarded visibility edges, and cancellable return focus', async () => {
  const source = await read('src/features/setup/components/ModelSetupOverlay.tsx')
  const focusEffect = sliceFrom(source, 'useLayoutEffect(() => {', '\n  useEffect(() => {')

  assert.match(source, /onVisibilityChange\?: \(visible: boolean\) => void/)
  assert.match(source, /useModalFocusTrap\(dialogRef, overlayVisible\)/)
  assert.match(source, /if \(event\.key === 'Escape'\)/)
  assert.match(focusEffect, /overlayVisibilityRef\.current !== overlayVisible/)
  assert.match(focusEffect, /onVisibilityChange\?\.\(overlayVisible\)/)
  assert.match(focusEffect, /activeElement !== document\.body/)
  assert.match(focusEffect, /activeElement !== document\.documentElement/)
  assert.match(focusEffect, /overlayWasVisibleRef\.current = true/)
  assert.match(source, /const dismissButtonRef = useRef<HTMLButtonElement \| null>\(null\)/)
  assert.match(source, /ref=\{dismissButtonRef\}[\s\S]*model_setup\.dismiss/)
  assert.match(focusEffect, /const focusSafeInitialTarget = \(\) => \{/)
  assert.match(focusEffect, /if \(overlayVisibilityRef\.current !== true\) return/)
  assert.match(focusEffect, /const dialog = dialogRef\.current/)
  assert.match(focusEffect, /if \(!dialog\?\.isConnected\) return/)
  assert.match(focusEffect, /dismissButton\?\.isConnected[\s\S]*!dismissButton\.disabled[\s\S]*dialog\.contains\(dismissButton\)/)
  assert.match(focusEffect, /const target = dismissButton\?\.[\s\S]*: dialog/)
  assert.match(focusEffect, /target\.focus\(\{ preventScroll: true \}\)/)
  assert.match(focusEffect, /if \(!overlayVisible && overlayWasVisibleRef\.current\)/)
  assert.match(focusEffect, /if \(suppressed\) return undefined/)
  assert.match(focusEffect, /opener\?\.isConnected[\s\S]*opener\.closest\('\[inert\], \[aria-hidden="true"\]'\)/)
  assert.match(focusEffect, /\.chat-sheet-v2__input:not\(\[disabled\]\)/)
  assert.match(focusEffect, /\.image4-composer textarea:not\(\[disabled\]\)/)
  assert.match(focusEffect, /const target = openerIsAvailable && opener \? opener : fallback/)
  assert.match(focusEffect, /target\.focus\(\{ preventScroll: true \}\)/)

  const openingEdge = sliceFrom(
    focusEffect,
    'if (overlayVisible && !overlayWasVisibleRef.current)',
    'if (overlayVisible) {',
  )
  assert.match(openingEdge, /overlayWasVisibleRef\.current = true[\s\S]*focusSafeInitialTarget\(\)/)
  assert.doesNotMatch(openingEdge, /return undefined/)

  const visibleBranch = sliceFrom(
    focusEffect,
    'if (overlayVisible) {',
    'if (!overlayVisible && overlayWasVisibleRef.current)',
  )
  assert.match(visibleBranch, /const openingFrameId = window\.requestAnimationFrame\(\(\) => \{[\s\S]*focusSafeInitialTarget\(\)/)
  assert.match(visibleBranch, /return \(\) => window\.cancelAnimationFrame\(openingFrameId\)/)
  assert.match(focusEffect, /const closingFrameId = window\.requestAnimationFrame\(\(\) => \{/)
  assert.match(focusEffect, /return \(\) => window\.cancelAnimationFrame\(closingFrameId\)/)
})
