import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { getSettingsV2NavigationIntent } from '../src/features/uiV2/settingsNavigationIntent.ts'

const panelPath = new URL('../src/features/uiV2/CompanionPanelV2.tsx', import.meta.url)
const framelessPath = new URL('../src/features/uiV2/FramelessCompanionSurface.tsx', import.meta.url)
const appPath = new URL('../src/app/App.tsx', import.meta.url)
const petPath = new URL('../src/app/views/PetView.tsx', import.meta.url)
const legacyPetPath = new URL('../src/app/views/LegacyPetView.tsx', import.meta.url)
const panelViewPath = new URL('../src/app/views/PanelView.tsx', import.meta.url)
const settingsDrawerPath = new URL('../src/components/SettingsDrawer.tsx', import.meta.url)
const settingsLanguageHookPath = new URL('../src/components/settingsDrawerHooks/useSettingsLanguageControl.ts', import.meta.url)
const settingsDrawerV2Path = new URL('../src/components/SettingsDrawerV2.tsx', import.meta.url)
const settingsShellV2Path = new URL('../src/features/uiV2/SettingsShellV2.tsx', import.meta.url)
const settingsNavigationIntentPath = new URL('../src/features/uiV2/settingsNavigationIntent.ts', import.meta.url)
const panelStylesPath = new URL('../src/features/uiV2/panel-v2.css', import.meta.url)
const companionStylesPath = new URL('../src/features/uiV2/companion-v2.css', import.meta.url)
const settingsStylesPath = new URL('../src/features/uiV2/settings-v2.css', import.meta.url)
const settingsV3StylesPath = new URL('../src/features/settingsV3/settings-v3.css', import.meta.url)

test('settings opener is permanent and the drawer owns restoration', async () => {
  const [panel, frameless, panelView, settingsDrawer] = await Promise.all([
    readFile(panelPath, 'utf8'),
    readFile(framelessPath, 'utf8'),
    readFile(panelViewPath, 'utf8'),
    readFile(settingsDrawerPath, 'utf8'),
  ])

  const panelTrigger = panel.match(/className="nexus-panel-v2__utility"[\s\S]*?<\/button>/)?.[0]
  const panelMenu = panel.match(/<div\s+ref=\{utilityMenuRef\}[\s\S]*?className="nexus-panel-v2__menu"[\s\S]*?>([\s\S]*?)<\/div>/)?.[1]
  const panelMenuOpening = panel.match(/<div\s+ref=\{utilityMenuRef\}[^>]*>/)?.[0]
  const framelessTrigger = frameless.match(/className="nexus-companion-v2__utility-trigger nexus-v2-control nexus-v2-interactive"[\s\S]*?<\/button>/)?.[0]

  assert.ok(panelTrigger, 'the panel utility trigger should remain explicit')
  assert.ok(panelMenu, 'the panel utility menu should remain explicit')
  assert.ok(panelMenuOpening, 'the panel utility menu opening should remain explicit')
  assert.ok(framelessTrigger, 'the frameless utility trigger should remain explicit')
  assert.match(panelTrigger, /data-settings-opener="true"/)
  assert.match(panelTrigger, /aria-controls="nexus-panel-v2-utility-menu"/)
  assert.match(panelMenuOpening, /id="nexus-panel-v2-utility-menu"/)
  assert.match(panelMenuOpening, /role="group"/)
  assert.match(panelMenuOpening, /aria-label=\{ti\('ui_v2\.more'\)\}/)
  assert.doesNotMatch(panelMenuOpening, /role="menu"/)
  assert.doesNotMatch(panelMenu, /data-settings-opener/)
  assert.match(framelessTrigger, /data-settings-opener="true"/)
  assert.doesNotMatch(panelView, /settingsWasOpenRef|data-settings-opener/)
  assert.match(settingsDrawer, /const settingsOpenerRef = useRef<HTMLElement \| null>\(null\)/)
  assert.match(settingsDrawer, /activeElement !== document\.body/)
  assert.match(settingsDrawer, /activeElement !== document\.documentElement/)
  assert.match(settingsDrawer, /opener !== document\.body/)
  assert.match(settingsDrawer, /opener !== document\.documentElement/)
  assert.match(settingsDrawer, /document\.querySelector<HTMLElement>\('\[data-settings-opener="true"\]'\)/)
})

