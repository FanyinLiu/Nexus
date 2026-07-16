import assert from 'node:assert/strict'
import { readFile as readFileRaw } from 'node:fs/promises'
import test from 'node:test'

function readFile(path: URL, encoding: 'utf8') {
  return readFileRaw(path, encoding).then((source) => source.replace(/\r\n?/g, '\n'))
}

const panelViewPath = new URL('../src/app/views/LegacyPanelView.tsx', import.meta.url)
const panelStylesPath = new URL('../src/app/styles/panel-companion-final.css', import.meta.url)
const panelV2StylesPath = new URL('../src/features/uiV2/panel-v2.css', import.meta.url)
const framelessStylesPath = new URL('../src/features/uiV2/companion-v2.css', import.meta.url)
const companionPanelV2Path = new URL('../src/features/uiV2/CompanionPanelV2.tsx', import.meta.url)
const framelessSurfacePath = new URL('../src/features/uiV2/FramelessCompanionSurface.tsx', import.meta.url)
const settingsVoiceSectionPath = new URL('../src/features/settingsV3/VoiceSectionV3.tsx', import.meta.url)
const petViewPath = new URL('../src/app/views/PetView.tsx', import.meta.url)
const optimizationPlanPath = new URL('../docs/V0.4.3_OPTIMIZATION_AND_COMPETITOR_PLAN_2026-07-12.md', import.meta.url)
const chatSheetStylesPath = new URL('../src/features/uiV2/chat-sheet-v2.css', import.meta.url)
const appStylesPath = new URL('../src/app/App.css', import.meta.url)
const windowManagerPath = new URL('../electron/windowManager.js', import.meta.url)

test('panel window and root surfaces remain fully transparent', async () => {
  const [windowManager, panelV2Styles, chatSheetStyles, appStyles] = await Promise.all([
    readFile(windowManagerPath, 'utf8'),
    readFile(panelV2StylesPath, 'utf8'),
    readFile(chatSheetStylesPath, 'utf8'),
    readFile(appStylesPath, 'utf8'),
  ])

  const panelWindowOptions = windowManager.match(
    /export function createPanelWindow\(\)[\s\S]*?const win = new BrowserWindow\(\{([\s\S]*?)\n {2}\}\)/,
  )?.[1]
  assert.ok(panelWindowOptions, 'panel BrowserWindow options should remain explicit')
  assert.match(panelWindowOptions, /show:\s*false,\s*\n\s*paintWhenInitiallyHidden:\s*false/)
  assert.match(panelWindowOptions, /transparent:\s*true/)
  assert.match(panelWindowOptions, /hasShadow:\s*false/)
  assert.match(panelWindowOptions, /backgroundColor:\s*'#00000000'/)

  const petWindowOptions = windowManager.match(
    /function petWindowConstructorOptions\([^)]*\)\s*\{[\s\S]*?return \{([\s\S]*?)\n {2}\}\n\}/,
  )?.[1]
  assert.ok(petWindowOptions, 'pet BrowserWindow options should remain explicit')
  assert.match(petWindowOptions, /show:\s*false,\s*\n\s*paintWhenInitiallyHidden:\s*false/)
  assert.doesNotMatch(windowManager, /backgroundThrottling:\s*false/)

  const panelV2Root = panelV2Styles.match(/\.nexus-panel-v2\s*\{([\s\S]*?)\n\}/)?.[1]
  assert.ok(panelV2Root, 'the V2 panel root should remain explicit')
  assert.match(panelV2Root, /background:\s*transparent/)

  const chatSheetRoot = chatSheetStyles.match(/\.chat-sheet-v2\s*\{([\s\S]*?)\n\}/)?.[1]
  assert.ok(chatSheetRoot, 'the chat sheet root should remain explicit')
  assert.match(chatSheetRoot, /background:\s*transparent/)

  const legacyPanelRoots = [...appStyles.matchAll(/(?:html\[data-theme='warm-day'\] )?\.desktop-pet-root--panel\s*\{([^}]*)\}/g)]
  assert.ok(legacyPanelRoots.length >= 3, 'base and themed panel roots should be covered')
  for (const [, declarations] of legacyPanelRoots) {
    assert.match(declarations, /background:\s*transparent/)
  }
})