test('Settings Escape respects dirty confirmation and V2 single-section heading focus', async () => {
  const [drawer, languageHook, drawerV2, shellV2] = await Promise.all([
    readFile(settingsDrawerPath, 'utf8'),
    readFile(settingsLanguageHookPath, 'utf8'),
    readFile(settingsDrawerV2Path, 'utf8'),
    readFile(settingsShellV2Path, 'utf8'),
  ])

  assert.match(
    drawer,
    /function handleSettingsDialogKeyDown\(event: ReactKeyboardEvent<HTMLElement>\)[\s\S]*?if \(event\.key !== 'Escape' \|\| event\.defaultPrevented\) return[\s\S]*?void handleDismiss\(\)/,
  )
  assert.match(languageHook, /event\.preventDefault\(\)[\s\S]*?event\.stopPropagation\(\)[\s\S]*?closeLanguageMenuAndRestoreFocus\(\)/)
  assert.match(drawerV2, /onDialogKeyDown: KeyboardEventHandler<HTMLElement>/)
  assert.match(drawerV2, /onKeyDown=\{onDialogKeyDown\}/)
  assert.match(drawerV2, /activeV2Sections\.length === 1 \? activeSectionHeadingRef : undefined/)
  assert.match(drawerV2, /activeV2Sections\.length > 1 \? <header[\s\S]*?<h2 ref=\{activeSectionHeadingRef\} tabIndex=\{-1\}/)
  assert.match(shellV2, /activeHeadingRef\?: RefObject<HTMLHeadingElement \| null>/)
  assert.match(shellV2, /ref=\{!isHome \? activeHeadingRef : undefined\}/)
  assert.match(shellV2, /tabIndex=\{!isHome && activeHeadingRef \? -1 : undefined\}/)
})

test('Settings V2 moves route context focus only for keyboard or assistive activation', async () => {
  const [drawer, drawerV2, shellV2, navigationIntent] = await Promise.all([
    readFile(settingsDrawerPath, 'utf8'),
    readFile(settingsDrawerV2Path, 'utf8'),
    readFile(settingsShellV2Path, 'utf8'),
    readFile(settingsNavigationIntentPath, 'utf8'),
  ])

  assert.deepEqual(getSettingsV2NavigationIntent(0), { moveFocus: true })
  assert.deepEqual(getSettingsV2NavigationIntent(1), { moveFocus: false })
  assert.deepEqual(getSettingsV2NavigationIntent(2), { moveFocus: false })
  assert.match(navigationIntent, /return \{ moveFocus: eventDetail === 0 \}/)
  assert.equal(
    (shellV2.match(/onNavigate\([^\n]+getSettingsV2NavigationIntent\(event\.detail\)\)/g) ?? []).length,
    2,
    'sidebar groups and home cards should classify their activation source inline',
  )
  assert.match(drawerV2, /onNavigate=\{\(destination, intent\) => \{[\s\S]*?onReturnToSettingsHome\(false\)[\s\S]*?onOpenSettingsSection\(SETTINGS_V2_DEFAULT_SECTION\[destination\], intent\.moveFocus\)/)
  assert.doesNotMatch(drawerV2, /onReturnToSettingsHome\(intent\.moveFocus\)/)
  assert.match(
    drawerV2,
    /onClick=\{\(event\) => \{[\s\S]*?const intent = getSettingsV2NavigationIntent\(event\.detail\)[\s\S]*?onOpenSettingsSection\(section\.id, intent\.moveFocus\)/,
  )
  assert.match(shellV2, /const homeCardRefs = useRef<Partial<Record<SettingsV2GroupId, HTMLButtonElement \| null>>>\(\{\}\)/)
  assert.match(shellV2, /const pendingHomeFocusGroupRef = useRef<SettingsV2GroupId \| null>\(null\)/)
  assert.match(shellV2, /pendingHomeFocusGroupRef\.current = !isHome && intent\.moveFocus \? activeDestination : null/)
  assert.match(shellV2, /homeCardRefs\.current\[returnGroupId\]\?\.focus\(\)/)
  assert.doesNotMatch(shellV2, /homeCardRefs\.current\[returnGroupId\]\?\.focus\(\{[\s\S]*?preventScroll/)
  assert.equal(
    (shellV2.match(/handleReturnToHome\(event\.detail\)/g) ?? []).length,
    2,
    'desktop Settings Home and the 300px Back control should share the same V2 return target',
  )
  assert.match(shellV2, /homeCardRefs\.current\[group\.id\] = node/)
  assert.match(shellV2, /data-focus-return-group=\{group\.id\}/)
  assert.match(drawer, /const shouldFocusActiveSectionHeadingRef = useRef\(true\)/)
  assert.match(
    drawer,
    /function handleOpenSettingsSection\(sectionId: SettingsSectionId, moveFocus = true\)[\s\S]*?settingsView === 'section' && normalizedSectionId === activeSectionId[\s\S]*?if \(moveFocus\) activeSectionHeadingRef\.current\?\.focus\(\{ preventScroll: true \}\)[\s\S]*?return[\s\S]*?shouldFocusActiveSectionHeadingRef\.current = moveFocus/,
  )
  assert.match(
    drawer,
    /const shouldMoveFocus = shouldFocusActiveSectionHeadingRef\.current[\s\S]*?shouldFocusActiveSectionHeadingRef\.current = true[\s\S]*?if \(!shouldMoveFocus\) return undefined[\s\S]*?requestAnimationFrame\(\(\) => \{[\s\S]*?activeSectionHeadingRef\.current\?\.focus\(\{ preventScroll: true \}\)/,
  )
  assert.match(drawer, /function handleReturnToSettingsHome\(moveFocus = true\)[\s\S]*?setSettingsView\('home'\)[\s\S]*?if \(!moveFocus\) return[\s\S]*?settingsHomeCardRefs\.current\[returnSectionId\]\?\.focus\(\)/)
})

test('Pet settings dialog stays inside the root, isolates the backing surface, and restores More focus', async () => {
  const [app, pet, legacyPet, settingsDrawer, frameless] = await Promise.all([
    readFile(appPath, 'utf8'),
    readFile(petPath, 'utf8'),
    readFile(legacyPetPath, 'utf8'),
    readFile(settingsDrawerPath, 'utf8'),
    readFile(framelessPath, 'utf8'),
  ])

  assert.match(app, /<PetView[\s\S]*settingsDrawer=\{settingsDrawer\}[\s\S]*onboardingGuide=\{onboardingGuide\}/)
  assert.doesNotMatch(app, /<\/PetView>\s*\{settingsDrawer\}/)
  assert.match(pet, /settingsDrawer: ReactNode/)
  assert.match(pet, /const hasModalOverlay = Boolean\(settingsDrawer\) \|\| Boolean\(onboardingGuide\)/)
  const petRoot = pet.match(/<div className=\{`desktop-pet-root desktop-pet-root--pet [^`]+`\}>/)
  assert.ok(petRoot, 'PetView should own one precise desktop pet root')
  assert.equal((pet.match(/<div className=\{`desktop-pet-root desktop-pet-root--pet /g) ?? []).length, 1)
  assert.match(
    pet,
    /<div aria-hidden=\{hasModalOverlay \? true : undefined\} inert=\{hasModalOverlay \? true : undefined\}>[\s\S]*?<FramelessCompanionSurface[\s\S]*?paused=\{hasModalOverlay\}/,
  )
  assert.match(pet, /modalOpen=\{hasModalOverlay\}/)
  const legacySection = legacyPet.match(/<section[\s\S]*?>/)?.[0]
  assert.ok(legacySection, 'LegacyPetView should expose a pet-window opening tag')
  assert.match(legacySection, /className="pet-window"/)
  assert.match(legacySection, /aria-hidden=\{modalOpen \? true : undefined\}/)
  assert.match(legacySection, /inert=\{modalOpen \? true : undefined\}/)
  assert.match(legacyPet, /modalOpen: boolean/)
  assert.match(legacyPet, /paused=\{modalOpen\}/)
  assert.match(pet, /\{settingsDrawer\}\s*\{onboardingGuide\}/)
  assert.match(frameless, /data-settings-opener="true"/)
  assert.match(legacyPet, /pet-window__anchor-btn--expand[\s\S]*?data-settings-opener="true"/)
  assert.doesNotMatch(legacyPet, /settingsDrawer|onboardingGuide/)
  assert.match(settingsDrawer, /settingsDialogRef\.current\?\.focus\(\)/)
  assert.match(settingsDrawer, /const activeElement = document\.activeElement/)
  assert.match(settingsDrawer, /const focusTarget = opener\?\.isConnected[\s\S]*?focusTarget\?\.focus\(\)/)
})

test('V2 panel, settings V2, and settings V3 share an opaque focus ring', async () => {
  const [panel, companion, settings, settingsV3] = await Promise.all([
    readFile(panelStylesPath, 'utf8'),
    readFile(companionStylesPath, 'utf8'),
    readFile(settingsStylesPath, 'utf8'),
    readFile(settingsV3StylesPath, 'utf8'),
  ])

  for (const [name, source] of [
    ['panel', panel],
    ['frameless', companion],
    ['settings V2', settings],
  ] as const) {
    assert.match(source, /--nx-v2-focus-ring:\s*color-mix\(in srgb, [^;]+\);/, `${name} should define the shared focus token`)
    assert.match(source, /outline:\s*3px solid var\(--nx-v2-focus-ring\)/, `${name} should consume the shared focus token`)
    assert.doesNotMatch(source, /outline(?:-color)?:\s*[^;]*transparent/, `${name} should not make focus transparent`)
  }

  assert.match(settingsV3, /outline: 3px solid var\(--nx-v2-focus-ring\)/)
  assert.doesNotMatch(settingsV3, /outline:\s*3px solid color-mix\(in srgb, var\(--sv3-accent\) (?:32|36)%?, transparent\)/)
  assert.match(settings, /\.settings-drawer--v2 :is\(h1, h2, h3, h4\)\[tabindex\]:focus-visible[\s\S]*?outline: 3px solid var\(--nx-v2-focus-ring\)/)
  assert.doesNotMatch(settings, /\.settings-drawer--v2 :is\(h1, h2, h3, h4\)\[tabindex\]:focus(?!-visible)/)
  assert.doesNotMatch(settings, /settings-v2__active-heading h2\[tabindex='-1'\]:focus[\s\S]*?outline-color:\s*transparent/)
  assert.match(panel, /@media \(forced-colors: active\)[\s\S]*?outline: 3px solid Highlight/)
  assert.match(settings, /@media \(forced-colors: active\)[\s\S]*?outline: 3px solid Highlight/)
  assert.match(settingsV3, /@media \(forced-colors: active\)[\s\S]*?outline: 3px solid Highlight/)
})