test('v0.4.3 keeps Panel Live2D-first and routes voice control through Settings, Frameless, and Pet', async () => {
  const [panel, styles, frameless, legacyPanel, legacyStyles, settingsVoice, petView, plan] = await Promise.all([
    readFile(companionPanelV2Path, 'utf8'),
    readFile(panelV2StylesPath, 'utf8'),
    readFile(framelessSurfacePath, 'utf8'),
    readFile(panelViewPath, 'utf8'),
    readFile(panelStylesPath, 'utf8'),
    readFile(settingsVoiceSectionPath, 'utf8'),
    readFile(petViewPath, 'utf8'),
    readFile(optimizationPlanPath, 'utf8'),
  ])

  assert.match(plan, /Live2D is the Panel's visual subject/)
  assert.match(plan, /Panel has no persistent voice button\s+or voice action/)
  assert.match(plan, /Settings → Voice manages start, stop, and cancel/)
  assert.match(plan, /Frameless\s+and Pet surfaces retain their direct voice entry/)
  assert.doesNotMatch(plan, /Voice stays the only persistent primary action|voice as the only persistent primary action/)
  assert.doesNotMatch(plan, /Panel (?:(?:keeps|shows|uses|retains|exposes)|has (?!no\b))[^.\n]{0,80}persistent (?:primary )?voice action/i)

  assert.doesNotMatch(panel, /nexus-panel-v2__voice/)
  assert.doesNotMatch(styles, /nexus-panel-v2__voice/)
  assert.doesNotMatch(panel, /voiceActionLabel|voiceActionIcon|handleVoiceMenuAction/)
  assert.doesNotMatch(legacyPanel, /image4-voice-orb|voiceActionLabel|voiceActionDisabled/)
  assert.doesNotMatch(legacyStyles, /image4-voice-orb/)
  assert.match(legacyStyles, /\.panel-window--image4 \.image4-composer\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/)
  assert.doesNotMatch(legacyStyles.match(/\.panel-window--image4 \.image4-composer\s*\{([\s\S]*?)\n\}/)?.[1] ?? '', /42px/)
  assert.match(frameless, /className=\{`nexus-companion-v2__voice/)
  assert.match(settingsVoice, /onStartVoiceConversation:\s*\(\) => Promise<void>/)
  assert.match(settingsVoice, /onStopVoiceConversation:\s*\(\) => void/)
  assert.match(settingsVoice, /onCancelVoiceTurn:\s*\(\) => void/)
  assert.match(settingsVoice, /voiceState === 'idle'[\s\S]{0,260}onStartVoiceConversation\(\)/)
  assert.match(settingsVoice, /voiceState === 'listening'[\s\S]{0,180}onStopVoiceConversation\(\)/)
  assert.match(settingsVoice, /voiceState === 'processing'[\s\S]{0,180}onCancelVoiceTurn\(\)/)
  assert.match(petView, /import \{ FramelessCompanionSurface \}/)
  assert.match(petView, /<FramelessCompanionSurface[\s\S]{0,360}voice=\{voice\}[\s\S]{0,160}chat=\{chat\}/)

  const menu = panel.match(
    /<div\s+ref=\{utilityMenuRef\}[\s\S]*?className="nexus-panel-v2__menu"[\s\S]*?>([\s\S]*?)<\/div>/,
  )?.[1]
  assert.ok(menu, 'the More menu should remain explicit')
  const firstMenuButton = menu.match(/<button[\s\S]*?<\/button>/)?.[0]
  assert.ok(firstMenuButton, 'the More menu should expose a first action')
  assert.match(firstMenuButton, /ui_v2\.text_input/)
  assert.doesNotMatch(menu, /voiceActionLabel|handleVoiceMenuAction/)

  assert.match(panel, /aria-controls="nexus-panel-v2-utility-menu"/)
  assert.match(panel, /id="nexus-panel-v2-utility-menu"/)
  assert.match(panel, /role="group"/)
  assert.match(panel, /aria-label=\{ti\('ui_v2\.more'\)\}/)
  assert.doesNotMatch(panel, /role="menu"/)
  assert.match(panel, /role="status" aria-live="polite" aria-atomic="true"/)
})

test('V2 menu face-safe rule covers 400px, 420px, 460px, and leaves wide panels centered', async () => {
  const styles = await readFile(panelV2StylesPath, 'utf8')

  assert.match(styles, /min-width:\s*400px/)
  assert.match(styles, /@media \(max-width: 420px\)/)
  assert.match(styles, /@media \(max-width: 460px\)[\s\S]*?data-utility-open='true'[\s\S]*?transform: translateX\(calc\(-50% - 52px\)\) scale\(\.86\)/)
  assert.match(styles, /@media \(prefers-reduced-motion: no-preference\)[\s\S]*?transition: transform 180ms ease/)
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.nexus-panel-v2__live2d \{\s*transition: none;/)
  assert.match(styles, /\.nexus-panel-v2__menu button \{[\s\S]*?min-height: 44px/)
  assert.doesNotMatch(styles, /nexus-panel-v2__voice/)
  assert.match(styles, /width: min\(480px, calc\(100% - 32px\)\)/)
  assert.doesNotMatch(styles, /@media \(min-width: 461px\)[\s\S]*?data-utility-open='true'/)
})

test('Panel More starts with text chat and has no voice action state machine', async () => {
  const panel = await readFile(companionPanelV2Path, 'utf8')
  const menu = panel.match(
    /<div\s+ref=\{utilityMenuRef\}[\s\S]*?className="nexus-panel-v2__menu"[\s\S]*?>([\s\S]*?)<\/div>/,
  )?.[1]
  assert.ok(menu)
  assert.match(menu.match(/<button[\s\S]*?<\/button>/)?.[0] ?? '', /ui_v2\.text_input/)
  assert.doesNotMatch(panel, /voiceActionLabel|voiceActionIcon|handleVoiceMenuAction/)
})

test('Frameless V2 direct voice control uses state-specific semantic icons and actions', async () => {
  const [panel, frameless] = await Promise.all([
    readFile(companionPanelV2Path, 'utf8'),
    readFile(framelessSurfacePath, 'utf8'),
  ])

  assert.doesNotMatch(panel, /nexus-panel-v2__voice/)
  for (const source of [frameless]) {
    assert.match(source, /phase === 'listening'[\s\S]{0,220}panel\.voice\.stop_listening/)
    assert.match(source, /phase === 'thinking'[\s\S]{0,220}panel\.voice\.cancel_reply/)
    assert.match(source, /panel\.voice\.interrupt_response/)
    assert.match(source, /phase === 'listening'[\s\S]{0,260}name="mic"/)
    assert.match(source, /phase === 'thinking'[\s\S]{0,260}name="close"/)
    assert.match(source, /phase === 'speaking'[\s\S]{0,260}name="speaker"/)
    assert.match(source, /phase === 'thinking'[\s\S]{0,260}cancelActiveTurn/)
    assert.match(source, /stopVoiceConversation/)
    assert.doesNotMatch(source, /stop-mark/)
  }

  assert.match(
    frameless,
    /phase === 'idle' \|\| phase === 'done'[\s\S]{0,120}voice\.continuousVoiceActive[\s\S]{0,120}panel\.voice\.stop_continuous/,
  )

  const voiceButton = frameless.match(
    /<button\s+type="button"\s+className=\{`nexus-companion-v2__voice[\s\S]*?<\/button>/,
  )?.[0]
  assert.ok(voiceButton, 'frameless primary voice action should remain explicit')
  assert.doesNotMatch(voiceButton, /aria-pressed/)
  assert.match(frameless, /className=\{`nexus-companion-v2__utility-item[\s\S]*?aria-pressed=\{item\.pressed\}/)

  const framelessStyles = await readFile(framelessStylesPath, 'utf8')
  assert.doesNotMatch(framelessStyles, /nexus-companion-v2__stop-mark/)
  assert.match(
    framelessStyles,
    /\.nexus-companion-v2__voice:is\(\.is-listening, \.is-thinking, \.is-speaking\)/,
  )
  assert.doesNotMatch(framelessStyles, /\.nexus-companion-v2__voice\[aria-pressed='true'\]/)
})

test('voice-first panel keeps safety guidance outside the hidden archive', async () => {
  const source = await readFile(panelViewPath, 'utf8')
  const crisisIndex = source.indexOf('<CrisisHotlinePanel locale={settings.uiLanguage} />')
  const archiveIndex = source.indexOf('image4-message-list--archive')

  assert.ok(crisisIndex >= 0, 'the crisis hotline panel should remain mounted')
  assert.ok(archiveIndex >= 0, 'the archive marker should remain explicit')
  assert.ok(crisisIndex < archiveIndex, 'crisis guidance must render before, not inside, the hidden archive')
})

test('voice-first recap does not pair a new question with an older answer', async () => {
  const source = await readFile(panelViewPath, 'utf8')

  assert.match(source, /latestAssistantIndex > latestUserIndex/)
  assert.match(source, /image4CompanionState\.mode === 'speaking' \? undefined : latestAssistantMessage/)
  assert.match(source, /role="status" aria-live="polite" aria-atomic="true"/)
})

test('voice-first panel remains bounded and readable', async () => {
  const styles = await readFile(panelStylesPath, 'utf8')

  assert.match(styles, /width:\s*min\(calc\(100vw - 8px\), 420px\) !important/)
  assert.match(styles, /height:\s*min\(calc\(100vh - 8px\), 712px\) !important/)
  assert.match(styles, /font-size:\s*14px !important/)
  assert.match(styles, /\.panel-window--image4 \.crisis-hotline-panel\s*\{[\s\S]*?position:\s*absolute/)
})

test('applying a connection repair never claims an unverified ready state', async () => {
  const hookSource = await readFile(
    new URL('../src/components/settingsDrawerHooks/useConnectionTests.ts', import.meta.url),
    'utf8',
  )

  assert.doesNotMatch(hookSource, /onApplyTextConnectionRepair\(repair\)[\s\S]{0,500}status:\s*'ready'/)
  assert.match(hookSource, /delete next\[capability\]/)
  assert.match(hookSource, /shouldAcceptConnectionTestResult/)
  assert.match(hookSource, /requestEpochRef\.current \+= 1/)
  assert.match(hookSource, /buildConnectionTestFingerprint\(capability, draft\)/)
  assert.match(hookSource, /getNextConnectionResultExpiryMs/)
  assert.match(hookSource, /getConnectionTestResultPresentation/)
  assert.match(hookSource, /testingTargets\[capability\]/)
  assert.match(hookSource, /isTesting: \(capability: ServiceConnectionCapability\)/)
  assert.match(hookSource, /\[freshnessTick, testResults\]/)
  assert.match(hookSource, /document\.addEventListener\('visibilitychange', refreshWhenVisible\)/)
  assert.match(hookSource, /window\.addEventListener\('focus', refreshOnReturn\)/)
  assert.match(hookSource, /mountedRef\.current = false/)
})

test('onboarding never paints unverified text evidence as success', async () => {
  const textStepSource = await readFile(
    new URL('../src/features/onboarding/components/guideSteps/TextStep.tsx', import.meta.url),
    'utf8',
  )
  const guideSource = await readFile(
    new URL('../src/features/onboarding/components/OnboardingGuide.tsx', import.meta.url),
    'utf8',
  )

  assert.match(textStepSource, /requestGenerationRef\.current \+= 1/)
  assert.match(textStepSource, /shouldAcceptConnectionTestResult/)
  assert.match(textStepSource, /getConnectionTestResultPresentation/)
  assert.match(textStepSource, /createConnectionVerificationRecord/)
  assert.match(textStepSource, /onTextConnectionVerificationChange/)
  assert.match(textStepSource, /nextPresentation\.verified|presentation\.verified/)
  assert.match(textStepSource, /getNextConnectionResultExpiryMs/)
  assert.match(textStepSource, /freshnessTick/)
  assert.match(guideSource, /isConnectionVerificationCurrent/)
  assert.match(guideSource, /textConnectionVerification/)
  assert.doesNotMatch(guideSource, /useState\(false\).*textConnectionVerified|textConnectionVerified.*useState\(false\)/)
})

test('failed Live2D vendor scripts are removed so retry can create a fresh tag', async () => {
  const vendorSource = await readFile(
    new URL('../src/features/pet/components/live2d/vendor.ts', import.meta.url),
    'utf8',
  )

  assert.match(vendorSource, /dataset\.failed === 'true'/)
  assert.match(vendorSource, /failedScript\.remove\(\)/)
})

test('late Live2D model loads are destroyed and timeout handles are cleared', async () => {
  const canvasSource = await readFile(
    new URL('../src/features/pet/components/Live2DCanvas.tsx', import.meta.url),
    'utf8',
  )

  assert.match(canvasSource, /createLive2DAsyncOwnershipCoordinator/)
  assert.match(canvasSource, /ownership\.raceModelLoad/)
  assert.match(canvasSource, /shouldDestroyLateLive2DModel\(\{[\s\S]*?disposed: isDisposed\(\)[\s\S]*?timedOut/)
  assert.match(canvasSource, /await ensureLive2DVendorScripts\(\)[\s\S]*?shouldAbortLive2DBoot\(isDisposed\(\)/)
  assert.match(canvasSource, /document\.addEventListener\('visibilitychange', handleVisibilityChange\)/)
  assert.match(canvasSource, /document\.removeEventListener\('visibilitychange', handleVisibilityChange\)/)
  assert.match(canvasSource, /window\.clearTimeout\(timeoutId\)/)
  assert.match(canvasSource, /clearPendingBootWork\(\)/)
  assert.match(canvasSource, /ownership\.dispose\(\)/)
  assert.match(canvasSource, /Live2D boot failed:[\s\S]*?destroyOwnedRuntime\(\)/)
  assert.match(canvasSource, /if \(isDisposed\(\)\) \{[\s\S]*?break/)
  assert.doesNotMatch(
    canvasSource,
    /return \(\) => \{[\s\S]*?setModelReady\(/,
  )
})
