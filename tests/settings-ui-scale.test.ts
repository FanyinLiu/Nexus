import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function readWorkspaceFile(relativePath: string) {
  return readFileSync(join(ROOT, relativePath), 'utf8').replace(/\r\n/g, '\n')
}

function assertSourcePattern(source: string, pattern: RegExp, message: string) {
  assert.match(source, pattern, message)
}

function assertSourceOrder(source: string, before: string, after: string, message: string) {
  const beforeIndex = source.indexOf(before)
  const afterIndex = source.indexOf(after)
  assert.notEqual(beforeIndex, -1, `missing source fragment before order check: ${before}`)
  assert.notEqual(afterIndex, -1, `missing source fragment after order check: ${after}`)
  assert.ok(beforeIndex < afterIndex, message)
}

function assertContains(source: string, fragment: string, message: string) {
  assert.ok(source.includes(fragment), message)
}

function countSourceMatches(source: string, pattern: RegExp) {
  return [...source.matchAll(pattern)].length
}

function extractSourceRange(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start)
  assert.notEqual(startIndex, -1, `missing source range start: ${start}`)
  const endIndex = source.indexOf(end, startIndex + start.length)
  assert.notEqual(endIndex, -1, `missing source range end: ${end}`)
  return source.slice(startIndex, endIndex)
}

test('settings drawer keeps the agreed compact scale tokens', () => {
  const settings = readWorkspaceFile('src/app/styles/settings.css')

  for (const token of [
    '--settings-toggle-width: 34px;',
    '--settings-toggle-height: 18px;',
    '--settings-toggle-thumb-size: 10px;',
    '--settings-control-height: 26px;',
    '--settings-control-height-small: 21px;',
    '--settings-control-font-size: 10px;',
    '--settings-body-font-size: 10px;',
    '--settings-heading-small-font-size: 10px;',
    '--settings-meta-font-size: 9px;',
  ]) {
    assert.ok(settings.includes(token), `missing settings size token: ${token}`)
  }
  assertSourcePattern(
    settings,
    /\.settings-drawer\s*\{[\s\S]*?width:\s*min\(300px,\s*calc\(100vw - 18px\)\);[\s\S]*?max-height:\s*min\(470px,\s*calc\(100vh - 18px\)\);[\s\S]*?gap:\s*4px;[\s\S]*?padding:\s*5px;[\s\S]*?font-size:\s*var\(--settings-body-font-size\);/m,
    'compact settings drawer should not keep the older 392px shell scale',
  )
  assertSourcePattern(
    settings,
    /\.settings-drawer__window-title\s*\{[\s\S]*?gap:\s*4px;[\s\S]*?font-size:\s*12px;/m,
    'compact settings title should stay below the older 24px drawer heading',
  )
  assertSourcePattern(
    settings,
    /\.settings-drawer__actions \.ghost-button,[\s\S]*?\.settings-drawer__actions \.primary-button\s*\{[\s\S]*?min-height:\s*var\(--settings-control-height\);[\s\S]*?padding:\s*0 7px;/m,
    'compact settings footer actions should use the smaller shared control height and padding',
  )
})

test('settings home controls use the shared compact scale', () => {
  const home = readWorkspaceFile('src/app/styles/settings-home.css')

  assertSourcePattern(
    home,
    /\.settings-appearance-switch\s*\{[\s\S]*?min-height:\s*var\(--settings-control-height\);/m,
    'home appearance switch should inherit the shared control height',
  )
  assertSourcePattern(
    home,
    /\.settings-appearance-switch__label\s*\{[\s\S]*?font-size:\s*var\(--settings-control-font-size\);/m,
    'home appearance label should inherit the shared control font size',
  )
  assertSourcePattern(
    home,
    /\.settings-drawer \.settings-appearance-switch__option\s*\{[\s\S]*?min-height:\s*var\(--settings-control-height-small\);[\s\S]*?font-size:\s*var\(--settings-control-font-size\);/m,
    'drawer appearance options should stay compact without hard-coded button text size',
  )
  assertSourcePattern(
    home,
    /\.settings-home-group \+ \.settings-home-group\s*\{[\s\S]*?margin-top:\s*6px;[\s\S]*?border-top:\s*1px solid/m,
    'settings home groups should separate by rhythm, not hidden advanced disclosure',
  )
  assertSourcePattern(
    home,
    /\.settings-home-group__head\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\) auto;[\s\S]*?font-size:\s*var\(--settings-meta-font-size\);/m,
    'settings groups should use lightweight headings rather than another card stack',
  )
  assert.ok(!home.includes('settings-home-release'), 'settings home CSS should not keep release-card styles')
})

test('settings home keeps maintenance utilities in one low-frequency group', () => {
  const architecture = readWorkspaceFile('src/components/settingsHomeArchitecture.ts')

  assertContains(
    architecture,
    "id: 'maintenance'",
    'settings home should use one maintenance group for low-frequency recovery utilities',
  )
  assertContains(
    architecture,
    "sectionIds: ['history', 'console']",
    'history and diagnostics should share the maintenance group instead of creating two tail groups',
  )
  assert.doesNotMatch(
    architecture,
    /'privacySafety'|'aboutDiagnostics'/m,
    'settings home should not split low-frequency safety and diagnostics into two first-screen groups',
  )
})

test('settings visual system defines the 0.4.2 shared child-page contract', () => {
  const visualSystem = readWorkspaceFile('src/app/styles/settings-visual-system.css')
  const entry = readWorkspaceFile('src/app/settingsDrawerEntry.ts')

  assertSourceOrder(
    entry,
    "import './styles/settings-visual-system.css'",
    "import './styles/settings-visibility-final.css'",
    'settings visual system should load before the final readability layer',
  )

  for (const token of [
    '--nx-settings-control-height: 30px;',
    '--nx-settings-control-height-small: 24px;',
    '--nx-settings-segment-height: 28px;',
    '--nx-settings-footer-height: 36px;',
    '--nx-settings-row-height: 38px;',
    '--nx-settings-field-height: 32px;',
    '--nx-settings-icon-size: 18px;',
    '--nx-settings-segment-gap: 3px;',
    '--nx-settings-track-trust',
    '--nx-settings-track-memory',
    '--nx-settings-track-desktop',
    '--nx-settings-track-permission',
    '--nx-settings-track-appearance',
  ]) {
    assert.ok(visualSystem.includes(token), `missing settings visual-system token: ${token}`)
  }

  for (const themeClass of ['.settings-drawer--night', '.settings-drawer--day', '.settings-drawer--warm-day', '.settings-backdrop--night', '.settings-backdrop--day', '.settings-backdrop--warm-day']) {
    assert.ok(visualSystem.includes(themeClass), `visual system should define theme contract for ${themeClass}`)
  }

  assertSourcePattern(
    visualSystem,
    /\.settings-drawer\.settings-drawer--section \.settings-page\[data-section\]\s*\{[\s\S]*?--settings-child-control-height:\s*var\(--nx-settings-control-height\);[\s\S]*?--settings-child-control-font-size:\s*var\(--nx-settings-font-body\);/m,
    'settings child pages should derive their scale from the Nexus visual-system tokens',
  )
  assertSourcePattern(
    visualSystem,
    /\.settings-drawer\.settings-drawer--section \.settings-page\[data-section\] :is\(input:not\(\[type='checkbox'\]\):not\(\[type='radio'\]\):not\(\[type='range'\]\):not\(\[type='file'\]\), select, textarea, \.settings-url-input\)\s*\{[\s\S]*?min-height:\s*var\(--nx-settings-field-height\);[\s\S]*?border-radius:\s*var\(--nx-settings-radius-control\);[\s\S]*?background:\s*var\(--nx-settings-field\);/m,
    'text inputs, selects, textareas, and URL inputs should share one field treatment',
  )
  assertSourcePattern(
    visualSystem,
    /\.settings-drawer\.settings-drawer--section \.settings-page\[data-section\] \.settings-toggle input:checked\s*\{[\s\S]*?background:\s*linear-gradient\(135deg,\s*var\(--nx-settings-accent\),/m,
    'toggle checked state should use the visual-system accent rather than per-page colors',
  )
  assertSourcePattern(
    visualSystem,
    /\.settings-drawer\.settings-drawer--section \.settings-page\[data-section\] :is\(\.settings-appearance-switch__control, \.onboarding-region-tabs, \.onboarding-relationship__options, \.settings-sprite-preview__states, \.settings-companion-state-preview__states\)\s*\{[\s\S]*?gap:\s*var\(--nx-settings-segment-gap\);[\s\S]*?background:\s*var\(--nx-settings-segment-surface\);/m,
    'segmented controls should share one visual-system track treatment',
  )
  assertSourcePattern(
    visualSystem,
    /\.settings-drawer\.settings-drawer--section \.settings-page\[data-section\] :is\(\.settings-appearance-switch__option\.is-active, \.onboarding-region-tabs__tab\.is-active, \.onboarding-relationship__chip\.is-active, \.settings-sprite-preview__states button\.is-active, \.settings-companion-state-preview__states button\.is-active\)\s*\{[\s\S]*?background:\s*var\(--nx-settings-segment-active\);/m,
    'segmented active states should share one active surface',
  )
  assertSourcePattern(
    visualSystem,
    /\.settings-drawer\.settings-drawer--section \.settings-page\[data-section\] :is\(\.settings-form-row__validation, \.settings-model-advanced__error, \.settings-test-result\.is-error, \.settings-url-input--invalid\)\s*\{[\s\S]*?var\(--nx-settings-danger\)/m,
    'validation and error states should share one danger treatment',
  )
  assertSourcePattern(
    visualSystem,
    /\.settings-drawer\.settings-drawer--section \.settings-drawer__actions\s*\{[\s\S]*?min-height:\s*var\(--nx-settings-footer-height\);[\s\S]*?background:\s*var\(--nx-settings-footer-surface\);/m,
    'settings footer actions should share one bottom operation surface',
  )
  assertSourcePattern(
    visualSystem,
    /\.settings-backdrop \.confirm-dialog-card\s*\{[\s\S]*?border:\s*1px solid var\(--nx-settings-line\);[\s\S]*?background:\s*var\(--nx-settings-surface\);[\s\S]*?color:\s*var\(--nx-settings-ink\);/m,
    'settings confirmation dialogs should inherit the settings visual-system surface',
  )
  assertSourcePattern(
    visualSystem,
    /\.settings-backdrop \.confirm-dialog-card__confirm\.is-danger\s*\{[\s\S]*?border-color:\s*var\(--nx-settings-danger\);[\s\S]*?background:\s*var\(--nx-settings-danger\);/m,
    'danger confirmations should use the shared danger token',
  )

  const visibilityFinal = readWorkspaceFile('src/app/styles/settings-visibility-final.css')
  assertSourcePattern(
    visibilityFinal,
    /\.settings-drawer\.settings-drawer--light\.settings-drawer--home \.settings-drawer__actions,[\s\S]*?\.settings-drawer\.settings-drawer--light\.settings-drawer--section \.settings-drawer__actions,[\s\S]*?\.settings-drawer\.settings-drawer--section \.settings-drawer__actions\s*\{[\s\S]*?min-height:\s*var\(--nx-settings-footer-height\);[\s\S]*?background:\s*var\(--nx-settings-footer-surface\);/m,
    'final visibility layer should keep the save footer on the visual-system token after warm-section overrides',
  )
})

test('final warm settings top bar stays calm and readable', () => {
  const finalSettings = readWorkspaceFile('src/app/styles/settings-chat-final.css')

  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light\.settings-drawer--home \.settings-drawer__header,[\s\S]*?\.settings-drawer\.settings-drawer--light\.settings-drawer--section \.settings-drawer__header\s*\{[\s\S]*?padding:\s*1px 2px 2px;[\s\S]*?border:\s*0;[\s\S]*?border-bottom:\s*1px solid transparent;[\s\S]*?border-radius:\s*0;[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none;/m,
    'final warm settings title bar should stay integrated instead of reading as a separate hard strip',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light\.settings-drawer--home \.settings-drawer__header-main,[\s\S]*?\.settings-drawer\.settings-drawer--light\.settings-drawer--section \.settings-drawer__header-main\s*\{[\s\S]*?min-height:\s*28px;[\s\S]*?padding:\s*0 1px 0 6px;[\s\S]*?border:\s*0;[\s\S]*?border-radius:\s*0;[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none;/m,
    'final warm settings header should stay as a native app bar instead of an inner capsule',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light\.settings-drawer--home \.settings-drawer__toolbar,[\s\S]*?\.settings-drawer\.settings-drawer--light\.settings-drawer--section \.settings-drawer__toolbar\s*\{[\s\S]*?gap:\s*1px;[\s\S]*?padding:\s*0;[\s\S]*?border:\s*0;[\s\S]*?border-radius:\s*0;[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none;/m,
    'final warm settings title buttons should be simple app-bar glyph buttons instead of a shared capsule',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light\.settings-drawer--home \.settings-drawer__window-title-name,[\s\S]*?\.settings-drawer\.settings-drawer--light\.settings-drawer--section \.settings-drawer__window-title-name\s*\{[\s\S]*?display:\s*inline;[\s\S]*?font-size:\s*12px;[\s\S]*?font-weight:\s*620;/m,
    'final warm settings title should keep Settings as the only visible title word',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light\.settings-drawer--home \.settings-drawer__window-title-label,[\s\S]*?\.settings-drawer\.settings-drawer--light\.settings-drawer--section \.settings-drawer__window-title-label\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?width:\s*1px;[\s\S]*?height:\s*1px;[\s\S]*?clip-path:\s*inset\(50%\);[\s\S]*?white-space:\s*nowrap;/m,
    'final warm settings title should keep companion context out of the visible app bar',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light\.settings-drawer--home \.settings-drawer__language-button,[\s\S]*?\.settings-drawer\.settings-drawer--light\.settings-drawer--section \.settings-drawer__icon-button\s*\{[\s\S]*?width:\s*20px;[\s\S]*?height:\s*20px;[\s\S]*?min-width:\s*20px;[\s\S]*?min-height:\s*20px;[\s\S]*?border-radius:\s*6px;/m,
    'final warm settings top controls should use compact Codex-like glyph hit targets',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light\.settings-drawer--home,[\s\S]*?\.settings-drawer\.settings-drawer--light\.settings-drawer--section\s*\{[\s\S]*?--settings-surface:\s*#fffaf3;[\s\S]*?linear-gradient\(180deg,\s*#fffaf3 0%,\s*#f6ecde 100%\);[\s\S]*?backdrop-filter:\s*none;[\s\S]*?-webkit-backdrop-filter:\s*none;/m,
    'final warm settings drawer should use an opaque warm surface so chat content cannot bleed through',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light\.settings-drawer--home \.settings-drawer__actions,[\s\S]*?\.settings-drawer\.settings-drawer--light\.settings-drawer--section \.settings-drawer__actions\s*\{[\s\S]*?display:\s*flex;[\s\S]*?justify-content:\s*flex-end;[\s\S]*?gap:\s*8px;[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none;/m,
    'final warm settings footer should use compact right-aligned actions instead of two wide button columns',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light\.settings-drawer--home \.settings-drawer__actions \.ghost-button,[\s\S]*?html\[data-theme='system-day'\] \.settings-drawer\.settings-drawer--light\.settings-drawer--section \.settings-drawer__actions \.primary-button\s*\{[\s\S]*?backdrop-filter:\s*none;[\s\S]*?-webkit-backdrop-filter:\s*none;/m,
    'final warm settings footer buttons should not keep a hidden blur base',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light\.settings-drawer--home \.settings-home-group__head\s*\{[\s\S]*?min-height:\s*22px;[\s\S]*?padding:\s*3px 6px 1px;/m,
    'final warm settings group headings should not waste vertical space above the settings rows',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light\.settings-drawer--home \.settings-home-card,[\s\S]*?\.settings-drawer\.settings-drawer--light\.settings-drawer--home \.settings-home-card:nth-child\(even\):hover\s*\{[\s\S]*?grid-template-columns:\s*18px minmax\(0,\s*1fr\) minmax\(68px,\s*min\(48%,\s*176px\)\);[\s\S]*?min-height:\s*38px;/m,
    'final warm settings home rows should reserve a left glyph lane like the companion chat action rows',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light\.settings-drawer--home \.settings-home-card__glyph\s*\{[\s\S]*?grid-column:\s*1;[\s\S]*?justify-self:\s*center;[\s\S]*?opacity:\s*0\.62;/m,
    'final warm settings home glyphs should stay visible as leading category cues instead of fading on the right',
  )
})

test('settings responsive rules do not re-inflate compact controls', () => {
  const settings = readWorkspaceFile('src/app/styles/settings.css')
  const home = readWorkspaceFile('src/app/styles/settings-home.css')
  const themes = readWorkspaceFile('src/app/styles/settings-themes.css')
  const narrowHomeSource = extractSourceRange(
    home,
    '@media (max-width: 360px) {',
    '@media (max-height: 420px) {',
  )
  const tinyHomeSource = extractSourceRange(
    home,
    '@media (max-width: 360px) and (max-height: 420px) {',
    '  .settings-drawer .settings-home-card__value {',
  )
  const tinyDrawerSource = extractSourceRange(
    settings,
    '@media (max-width: 300px) and (max-height: 480px) {',
    '@media (min-width: 301px) and (max-height: 420px) {',
  )
  const shortDrawerSource = settings.slice(settings.indexOf('@media (min-width: 301px) and (max-height: 420px) {'))

  for (const source of [tinyDrawerSource, shortDrawerSource]) {
    assertSourcePattern(
      source,
      /\.settings-drawer__window-title\s*\{[\s\S]*?font-size:\s*12px;/m,
      'responsive settings drawer title should not jump back to the old 18px compact-window scale',
    )
    assertSourcePattern(
      source,
      /\.settings-drawer__language-icon,[\s\S]*?\.settings-drawer__icon-button svg\s*\{[\s\S]*?width:\s*10px;[\s\S]*?height:\s*10px;/m,
      'responsive settings drawer toolbar icons should remain small enough for compact windows',
    )
    assertSourcePattern(
      source,
      /\.settings-drawer__actions \.ghost-button,[\s\S]*?\.settings-drawer__actions \.primary-button\s*\{[\s\S]*?min-height:\s*var\(--settings-control-height-small\);[\s\S]*?padding-right:\s*6px;[\s\S]*?padding-left:\s*6px;/m,
      'responsive settings footer actions should not re-inflate to 36px buttons',
    )
    assert.doesNotMatch(
      source,
      /font-size:\s*18px|min-height:\s*36px|width:\s*16px|height:\s*16px|padding-right:\s*12px|padding-left:\s*12px/m,
      'responsive settings drawer overrides should not retain the rejected large compact-window values',
    )
  }

  for (const source of [narrowHomeSource, tinyHomeSource]) {
    assertSourcePattern(
      source,
      /\.settings-drawer \.settings-home-card,[\s\S]*?\.settings-drawer \.settings-home-card:nth-child\(even\):hover\s*\{[\s\S]*?min-height:\s*var\(--settings-control-height\);/m,
      'responsive settings home rows should keep the shared 24px compact height',
    )
    assert.doesNotMatch(
      source,
      /min-height:\s*(?:29|30)px/m,
      'responsive settings home rows should not keep the larger hard-coded narrow-row heights',
    )
  }

  assertSourcePattern(
    themes,
    /@media \(max-width:\s*300px\) and \(max-height:\s*480px\)\s*\{[\s\S]*?\.settings-page\[data-section\] \.settings-page__header\s*\{[\s\S]*?grid-template-columns:\s*28px minmax\(0,\s*1fr\);[\s\S]*?gap:\s*4px;/m,
    'tiny child settings pages should keep a compact title-bar grid',
  )
  assertSourcePattern(
    themes,
    /@media \(max-width:\s*300px\) and \(max-height:\s*480px\)\s*\{[\s\S]*?\.settings-page\[data-section\] \.settings-page__back\s*\{[\s\S]*?width:\s*28px;[\s\S]*?min-width:\s*28px;/m,
    'tiny child settings page back button should not grow to the old 34px icon slot',
  )
  assertSourcePattern(
    themes,
    /@media \(max-width:\s*300px\) and \(max-height:\s*480px\)\s*\{[\s\S]*?\.settings-page\[data-section\] \.settings-page__headline h4\s*\{[\s\S]*?font-size:\s*11px;/m,
    'tiny child settings page headline should stay on the compact heading scale',
  )
})

test('settings child pages and onboarding inherit shared control scale', () => {
  const settings = readWorkspaceFile('src/app/styles/settings.css')
  const themes = readWorkspaceFile('src/app/styles/settings-themes.css')

  assertSourcePattern(
    settings,
    /\.settings-drawer--section\s*\{[\s\S]*?width:\s*min\(480px,\s*calc\(100vw - 18px\)\);[\s\S]*?height:\s*min\(480px,\s*calc\(100vh - 18px\)\);/m,
    'settings child pages should not jump back to the older oversized 680px drawer',
  )
  assertSourcePattern(
    themes,
    /\.settings-page\[data-section\]\s*\{[\s\S]*?--settings-child-control-height:\s*var\(--settings-control-height\);[\s\S]*?--settings-child-control-font-size:\s*var\(--settings-control-font-size\);[\s\S]*?--settings-child-meta-font-size:\s*var\(--settings-meta-font-size\);[\s\S]*?--settings-child-gap:\s*4px;/m,
    'settings child pages should derive their control scale from the shared settings tokens',
  )
  assertSourcePattern(
    themes,
    /\.settings-page\[data-section\] \.settings-page__back,[\s\S]*?\.settings-page\[data-section\] \.settings-about-panel__link\s*\{[\s\S]*?min-height:\s*var\(--settings-child-control-height\);[\s\S]*?font-size:\s*var\(--settings-child-control-font-size\);/m,
    'settings child-page buttons and links should share one height and font scale',
  )
  assertSourcePattern(
    themes,
    /\.settings-page\[data-section\] \.settings-page__headline h4\s*\{[\s\S]*?font-size:\s*11px;/m,
    'settings child-page headings should stay below the older 18px section title scale',
  )
  assertSourcePattern(
    themes,
    /\.settings-drawer \.settings-page\[data-section\] \.settings-toggle:not\(\.settings-lorebook-check\)\s*\{[\s\S]*?gap:\s*8px;/m,
    'settings child-page toggle rows should use the tighter shared row gap',
  )
  assertSourcePattern(
    themes,
    /\.settings-drawer \.settings-page\[data-section='window'\] \.settings-window-section > \.settings-control-grid > \.settings-control-card:not\(\.settings-window-field\):not\(\.settings-window-control\)\s*\{[\s\S]*?gap:\s*0;[\s\S]*?padding:\s*3px 5px;/m,
    'desktop/window child-page control cards should not keep the older tall card padding',
  )
  assertSourcePattern(
    themes,
    /\.settings-drawer \.settings-page\[data-section='window'\] \.settings-window-section > \.settings-control-grid > \.settings-control-card:not\(\.settings-window-field\):not\(\.settings-window-control\) > p\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?width:\s*1px;[\s\S]*?height:\s*1px;[\s\S]*?clip-path:\s*inset\(50%\);[\s\S]*?white-space:\s*nowrap;/m,
    'desktop/window child-page helper copy should remain in the DOM without making compact rows tall',
  )
  assertSourcePattern(
    themes,
    /\.settings-drawer \.settings-page\[data-section='window'\] \.settings-window-section > \.settings-control-grid > \.settings-control-card:not\(\.settings-window-field\):not\(\.settings-window-control\) > \.settings-toggle\s*\{[\s\S]*?gap:\s*7px;/m,
    'desktop/window child-page toggle rows should keep the tighter final gap after legacy overrides',
  )
  assertSourcePattern(
    themes,
    /\.settings-drawer \.settings-page\[data-section='window'\] label\.settings-window-field\s*\{[\s\S]*?grid-template-columns:\s*minmax\(66px,\s*0\.36fr\) minmax\(0,\s*1fr\);[\s\S]*?min-height:\s*32px;[\s\S]*?padding:\s*3px 4px;/m,
    'desktop/window child-page select rows should keep the tighter field rhythm',
  )
  assertSourcePattern(
    themes,
    /\.settings-drawer \.settings-page\[data-section='voice'\] \.settings-voice-loop-card \.settings-voice-control:has\(> p\)\s*\{[\s\S]*?position:\s*relative;[\s\S]*?min-height:\s*31px;[\s\S]*?align-content:\s*center;/m,
    'voice child-page toggle cards with helper copy should not keep the older 66px card height',
  )
  assertSourcePattern(
    themes,
    /\.settings-drawer \.settings-page\[data-section='voice'\] \.settings-voice-loop-card \.settings-voice-control > p\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?width:\s*1px;[\s\S]*?height:\s*1px;[\s\S]*?clip-path:\s*inset\(50%\);[\s\S]*?white-space:\s*nowrap;/m,
    'voice helper copy should stay in the DOM without inflating compact toggle cards',
  )
  assertSourcePattern(
    themes,
    /\.settings-drawer \.settings-page\[data-section='tools'\] \.settings-tools-section > \.settings-control-grid > \.settings-control-card:has\(> \.settings-toggle \+ p\)\s*\{[\s\S]*?position:\s*relative;[\s\S]*?min-height:\s*31px;[\s\S]*?padding:\s*3px 4px;[\s\S]*?align-content:\s*center;/m,
    'tools child-page toggle cards with helper copy should not keep the older 66px card height',
  )
  assertSourcePattern(
    themes,
    /\.settings-drawer \.settings-page\[data-section='tools'\] \.settings-tools-section > \.settings-control-grid > \.settings-control-card:has\(> \.settings-toggle \+ p\) > p\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?width:\s*1px;[\s\S]*?height:\s*1px;[\s\S]*?clip-path:\s*inset\(50%\);[\s\S]*?white-space:\s*nowrap;/m,
    'tools helper copy should stay in the DOM without inflating compact toggle cards',
  )
  assertSourcePattern(
    themes,
    /\.settings-drawer \.settings-page\[data-section='tools'\] label\.settings-tools-field\s*\{[\s\S]*?grid-template-columns:\s*minmax\(86px,\s*0\.42fr\) minmax\(0,\s*1fr\);[\s\S]*?min-height:\s*34px;[\s\S]*?padding:\s*3px 5px;/m,
    'tools backend fields should stay below the older 58px form-row height',
  )
  assertSourcePattern(
    themes,
    /\.settings-drawer \.settings-page\[data-section\] \.settings-tools-section > \.settings-mini-group:has\(> \.settings-tools-control\) > \.settings-tools-field\s*\{[\s\S]*?min-height:\s*34px;[\s\S]*?padding:\s*3px 5px;/m,
    'tools grouped backend fields should not be re-inflated by the provider-specific layout rule',
  )
  assertSourcePattern(
    themes,
    /\.settings-page\[data-section\] \.settings-chat-system-prompt\s*\{[\s\S]*?min-height:\s*88px;/m,
    'chat system prompt should no longer dominate the child page as a 140px text area',
  )
  assertSourcePattern(
    themes,
    /\.settings-drawer \.settings-page\[data-section='chat'\] \.settings-chat-relationship-card\s*\{[\s\S]*?gap:\s*4px;[\s\S]*?padding:\s*4px 5px;/m,
    'chat relationship options should read as a compact chooser instead of a large card group',
  )
  assertSourcePattern(
    themes,
    /\.settings-drawer \.settings-page\[data-section='chat'\] \.settings-chat-advanced-control:has\(> \.settings-toggle \+ p\) > p\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?width:\s*1px;[\s\S]*?height:\s*1px;[\s\S]*?clip-path:\s*inset\(50%\);[\s\S]*?white-space:\s*nowrap;/m,
    'chat helper copy should stay in the DOM without inflating compact advanced controls',
  )
  assertSourcePattern(
    themes,
    /\.settings-drawer \.settings-page\[data-section='chat'\] \.settings-choice-field--pet-model \.settings-choice-card\s*\{[\s\S]*?min-height:\s*36px;[\s\S]*?padding:\s*4px 5px;/m,
    'pet model cards should not keep the older tall choice-card rhythm',
  )
  assertSourcePattern(
    themes,
    /\.settings-drawer \.settings-page\[data-section='memory'\] \.settings-memory-transparency__card\s*\{[\s\S]*?min-height:\s*34px;[\s\S]*?padding:\s*4px 5px;[\s\S]*?align-content:\s*center;/m,
    'memory transparency summary cards should be short status tiles',
  )
  assertSourcePattern(
    themes,
    /\.settings-drawer \.settings-page\[data-section\] \.settings-memory-context-status\s*\{[\s\S]*?gap:\s*3px;[\s\S]*?min-height:\s*32px;[\s\S]*?padding:\s*3px 5px;/m,
    'memory context status rows should not keep the older 53px card height',
  )
  assertSourcePattern(
    themes,
    /\.settings-page\[data-section='model'\] \.settings-model-source-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(100%,\s*132px\),\s*176px\)\);[\s\S]*?justify-content:\s*start;/m,
    'model source cards should not stretch into oversized full-width tiles',
  )
  assertSourcePattern(
    themes,
    /\.settings-drawer \.settings-page\[data-section\] \.settings-model-source-card\s*\{[\s\S]*?grid-template-columns:\s*12px minmax\(0,\s*1fr\) 6px;[\s\S]*?min-height:\s*31px;[\s\S]*?padding:\s*3px 4px;/m,
    'model source cards should follow the smaller child-page row scale',
  )
  assertSourcePattern(
    themes,
    /\.settings-drawer \.settings-page\[data-section\] \.settings-model-source-card:last-child:nth-child\(odd\)\s*\{[\s\S]*?grid-column:\s*auto;/m,
    'odd model source cards should not stretch across the full source grid',
  )
  assertSourcePattern(
    themes,
    /\.onboarding-card\s*\{[\s\S]*?--onboarding-control-height:\s*var\(--settings-control-height\);[\s\S]*?--onboarding-font-size:\s*var\(--settings-control-font-size\);[\s\S]*?--onboarding-heading-small-font-size:\s*var\(--settings-heading-small-font-size\);/m,
    'nested onboarding settings flow should inherit the settings control scale',
  )
  assertSourcePattern(
    themes,
    /\.onboarding-card \.ghost-button,[\s\S]*?\.onboarding-card \.primary-button\s*\{[\s\S]*?min-height:\s*var\(--onboarding-control-height\);[\s\S]*?font-size:\s*var\(--onboarding-font-size\);/m,
    'onboarding buttons should use the inherited onboarding scale',
  )
})

test('memory transparency storage note stays user-facing', () => {
  const localeFiles = [
    'src/i18n/locales/zh-CN.ts',
    'src/i18n/locales/zh-TW.ts',
    'src/i18n/locales/en.ts',
    'src/i18n/locales/ja.ts',
    'src/i18n/locales/ko.ts',
  ]

  for (const localeFile of localeFiles) {
    const locale = readWorkspaceFile(localeFile)
    const match = locale.match(/'settings\.memory\.transparency\.storage_note':\s*'([^']+)'/)
    assert.ok(match, `missing storage note in ${localeFile}`)
    assert.doesNotMatch(
      match[1],
      /renderer|localStorage|SQLite/i,
      `${localeFile} storage note should not expose implementation storage names`,
    )
  }

  assertContains(
    readWorkspaceFile('src/i18n/locales/zh-CN.ts'),
    "'settings.memory.transparency.storage_note': '当前记忆和日记保存在本机；暂停后不会继续召回、写入或更新。'",
    'Chinese memory storage note should explain the privacy boundary in user-facing language',
  )
})

test('final warm child setting choices use soft segmented controls', () => {
  const finalSettings = [
    readWorkspaceFile('src/app/styles/settings-chat-final.css'),
    readWorkspaceFile('src/app/styles/settings-chat-role-final.css'),
  ].join('\n')
  const modelSection = readWorkspaceFile('src/components/settingsSections/ModelSection.tsx')

  assertSourcePattern(
    modelSection,
    /const \[detailsOpen, setDetailsOpen\] = useState\(true\)/m,
    'model settings should open the current provider detail first instead of a sparse provider list',
  )

  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light-section \.settings-page\[data-section='model'\] \.onboarding-region-tabs\s*\{[\s\S]*?gap:\s*2px;[\s\S]*?border:\s*1px solid var\(--settings-chat-parity-line\);[\s\S]*?border-radius:\s*9px;/m,
    'model region tabs should read as a soft segmented control rather than a table row',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light-section \.settings-page\[data-section='model'\] \.onboarding-region-tabs__tab\s*\{[\s\S]*?min-height:\s*30px;[\s\S]*?border:\s*1px solid transparent;[\s\S]*?border-radius:\s*7px;/m,
    'model region tab buttons should not keep square 0px corners',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light-section \.settings-page\[data-section='model'\] \.settings-model-detail-card\s*\{[\s\S]*?padding:\s*0 0 8px;[\s\S]*?border-radius:\s*0;[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none;/m,
    'model detail surface should flatten into the settings list rhythm instead of a raised nested card',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light-section \.settings-page\[data-section='model'\] \.settings-model-detail-brand\s*\{[\s\S]*?display:\s*grid;[\s\S]*?border:\s*0;[\s\S]*?border-radius:\s*0;[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none;/m,
    'model detail provider header should be a flat list header, not a white nested provider card',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light-section \.settings-page\[data-section='model'\] \.settings-model-detail-nav\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);[\s\S]*?gap:\s*0;[\s\S]*?border-bottom:\s*1px solid var\(--settings-chat-parity-line\);/m,
    'model detail action row should read as a quiet command strip, not two separated button boxes',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light-section \.settings-page\[data-section='model'\] \.settings-model-detail-nav \.ghost-button\s*\{[\s\S]*?min-height:\s*28px;[\s\S]*?border-color:\s*transparent;[\s\S]*?border-radius:\s*7px;[\s\S]*?background:\s*transparent;/m,
    'model detail action buttons should stay text-light and avoid raised button floors',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light-section \.settings-page\[data-section='model'\] \.settings-model-detail-fields\s*\{[\s\S]*?border-top:\s*0;[\s\S]*?border-radius:\s*0;[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none;/m,
    'model detail field group should stay transparent instead of becoming a rounded form card',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light-section \.settings-page\[data-section='model'\] \.settings-model-detail-fields > label\s*\{[\s\S]*?grid-template-columns:\s*minmax\(92px,\s*0\.32fr\) minmax\(0,\s*1fr\);[\s\S]*?min-height:\s*42px;[\s\S]*?border-bottom:\s*1px solid var\(--settings-chat-parity-line\);[\s\S]*?background:\s*transparent;/m,
    'model detail fields should use compact label plus native-safe value rows',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light-section \.settings-page\[data-section='model'\] \.settings-model-detail-fields > label > :is\(input:not\(\[type='checkbox'\]\):not\(\[type='range'\]\), select, \.settings-url-input\)\s*\{[\s\S]*?min-height:\s*32px;[\s\S]*?height:\s*32px;[\s\S]*?border-radius:\s*7px;[\s\S]*?background:\s*rgba\(255,\s*253,\s*249,\s*0\.12\);[\s\S]*?line-height:\s*30px;/m,
    'model detail native controls should be tall enough for Chinese text without becoming large cards',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light-section \.settings-page\[data-section='voice'\] \.settings-voice-loop-card > label\.settings-control-card\.settings-voice-field:not\(\.settings-metric-card\):not\(\.settings-updater-panel\)\s*\{[\s\S]*?grid-template-columns:\s*minmax\(108px,\s*0\.36fr\) minmax\(0,\s*1fr\);[\s\S]*?min-height:\s*44px;[\s\S]*?padding:\s*5px 2px;/m,
    'voice select rows should give VAD and trigger fields enough value space without becoming tall cards',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light-section \.settings-page\[data-section='voice'\] \.settings-voice-loop-card > label\.settings-control-card\.settings-voice-field:not\(\.settings-metric-card\):not\(\.settings-updater-panel\) > select\s*\{[\s\S]*?min-height:\s*34px;[\s\S]*?height:\s*34px;[\s\S]*?line-height:\s*1\.2;/m,
    'voice select controls should use native-safe vertical room for Chinese option text',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light-section \.settings-page\[data-section='voice'\] \.settings-speech-config-section > label\.settings-control-card\.settings-speech-config-field:not\(:has\(> textarea\)\):not\(:has\(> \.settings-drawer__hint\)\):not\(\.settings-metric-card\):not\(\.settings-updater-panel\)\s*\{[\s\S]*?grid-template-columns:\s*minmax\(108px,\s*0\.36fr\) minmax\(0,\s*1fr\);[\s\S]*?min-height:\s*44px;[\s\S]*?padding:\s*5px 2px;/m,
    'speech provider select rows should use the same wider value column as the VAD field',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light-section \.settings-page\[data-section='voice'\] \.settings-speech-config-section > label\.settings-control-card\.settings-speech-config-field:not\(:has\(> textarea\)\):not\(:has\(> \.settings-drawer__hint\)\):not\(\.settings-metric-card\):not\(\.settings-updater-panel\) > :is\(input:not\(\[type='checkbox'\]\):not\(\[type='range'\]\), select, \.settings-url-input\)\s*\{[\s\S]*?min-height:\s*34px;[\s\S]*?height:\s*34px;[\s\S]*?line-height:\s*1\.2;/m,
    'speech provider controls should keep the same native-safe vertical room as VAD selects',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light-section \.settings-page\[data-section='console'\] details\.settings-console-section > summary\.settings-console-section__header\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\) minmax\(36px,\s*auto\) 14px;[\s\S]*?min-height:\s*48px;[\s\S]*?height:\s*auto;[\s\S]*?border-radius:\s*0;[\s\S]*?background:\s*transparent;/m,
    'console detail rows should not keep the older 84px raised-card rhythm',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light-section \.settings-page\[data-section='console'\] details\.settings-console-section > summary\.settings-console-section__header p\s*\{[\s\S]*?line-height:\s*1\.32;[\s\S]*?-webkit-line-clamp:\s*2;/m,
    'console detail summaries should stay readable without forcing three-line cards',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light-section \.settings-page\[data-section='console'\] \.settings-console-sections > section\.settings-console-section\s*\{[\s\S]*?border-radius:\s*0;[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none;/m,
    'console observability details should use the same lightweight list shell as other diagnostics',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light-section \.settings-page\[data-section='console'\] \.settings-console-sections > section\.settings-console-section \.settings-console-card\s*\{[\s\S]*?min-height:\s*48px;[\s\S]*?border-bottom:\s*1px solid var\(--settings-chat-parity-line\);[\s\S]*?background:\s*transparent;/m,
    'console observability metric rows should not render as nested dashboard cards',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light-section \.settings-page\[data-section='lorebooks'\] \.settings-lorebook-check\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\) 44px;[\s\S]*?gap:\s*4px;[\s\S]*?padding:\s*0 6px;/m,
    'lorebook enable rows should leave enough room for the rendered 44px switch without horizontal overflow',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light-section \.settings-choice-card\.is-active,[\s\S]*?\.settings-drawer\.settings-drawer--light-section \.settings-model-source-card\.is-selected\s*\{[\s\S]*?border-color:\s*rgba\(185,\s*92,\s*60,\s*0\.1\);[\s\S]*?box-shadow:\s*inset 0 0 0 1px rgba\(185,\s*92,\s*60,\s*0\.1\);/m,
    'selected child-page choices should use a soft inset outline instead of a side stripe or underline',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light-section \.settings-page\[data-section='chat'\] \.settings-chat-identity-field > \.settings-form-row\s*\{[\s\S]*?grid-template-columns:\s*minmax\(70px,\s*0\.36fr\) minmax\(0,\s*1fr\);[\s\S]*?min-height:\s*30px;/m,
    'chat identity inputs should use compact label plus field rows instead of tall stacked cards',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light-section \.settings-page\[data-section='chat'\] \.settings-chat-identity-field > \.settings-form-row > input:not\(\[type='checkbox'\]\):not\(\[type='radio'\]\):not\(\[type='range'\]\)\s*\{[\s\S]*?border-color:\s*rgba\(75,\s*62,\s*49,\s*0\.045\);[\s\S]*?background:\s*rgba\(255,\s*253,\s*249,\s*0\.16\);[\s\S]*?box-shadow:\s*none;/m,
    'chat identity text inputs should stay low-contrast instead of returning to heavy form boxes',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light-section \.settings-page\[data-section='chat'\] \.onboarding-relationship__chip\s*\{[\s\S]*?min-height:\s*28px;[\s\S]*?border:\s*1px solid transparent;[\s\S]*?border-radius:\s*6px;/m,
    'relationship chips should stay lighter than the model tabs and avoid thick pill buttons',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light-section \.settings-page\[data-section='chat'\] \.settings-mini-group:has\(> \.settings-chat-system-prompt\)\s*\{[\s\S]*?padding:\s*0 0 8px;[\s\S]*?border-bottom:\s*1px solid var\(--settings-chat-parity-line\);[\s\S]*?background:\s*transparent;/m,
    'chat system prompt should read as one light settings group rather than a raised form card',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light-section \.settings-page\[data-section='chat'\] \.settings-mini-group:not\(\.settings-pet-model-card\):not\(\.settings-pet-preview-card\):not\(\.settings-pet-workflow-card\):has\(> \.settings-chat-system-prompt\):has\(> \.settings-control-card\)\s*\{[\s\S]*?border:\s*0;[\s\S]*?border-bottom:\s*1px solid var\(--settings-chat-parity-line\);/m,
    'chat system prompt group should beat the generic nested-control mini-group reset without using important',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light-section \.settings-page\[data-section='chat'\] \.settings-chat-system-prompt\s*\{[\s\S]*?height:\s*68px;[\s\S]*?min-height:\s*58px;[\s\S]*?max-height:\s*72px;[\s\S]*?border-color:\s*rgba\(75,\s*62,\s*49,\s*0\.045\);[\s\S]*?background:\s*rgba\(255,\s*253,\s*249,\s*0\.14\);/m,
    'chat system prompt textarea should stay visually lighter and shorter than a large editor',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light-section \.settings-page\[data-section='chat'\] \.settings-mini-group:has\(> \.settings-chat-system-prompt\) \.settings-chat-advanced-control > \.settings-toggle\s*\{[\s\S]*?min-height:\s*28px;[\s\S]*?padding:\s*0 3px;/m,
    'chat role-driven toggle should stay in the prompt group on the compact row scale',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light-section \.settings-page\[data-section='chat'\] \.settings-pet-model-card\s*\{[\s\S]*?padding:\s*0 0 6px;[\s\S]*?border-bottom-color:\s*var\(--settings-chat-parity-line\);[\s\S]*?background:\s*transparent;/m,
    'chat pet model chooser should read as a compact row list rather than a raised nested card',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light-section \.settings-page\[data-section='chat'\] \.settings-pet-model-card > \.settings-mini-group__head > span\s*\{[\s\S]*?display:\s*-webkit-box;[\s\S]*?white-space:\s*normal;[\s\S]*?-webkit-line-clamp:\s*2;/m,
    'chat pet model helper copy should wrap to two lines instead of clipping long companion descriptions',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light-section \.settings-page\[data-section='chat'\] \.settings-pet-model-card \.settings-choice-grid\s*\{[\s\S]*?gap:\s*1px;[\s\S]*?border:\s*1px solid var\(--settings-chat-parity-line\);[\s\S]*?border-radius:\s*9px;/m,
    'chat pet model choices should read as one compact segmented list instead of stacked cards',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light-section \.settings-page\[data-section='chat'\] \.settings-pet-model-card \.settings-choice-card\s*\{[\s\S]*?grid-template-columns:\s*minmax\(78px,\s*0\.34fr\) minmax\(0,\s*1fr\);[\s\S]*?min-height:\s*46px;[\s\S]*?padding:\s*5px 6px;[\s\S]*?border-radius:\s*7px;/m,
    'chat pet model options should use compact but readable label plus description rows',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light-section \.settings-page\[data-section='chat'\] \.settings-pet-model-card \.settings-choice-card__description\s*\{[\s\S]*?color:\s*rgba\(78,\s*64,\s*54,\s*0\.62\);[\s\S]*?text-align:\s*left;[\s\S]*?white-space:\s*normal;[\s\S]*?-webkit-line-clamp:\s*2;/m,
    'chat pet model descriptions should stay subdued and readable inside the compact row',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light-section \.settings-page\[data-section='chat'\] \.settings-pet-preview-card\s*\{[\s\S]*?padding:\s*0 0 8px;[\s\S]*?border-bottom-color:\s*var\(--settings-chat-parity-line\);[\s\S]*?background:\s*transparent;/m,
    'chat pet previews should read as embedded settings groups rather than raised debug cards',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light-section \.settings-page\[data-section='chat'\] \.settings-sprite-preview__stage\s*\{[\s\S]*?min-height:\s*118px;[\s\S]*?border-color:\s*var\(--settings-chat-parity-line\);[\s\S]*?background:\s*[\s\S]*?rgba\(255,\s*253,\s*249,\s*0\.12\);/m,
    'chat sprite preview stage should stay compact and visually attached to the warm settings surface',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light-section \.settings-page\[data-section='chat'\] \.settings-sprite-preview__states button,[\s\S]*?\.settings-drawer\.settings-drawer--light-section \.settings-page\[data-section='chat'\] \.settings-companion-state-preview__states button\s*\{[\s\S]*?min-height:\s*28px;[\s\S]*?padding:\s*0 5px;[\s\S]*?border-radius:\s*7px;/m,
    'chat preview state buttons should use the same compact segmented scale as the role chips',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light-section \.settings-page\[data-section='chat'\] \.settings-pet-action-row\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);[\s\S]*?gap:\s*4px;[\s\S]*?border:\s*1px solid var\(--settings-chat-parity-line\);[\s\S]*?border-radius:\s*9px;/m,
    'chat pet import commands should read as one compact segmented command row rather than stacked tool cards',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light-section \.settings-page\[data-section='chat'\] \.settings-pet-tools > \.settings-mini-group__note\s*\{[\s\S]*?max-height:\s*50px;[\s\S]*?border:\s*0;[\s\S]*?background:\s*transparent;[\s\S]*?-webkit-line-clamp:\s*3;/m,
    'chat pet import hint should stay a subdued note rather than a raised explanatory card',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light-section \.settings-page\[data-section='chat'\] \.settings-pet-workflow-card\s*\{[\s\S]*?padding:\s*0 0 8px;[\s\S]*?border-bottom-color:\s*var\(--settings-chat-parity-line\);[\s\S]*?border-radius:\s*0;[\s\S]*?background:\s*transparent;/m,
    'chat pet workflow panels should flatten into the settings list rhythm instead of raised developer cards',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light-section \.settings-page\[data-section='chat'\] \.settings-community-links\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex-wrap:\s*wrap;[\s\S]*?gap:\s*4px;[\s\S]*?padding:\s*0;[\s\S]*?border:\s*0;[\s\S]*?background:\s*transparent;/m,
    'community pet sources should stay in a compact settings link group instead of a tall stacked directory',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light-section \.settings-page\[data-section='chat'\] \.settings-community-links a\s*\{[\s\S]*?flex:\s*1 1 132px;[\s\S]*?min-height:\s*28px;[\s\S]*?font-size:\s*11px;/m,
    'community pet source links should use a stable two-column width so source labels do not clip',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light-section \.settings-page\[data-section='chat'\] \.settings-community-links__text\s*\{[\s\S]*?overflow:\s*visible;[\s\S]*?text-overflow:\s*clip;[\s\S]*?white-space:\s*normal;/m,
    'community pet source labels should wrap instead of being ellipsized inside narrow link buttons',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light-section \.settings-page\[data-section='memory'\] \.settings-memory-context-status-grid\s*\{[\s\S]*?gap:\s*0;[\s\S]*?border-top:\s*1px solid var\(--settings-chat-parity-line\);/m,
    'memory context diagnostics should read as a compact trust-status row list',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light-section \.settings-page\[data-section='memory'\] \.settings-memory-transparency__grid\s*\{[\s\S]*?grid-template-columns:\s*1fr;[\s\S]*?gap:\s*0;[\s\S]*?border-top:\s*1px solid var\(--settings-chat-parity-line\);/m,
    'memory transparency summary should use one status list instead of a dashboard tile grid',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light-section \.settings-page\[data-section='memory'\] \.settings-control-card\.settings-memory-transparency__card:not\(\.settings-metric-card\):not\(\.settings-updater-panel\)\s*\{[\s\S]*?grid-template-columns:\s*minmax\(72px,\s*0\.28fr\) minmax\(0,\s*1fr\);[\s\S]*?min-height:\s*36px;[\s\S]*?border-bottom:\s*1px solid var\(--settings-chat-parity-line\);[\s\S]*?background:\s*transparent;/m,
    'memory transparency summary rows should align with the chat-style settings row rhythm',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light-section \.settings-page\[data-section='memory'\] \.settings-memory-context-status\s*\{[\s\S]*?min-height:\s*44px;[\s\S]*?border-bottom:\s*1px solid var\(--settings-chat-parity-line\);[\s\S]*?background:\s*transparent;/m,
    'memory context status rows should not look like dashboard cards',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light-section \.settings-page\[data-section='memory'\] \.settings-memory-context-transparency__row\s*\{[\s\S]*?grid-template-columns:\s*minmax\(80px,\s*0\.33fr\) minmax\(0,\s*1fr\);[\s\S]*?min-height:\s*30px;/m,
    'memory transparency detail rows should use compact label plus detail structure',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light-section \.settings-page\[data-section='memory'\] \.settings-memory-group > label\.settings-memory-field > select\s*\{[\s\S]*?min-height:\s*32px;[\s\S]*?height:\s*32px;[\s\S]*?line-height:\s*30px;[\s\S]*?padding:\s*0 34px 0 8px;/m,
    'memory select rows should be tall enough for native dropdown text without breaking the compact settings rhythm',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light-section \.settings-page\[data-section='memory'\] \.settings-memory-group > \.settings-memory-field > \.settings-form-row > input:not\(\[type='checkbox'\]\):not\(\[type='radio'\]\):not\(\[type='range'\]\),[\s\S]*?\.settings-memory-recall-grid input:not\(\[type='checkbox'\]\):not\(\[type='range'\]\)\s*\{[\s\S]*?height:\s*30px;/m,
    'memory text inputs should stay at the shared compact row height while selects get their own native-safe height',
  )
})

test('warm-day settings drawer uses trace-list surfaces', () => {
  const themes = readWorkspaceFile('src/app/styles/settings-themes.css')
  const finalSettings = readWorkspaceFile('src/app/styles/settings-chat-final.css')

  assertSourcePattern(
    themes,
    /\.settings-drawer--warm-day\s*\{[\s\S]*?--settings-trace-cool:\s*rgba\(80,\s*125,\s*198,\s*0\.56\);[\s\S]*?--settings-trace-warm:\s*rgba\(206,\s*122,\s*76,\s*0\.54\);/m,
    'warm-day settings drawer should define shared trace colors',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer\.settings-drawer--light\.settings-drawer--home \.settings-drawer__toolbar,[\s\S]*?\.settings-drawer\.settings-drawer--light\.settings-drawer--section \.settings-drawer__toolbar\s*\{[\s\S]*?gap:\s*3px;[\s\S]*?padding:\s*0;[\s\S]*?border:\s*0;/m,
    'warm-day settings toolbar should be a compact glyph cluster from the final settings shell',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer__language-button,[\s\S]*?\.settings-drawer__icon-button\s*\{[\s\S]*?width:\s*20px;[\s\S]*?height:\s*20px;[\s\S]*?min-width:\s*20px;/m,
    'warm-day settings toolbar buttons should stay compact icon glyph controls',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer__icon-button--danger:hover\s*\{[\s\S]*?border-color:\s*rgba\(160,\s*62,\s*46,\s*0\.12\);[\s\S]*?background:\s*rgba\(160,\s*62,\s*46,\s*0\.08\);/m,
    'warm-day settings close button should keep a subtle danger hover tone',
  )
  assert.ok(!themes.includes('settings-home-release'), 'warm-day theme should not keep settings-home release-card styles')
  assertSourcePattern(
    themes,
    /\.settings-drawer--warm-day \.settings-drawer__actions\s*\{[\s\S]*?background:\s*rgba\(255,\s*253,\s*249,\s*0\.68\);[\s\S]*?box-shadow:\s*none;/m,
    'warm-day settings footer should not cast a raised panel shadow over trace rows',
  )
  assertSourcePattern(
    themes,
    /\.settings-drawer--warm-day \.settings-drawer__actions \.primary-button,[\s\S]*?html\[data-theme='warm-day'\] \.settings-drawer--warm-day \.settings-drawer__actions \.primary-button,[\s\S]*?html\[data-theme='system-day'\] \.settings-drawer--warm-day \.settings-drawer__actions \.primary-button\s*\{[\s\S]*?background:\s*rgba\(186,\s*92,\s*60,\s*0\.92\);[\s\S]*?box-shadow:\s*none;/m,
    'warm-day settings save action should keep primary color without orange lift',
  )
  assertSourcePattern(
    themes,
    /\.settings-drawer--warm-day \.settings-section-nav__button,[\s\S]*?\.settings-drawer--warm-day \.settings-home-card:nth-child\(even\):hover\s*\{[\s\S]*?border-left:\s*2px solid transparent;[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none;/m,
    'warm-day settings nav and home rows should start as flat trace rows',
  )
  assertSourcePattern(
    themes,
    /\.settings-drawer--warm-day \.settings-section-nav__button\.is-active\s*\{[\s\S]*?border-left-color:\s*var\(--settings-trace-cool\);[\s\S]*?background:\s*rgba\(255,\s*253,\s*249,\s*0\.58\);[\s\S]*?box-shadow:\s*none;/m,
    'active warm-day settings nav item should use a cool trace edge rather than a raised card',
  )
  assertSourcePattern(
    themes,
    /\.settings-drawer--warm-day \.settings-home-card,[\s\S]*?\.settings-drawer--warm-day \.settings-home-card\[data-trust-group\]\s*\{[\s\S]*?border-left-color:\s*color-mix\(in srgb,\s*var\(--settings-trust-trace,\s*var\(--settings-trace-cool\)\)\s*64%,\s*transparent\);/m,
    'warm-day settings home rows should use section trust traces without becoming raised cards',
  )
  assertSourcePattern(
    themes,
    /\.settings-drawer--warm-day \.settings-home-card\[data-trust-group='memoryContext'\]\s*\{[\s\S]*?--settings-trust-trace:\s*var\(--settings-trace-memory\);/m,
    'warm-day memory settings rows should expose a distinct trust trace',
  )
  assertSourcePattern(
    themes,
    /\.settings-drawer--warm-day \.settings-home-card\[data-trust-group='permissionsIntegrations'\]\s*\{[\s\S]*?--settings-trust-trace:\s*var\(--settings-trace-permission\);/m,
    'warm-day permissions and integration settings rows should expose a distinct trust trace',
  )
  assertSourcePattern(
    themes,
    /\.settings-drawer--warm-day \.settings-drawer__content,[\s\S]*?\.settings-drawer--warm-day \.settings-section\s*\{[\s\S]*?background:\s*rgba\(255,\s*253,\s*249,\s*0\.38\);[\s\S]*?box-shadow:\s*none;/m,
    'warm-day settings content and sections should stay flat enough for trace-list styling',
  )
  assertSourcePattern(
    themes,
    /\.settings-drawer--warm-day \.settings-section:hover\s*\{[\s\S]*?border-left-color:\s*var\(--settings-trace-warm\);[\s\S]*?background:\s*rgba\(255,\s*253,\s*249,\s*0\.52\);[\s\S]*?box-shadow:\s*none;/m,
    'warm-day settings section hover should clarify edge state without lift',
  )
})

test('panel window controls stay compact, icon-only, and visually distinct', () => {
  const app = readWorkspaceFile('src/app/App.css')
  const toolbarControls = readWorkspaceFile('src/app/styles/panel-toolbar-controls.css')
  const panelCompanion = readWorkspaceFile('src/app/styles/panel-companion-shell.css')
  const panelFinal = readWorkspaceFile('src/app/styles/panel-companion-final.css')
  const panelView = readWorkspaceFile('src/app/views/PanelView.tsx')
  const simpleToolbarSource = extractSourceRange(
    panelView,
    'panel-window__header-actions panel-window__header-actions--simple',
    '<div className="panel-window__collapsed-bar">',
  )
  const heroToolbarSource = extractSourceRange(
    panelView,
    'panel-window__header-actions panel-window__header-actions--hero',
    '{notificationBridge && hasUnreadNotifications ? (',
  )
  const toolbarControlSource = extractSourceRange(
    toolbarControls,
    '/* Panel toolbar controls: Nexus trace glyphs with context-aware reveal. */',
    '@media (max-width: 340px)',
  )
  const collapsedToolbarSource = extractSourceRange(
    app,
    '.panel-window--companion.is-collapsed .panel-window__header-actions--simple {',
    '.panel-window--companion .companion-chat__messages:has(> .empty-chat--nexus):not(:has(> .crisis-hotline-panel))',
  )
  const compactHeightSource = extractSourceRange(
    app,
    '@media (max-height: 220px)',
    '@media (max-width: 260px) and (max-height: 220px)',
  )

  assertSourcePattern(
    toolbarControls,
    /\.panel-window--companion \.panel-window__header-actions--hero\s*\{[\s\S]*?gap:\s*5px;[\s\S]*?padding:\s*2px 3px;[\s\S]*?background:\s*rgba\(12,\s*15,\s*22,\s*0\.12\);[\s\S]*?opacity:\s*0\.82;/m,
    'panel window controls should rest as a readable trace glyph cluster without growing',
  )
  assertSourcePattern(
    toolbarControls,
    /\.panel-window--companion \.companion-chat__toolbar:hover \.panel-window__header-actions--hero,[\s\S]*?\.panel-window--companion \.panel-window__header-actions--hero:hover,[\s\S]*?\.panel-window--companion \.panel-window__header-actions--hero:focus-within\s*\{[\s\S]*?opacity:\s*1;/m,
    'expanded panel controls should reveal only when the toolbar is active',
  )
  assertSourcePattern(
    toolbarControls,
    /\.panel-window--companion \.panel-window__header-actions--hero \.panel-window__icon-button\s*\{[\s\S]*?width:\s*24px;[\s\S]*?height:\s*24px;[\s\S]*?min-width:\s*24px;[\s\S]*?border-radius:\s*999px;/m,
    'panel window controls should stay small fixed-size trace glyph buttons',
  )
  assertSourcePattern(
    collapsedToolbarSource,
    /\.panel-window--companion\.is-collapsed \.panel-window__header-actions--simple\s*\{[\s\S]*?gap:\s*5px;[\s\S]*?border-radius:\s*999px;[\s\S]*?background:\s*rgba\(12,\s*15,\s*22,\s*0\.12\);[\s\S]*?box-shadow:\s*none;/m,
    'collapsed panel controls should also use a trace glyph cluster',
  )
  assertSourcePattern(
    collapsedToolbarSource,
    /\.panel-window--companion\.is-collapsed \.panel-window__header-actions--simple \.panel-window__icon-button\s*\{[\s\S]*?width:\s*30px;[\s\S]*?height:\s*30px;[\s\S]*?border-radius:\s*999px;[\s\S]*?box-shadow:\s*none;[\s\S]*?backdrop-filter:\s*none;/m,
    'collapsed panel controls should not fall back to 40px raised buttons',
  )
  assert.doesNotMatch(
    compactHeightSource,
    /\.panel-window--companion\.is-collapsed \.panel-window__icon-button\s*\{[\s\S]*?(?:width|height|min-width):\s*34px;/m,
    'short collapsed layouts should not enlarge the compact 30px toolbar buttons',
  )
  assertSourcePattern(
    collapsedToolbarSource,
    /html\[data-theme='warm-day'\] \.panel-window--companion\.is-collapsed \.panel-window__header-actions--simple \.panel-window__icon-button:hover\s*\{[\s\S]*?background:\s*rgba\(255,\s*255,\s*255,\s*0\.52\);[\s\S]*?color:\s*rgba\(36,\s*27,\s*22,\s*0\.94\);/m,
    'warm-day collapsed panel controls should reveal without extra lift rules',
  )
  assertSourcePattern(
    collapsedToolbarSource,
    /\.panel-window--companion\.is-collapsed \.panel-window__header-actions--simple \.panel-window__icon-button--danger\s*\{[\s\S]*?color:\s*rgba\(255,\s*202,\s*198,\s*0\.72\);/m,
    'collapsed close control should be identifiable at rest without changing button size',
  )
  assertSourcePattern(
    collapsedToolbarSource,
    /html\[data-theme='warm-day'\] \.panel-window--companion\.is-collapsed \.panel-window__header-actions--simple \.panel-window__icon-button--danger\s*\{[\s\S]*?color:\s*rgba\(126,\s*32,\s*27,\s*0\.62\);/m,
    'warm-day collapsed close control should keep a subtle danger tone at rest',
  )
  assertSourcePattern(
    collapsedToolbarSource,
    /html\[data-theme='warm-day'\] \.panel-window--companion\.is-collapsed \.panel-window__header-actions--simple \.panel-window__icon-button--danger:hover\s*\{[\s\S]*?background:\s*rgba\(206,\s*68,\s*56,\s*0\.08\);[\s\S]*?color:\s*rgba\(126,\s*32,\s*27,\s*0\.98\);/m,
    'warm-day collapsed close hover should reveal danger state without using a large traffic-light control',
  )
  assertSourcePattern(
    toolbarControls,
    /\.panel-window--companion \.panel-window__header-actions--hero \.panel-window__icon-button svg\s*\{[\s\S]*?width:\s*15px;[\s\S]*?height:\s*15px;[\s\S]*?opacity:\s*0\.86;[\s\S]*?stroke-width:\s*1\.85;/m,
    'panel window control icons should stay thin while remaining legible',
  )
  assertSourcePattern(
    toolbarControls,
    /\.panel-window--companion \.panel-window__header-actions--hero \.panel-window__icon-button::after\s*\{[\s\S]*?content:\s*none;/m,
    'panel window controls should not render aria-label text inside the buttons',
  )
  assertSourcePattern(
    toolbarControls,
    /\.panel-window--companion \.panel-window__header-actions--hero \.panel-window__icon-button:hover\s*\{[\s\S]*?background:\s*var\(--panel-toolbar-control-hover-bg\);/m,
    'panel window control hover state should be rendered by one shared rule',
  )
  assertSourcePattern(
    toolbarControls,
    /html\[data-theme='warm-day'\] \.panel-window--companion \.panel-window__header-actions--hero \.panel-window__icon-button\s*\{[\s\S]*?background:\s*var\(--panel-toolbar-control-bg\);[\s\S]*?color:\s*var\(--panel-toolbar-control-color\);/m,
    'warm-day panel controls should keep the same local color variables as the default theme',
  )
  assertSourcePattern(
    toolbarControls,
    /html\[data-theme='warm-day'\] \.panel-window--companion \.panel-window__header-actions--hero\s*\{[\s\S]*?border-color:\s*rgba\(72,\s*53,\s*40,\s*0\.12\);[\s\S]*?background:\s*rgba\(255,\s*252,\s*247,\s*0\.32\);/m,
    'warm-day panel controls should stay as a readable trace cluster instead of a glass pill',
  )
  assertSourcePattern(
    toolbarControls,
    /html\[data-theme='warm-day'\] \.panel-window--companion \.panel-window__header-actions--hero \.panel-window__icon-button\s*\{[\s\S]*?--panel-toolbar-control-bg:\s*rgba\(255,\s*253,\s*249,\s*0\.36\);[\s\S]*?--panel-toolbar-control-color:\s*rgba\(36,\s*27,\s*22,\s*0\.72\);/m,
    'warm-day panel icon buttons should be visible before hover reveal',
  )
  assertSourcePattern(
    toolbarControls,
    /html\[data-theme='warm-day'\] \.panel-window--companion \.panel-window__header-actions--hero \.panel-window__icon-button--collapse\s*\{[\s\S]*?--panel-toolbar-control-color:\s*rgba\(92,\s*59,\s*15,\s*0\.68\);/m,
    'warm-day collapse control should have a subtle functional tone at rest',
  )
  assertSourcePattern(
    toolbarControls,
    /html\[data-theme='warm-day'\] \.panel-window--companion \.panel-window__header-actions--hero \.panel-window__icon-button\.panel-window__icon-button--danger\s*\{[\s\S]*?--panel-toolbar-control-color:\s*rgba\(126,\s*32,\s*27,\s*0\.66\);/m,
    'warm-day close control should be distinguishable without becoming a large danger button',
  )
  assertSourcePattern(
    panelCompanion,
    /\/\* Image 4 simple button system\. \*\/[\s\S]*?\.panel-window--image4 \.panel-window__header-actions--image4,[\s\S]*?html\[data-theme='warm-day'\] \.panel-window--image4 \.panel-window__header-actions--image4\s*\{[\s\S]*?gap:\s*clamp\(4px,\s*0\.8vw,\s*6px\);[\s\S]*?padding:\s*2px 3px;[\s\S]*?border:\s*1px solid rgba\(73,\s*94,\s*114,\s*0\.12\);[\s\S]*?border-radius:\s*12px;[\s\S]*?background:\s*rgba\(255,\s*255,\s*255,\s*0\.24\);/m,
    'Image4 warm-day toolbar should remain a readable rail instead of dissolving into loose icons',
  )
  assertSourcePattern(
    panelCompanion,
    /\.panel-window--image4 \.panel-window__header-actions--image4 \.panel-window__icon-button,[\s\S]*?html\[data-theme='warm-day'\] \.panel-window--image4 \.panel-window__header-actions--image4 \.panel-window__icon-button\s*\{[\s\S]*?width:\s*clamp\(24px,\s*3\.8vw,\s*34px\);[\s\S]*?height:\s*clamp\(24px,\s*3\.8vw,\s*34px\);[\s\S]*?min-width:\s*clamp\(24px,\s*3\.8vw,\s*34px\);/m,
    'Image4 toolbar buttons should not grow back to oversized square controls',
  )
  assertSourcePattern(
    panelCompanion,
    /\.panel-window--image4 \.panel-window__header-actions--image4 \.panel-window__icon-button--settings,[\s\S]*?html\[data-theme='warm-day'\] \.panel-window--image4 \.panel-window__header-actions--image4 \.panel-window__icon-button--settings\s*\{[\s\S]*?color:\s*rgba\(214,\s*228,\s*255,\s*0\.78\);/m,
    'Image4 settings control should keep a distinct cool utility tone',
  )
  assertSourcePattern(
    panelCompanion,
    /\.panel-window--image4 \.panel-window__header-actions--image4 \.panel-window__icon-button--collapse,[\s\S]*?html\[data-theme='warm-day'\] \.panel-window--image4 \.panel-window__header-actions--image4 \.panel-window__icon-button--collapse\s*\{[\s\S]*?color:\s*rgba\(255,\s*213,\s*145,\s*0\.66\);/m,
    'Image4 collapse control should keep a distinct warm utility tone',
  )
  assertSourcePattern(
    panelCompanion,
    /html\[data-theme='warm-day'\] \.panel-window--image4 \.panel-window__header-actions--image4 \.panel-window__icon-button--danger\s*\{[\s\S]*?color:\s*rgba\(126,\s*32,\s*27,\s*0\.72\);/m,
    'Image4 warm-day close control should be identifiable without becoming visually loud',
  )
  assertSourcePattern(
    panelCompanion,
    /\.panel-window--image4 \.panel-window__header-actions--image4 \.panel-window__icon-button svg\s*\{[\s\S]*?width:\s*clamp\(13px,\s*2\.1vw,\s*18px\);[\s\S]*?height:\s*clamp\(13px,\s*2\.1vw,\s*18px\);/m,
    'Image4 toolbar icons should stay on the compact scale',
  )
  assertSourcePattern(
    panelCompanion,
    /\.panel-window--image4 \.panel-window__header-actions--image4 \.panel-window__icon-button:hover,[\s\S]*?html\[data-theme='warm-day'\] \.panel-window--image4 \.panel-window__header-actions--image4 \.panel-window__icon-button:hover\s*\{[\s\S]*?transform:\s*none;[\s\S]*?background:\s*var\(--image4-state-hover-neutral-bg\);/m,
    'Image4 toolbar hover should reveal without moving the controls',
  )
  assertSourcePattern(
    panelCompanion,
    /\.panel-window--image4 \.panel-window__header-actions--image4 \.panel-window__icon-button:focus-visible,[\s\S]*?html\[data-theme='warm-day'\] \.panel-window--image4 \.panel-window__header-actions--image4 \.panel-window__icon-button:focus-visible\s*\{[\s\S]*?box-shadow:\s*var\(--image4-state-focus-ring\);/m,
    'Image4 toolbar focus should use the shared interaction-state ring',
  )
  assertSourcePattern(
    panelCompanion,
    /\.panel-window--image4 \.panel-window__header-actions--image4 \.panel-window__icon-button--danger:hover,[\s\S]*?html\[data-theme='warm-day'\] \.panel-window--image4 \.panel-window__header-actions--image4 \.panel-window__icon-button--danger:hover\s*\{[\s\S]*?background:\s*var\(--image4-state-hover-danger-bg\);[\s\S]*?color:\s*rgba\(255,\s*180,\s*185,\s*0\.88\);/m,
    'Image4 close hover should remain a subtle danger cue on the dark toolbar',
  )
  assertSourcePattern(
    panelFinal,
    /\.panel-window--image4 \.companion-chat__toolbar\.image4-header-controls,[\s\S]*?html\[data-theme='warm-day'\] \.panel-window--image4 \.companion-chat__toolbar\.image4-header-controls\s*\{[\s\S]*?top:\s*clamp\(58px,\s*15\.8cqw,\s*66px\);[\s\S]*?right:\s*clamp\(12px,\s*3\.2cqw,\s*18px\);/m,
    'final Image4 top controls should sit on the companion identity line',
  )
  assertSourcePattern(
    panelFinal,
    /\.panel-window--image4 \.panel-window__header-actions--image4,[\s\S]*?html\[data-theme='warm-day'\] \.panel-window--image4 \.panel-window__header-actions--image4\s*\{[\s\S]*?gap:\s*3px !important;[\s\S]*?padding:\s*0 !important;[\s\S]*?border:\s*0 !important;[\s\S]*?background:\s*transparent !important;[\s\S]*?backdrop-filter:\s*none;/m,
    'final Image4 top controls should not render as a separate floating tray',
  )
  assertSourcePattern(
    panelFinal,
    /\.panel-window--image4 \.panel-window__header-actions--image4 \.panel-window__icon-button,[\s\S]*?html\[data-theme='warm-day'\] \.panel-window--image4 \.panel-window__header-actions--image4 \.panel-window__icon-button--danger\s*\{[\s\S]*?width:\s*clamp\(23px,\s*3\.1vw,\s*26px\)[\s\S]*?border:\s*1px solid transparent !important;[\s\S]*?background:\s*transparent !important;[\s\S]*?box-shadow:\s*none !important;/m,
    'final Image4 top control buttons should stay compact and tray-free',
  )
  assertSourcePattern(
    panelFinal,
    /html\[data-theme='warm-day'\] \.panel-window--image4 \.panel-window__header-actions--image4 \.panel-window__icon-button--danger:hover\s*\{[\s\S]*?background:\s*rgba\(160,\s*62,\s*46,\s*0\.08\) !important;[\s\S]*?color:\s*rgba\(122,\s*48,\s*38,\s*0\.9\);/m,
    'final warm-day close hover should reveal danger without a permanent red button',
  )
  assert.doesNotMatch(
    app,
    /html\[data-theme='warm-day'\] \.panel-window--companion \.panel-window__icon-button\s*\{[\s\S]*?0 8px 18px rgba\(72,\s*53,\s*40,\s*0\.1\)/m,
    'warm-day panel controls should not reintroduce a broad raised icon-button rule',
  )
  assert.doesNotMatch(
    app,
    /^\.panel-window--companion \.panel-window__icon-button(?::hover)?\s*\{/m,
    'companion panel controls should not keep a broad raised icon-button override above the trace rules',
  )
  assertSourceOrder(
    toolbarControls,
    '/* Panel toolbar controls: Nexus trace glyphs with context-aware reveal. */',
    "html[data-theme='warm-day'] .panel-window--companion .panel-window__header-actions--hero .panel-window__icon-button {",
    'toolbar-specific warm-day variable rules should stay inside the final toolbar control block',
  )
  assert.doesNotMatch(
    toolbarControlSource,
    /linear-gradient\(/m,
    'panel toolbar controls should avoid saturated candy-like gradients',
  )
  assertSourcePattern(
    toolbarControls,
    /\.panel-window--companion \.panel-window__header-actions--hero \.panel-window__icon-button--settings\s*\{[\s\S]*?--panel-toolbar-control-color:\s*rgba\(221,\s*234,\s*255,\s*0\.76\);[\s\S]*?--panel-toolbar-control-hover-color:\s*rgba\(255,\s*255,\s*255,\s*0\.98\);/m,
    'settings control should stay neutral but readable in the trace glyph cluster',
  )
  assertSourcePattern(
    toolbarControls,
    /\.panel-window--companion \.panel-window__header-actions--hero \.panel-window__icon-button--collapse\s*\{[\s\S]*?--panel-toolbar-control-color:\s*rgba\(221,\s*234,\s*255,\s*0\.7\);[\s\S]*?--panel-toolbar-control-hover-bg:\s*rgba\(255,\s*202,\s*91,\s*0\.1\);/m,
    'collapse control should stay readable and only warm up on hover reveal',
  )
  assertSourcePattern(
    toolbarControls,
    /\.panel-window--companion \.panel-window__header-actions--hero \.panel-window__icon-button\.panel-window__icon-button--danger\s*\{[\s\S]*?--panel-toolbar-control-bg:\s*rgba\(255,\s*79,\s*70,\s*0\.055\);[\s\S]*?--panel-toolbar-control-color:\s*rgba\(221,\s*234,\s*255,\s*0\.68\);/m,
    'close control should not look like a permanent traffic-light dot',
  )
  assert.doesNotMatch(
    toolbarControls,
    /\.panel-window--companion \.panel-window__header-actions--hero \.panel-window__icon-button:nth-of-type\(/m,
    'panel control tones should use explicit classes rather than button order',
  )
  assert.doesNotMatch(
    toolbarControls,
    /\.panel-window--companion \.panel-window__header-actions--hero \.panel-window__icon-button--(?:settings|collapse):hover\s*\{/m,
    'individual panel controls should not need duplicate hover blocks',
  )
  assertSourcePattern(
    toolbarControls,
    /html\[data-theme='warm-day'\] \.panel-window--companion \.panel-window__header-actions--hero \.panel-window__icon-button\.panel-window__icon-button--danger\s*\{[\s\S]*?--panel-toolbar-control-bg:\s*rgba\(206,\s*68,\s*56,\s*0\.055\);[\s\S]*?--panel-toolbar-control-color:\s*rgba\(126,\s*32,\s*27,\s*0\.66\);/m,
    'warm-day close control should be identifiable without becoming a traffic-light button',
  )
  assert.doesNotMatch(
    toolbarControls,
    /\.panel-window--companion \.panel-window__header-actions--hero \.panel-window__icon-button::after\s*\{[\s\S]*?content:\s*attr\(aria-label\)/m,
    'panel window control labels belong in aria-label/title, not inside the compact buttons',
  )
  assertContains(
    heroToolbarSource,
    'tone="settings"',
    'expanded settings toolbar button should carry an explicit settings tone class',
  )
  assertContains(
    heroToolbarSource,
    'tone="collapse"',
    'expanded collapse toolbar button should carry an explicit collapse tone class',
  )
  assertContains(
    heroToolbarSource,
    'tone="danger"',
    'expanded close toolbar button should carry an explicit danger tone class',
  )
  assert.doesNotMatch(
    simpleToolbarSource,
    /tone="settings"|tone="collapse"/,
    'collapsed toolbar should not inherit expanded-only settings/collapse tones',
  )
})

test('Image4 companion surface keeps the selected rhythm-grid preview structure', () => {
  const app = readWorkspaceFile('src/app/App.css')
  const appView = readWorkspaceFile('src/app/App.tsx')
  const panelCompanionHub = readWorkspaceFile('src/app/styles/panel-companion.css')
  const panelCompanionShell = readWorkspaceFile('src/app/styles/panel-companion-shell.css')
  const panelCompanionCollapsed = readWorkspaceFile('src/app/styles/panel-companion-collapsed.css')
  const panelCompanionDial = readWorkspaceFile('src/app/styles/panel-companion-dial.css')
  const panelCompanionLayout = readWorkspaceFile('src/app/styles/panel-companion-layout.css')
  const panelCompanionChat = readWorkspaceFile('src/app/styles/panel-companion-chat.css')
  const panelCompanionMessages = readWorkspaceFile('src/app/styles/panel-companion-messages.css')
  const panelCompanionComposer = readWorkspaceFile('src/app/styles/panel-companion-composer.css')
  const panelCompanionRhythm = readWorkspaceFile('src/app/styles/panel-companion-rhythm.css')
  const panelCompanionMotion = readWorkspaceFile('src/app/styles/panel-companion-motion.css')
  const panelView = readWorkspaceFile('src/app/views/PanelView.tsx')
  const image4CompanionField = readWorkspaceFile('src/app/views/Image4CompanionField.tsx')

  assertContains(appView, "import './styles/panel-companion.css'", 'companion redesign should load after the base app stylesheet')
  assertContains(panelCompanionHub, "@import './panel-companion-shell.css';", 'Image4 shell styles should stay split from the import hub')
  assertContains(panelCompanionHub, "@import './panel-companion-collapsed.css';", 'collapsed companion shell styles should stay split from Image4 chat styles')
  assertContains(panelCompanionHub, "@import './panel-companion-dial.css';", 'Image4 dial styles should stay split from the import hub')
  assertContains(panelCompanionHub, "@import './panel-companion-layout.css';", 'Image4 layout styles should stay split from the import hub')
  assertContains(panelCompanionHub, "@import './panel-companion-chat.css';", 'Image4 chat styles should stay split from the import hub')
  assertContains(panelCompanionHub, "@import './panel-companion-messages.css';", 'Image4 active-chat message styles should stay split from the import hub')
  assertContains(panelCompanionHub, "@import './panel-companion-composer.css';", 'Image4 composer styles should stay split from the import hub')
  assertContains(panelCompanionHub, "@import './panel-companion-rhythm.css';", 'Image4 rhythm-grid styles should stay split from the import hub')
  assertContains(panelCompanionHub, "@import './panel-companion-motion.css';", 'Image4 motion styles should stay split from the import hub')
  assert.doesNotMatch(
    app,
    /\/\* Companion panel redesign: match the selected night-glass preview\. \*\//m,
    'companion redesign overrides should live outside App.css to keep the base stylesheet under budget',
  )
  assertContains(panelView, 'panel-window--image4', 'expanded panel should opt into the Image4 visual route')
  assertContains(panelView, 'panel-window__shell--image4 image4-layout', 'Image4 panel should use the dedicated shell hook')
  assertContains(panelView, 'panel-window__header-actions--image4', 'Image4 panel should use the dedicated top-control hook')
  assertContains(panelView, 'Image4RhythmGrid', 'Image4 rhythm grid should stay renderable for calibration')
  assertContains(panelView, 'Image4PresenceHeader', 'Image4 presence should stay componentized')
  assertContains(panelView, 'Image4Dial', 'Image4 dial should stay componentized')
  assertContains(image4CompanionField, 'Image4Signal', 'Image4 signal should stay componentized')
  assertContains(image4CompanionField, 'const presenceLabel = statusLabel ? `${title} · ${statusLabel}` : title', 'Image4 status should stay available as a non-visual accessible label')
  assertContains(image4CompanionField, 'className="companion-presence image4-presence"', 'field component should render the Image4 presence area')
  assertContains(image4CompanionField, 'className="image4-dial-stage"', 'field component should render the Image4 dial stage')
  assert.doesNotMatch(
    image4CompanionField,
    /className="companion-presence__online"/m,
    'Image4 presence should not put a status dot or status word beside the companion name',
  )
  assert.doesNotMatch(
    panelCompanionLayout,
    /companion-presence__online/m,
    'Image4 layout should not keep dead online-dot styling after the top identity was simplified',
  )
  assertContains(panelView, 'empty-chat__prompt-grid image4-action-list', 'quick prompts should render as Image4 action rows')
  assertContains(panelView, 'companion-chat__composer image4-composer', 'composer should use the Image4 dock hook')
  assertContains(panelView, "ti('panel.composer.placeholder_short'", 'compact companion composer should use the short placeholder copy')
  assertContains(panelCompanionCollapsed, '.desktop-pet-root--panel-collapsed', 'collapsed panel layout should live in its own CSS module')
  assert.doesNotMatch(
    panelCompanionChat,
    /\.panel-window--companion\.panel-window--simple\.is-collapsed/m,
    'Image4 chat styles should not own the collapsed companion shell',
  )

  assertSourcePattern(
    panelCompanionShell,
    /\.desktop-pet-root--panel:has\(\.panel-window--image4\)\s*\{[\s\S]*?display:\s*grid;[\s\S]*?align-items:\s*start;[\s\S]*?justify-items:\s*center;[\s\S]*?background:\s*#07101b;/m,
    'Image4 expanded panel should sit on the dedicated dark scene layer',
  )
  assertSourcePattern(
    panelCompanionShell,
    /\.panel-window--image4\.panel-window--simple,[\s\S]*?html\[data-theme='warm-day'\] \.panel-window--image4\.panel-window--simple\s*\{[\s\S]*?width:\s*min\(742px,\s*calc\(100vw - 50px\)\);[\s\S]*?aspect-ratio:\s*742 \/ 1738;[\s\S]*?max-height:\s*calc\(100vh - 58px\);[\s\S]*?linear-gradient\(180deg,\s*rgba\(18,\s*26,\s*44,\s*0\.62\),\s*rgba\(8,\s*12,\s*20,\s*0\.7\)\);/m,
    'Image4 outer shell should keep the selected tall glass panel proportions',
  )
  assertSourcePattern(
    panelCompanionLayout,
    /\.panel-window--image4 \.image4-chat,[\s\S]*?html\[data-theme='warm-day'\] \.panel-window--image4 \.image4-chat\s*\{[\s\S]*?--image4-rhythm-presence:[\s\S]*?--image4-rhythm-dial:[\s\S]*?--image4-rhythm-greeting:[\s\S]*?--image4-rhythm-actions:[\s\S]*?--image4-rhythm-composer:[\s\S]*?grid-template-rows:[\s\S]*?\[presence\] var\(--image4-rhythm-presence\)[\s\S]*?\[composer\] var\(--image4-rhythm-composer\);/m,
    'Image4 chat should be driven by the five named rhythm rows',
  )
  assertSourcePattern(
    panelCompanionLayout,
    /--image4-row-boundary-line:[\s\S]*?--image4-weight-actions-surface:[\s\S]*?--image4-composer-base-shadow:/m,
    'Image4 rhythm rows should expose scoped boundary and visual weight tokens',
  )
  assertSourcePattern(
    panelCompanionLayout,
    /\.panel-window--image4 \.image4-presence\s*\{[\s\S]*?grid-row:\s*presence;[\s\S]*?grid-template-areas:[\s\S]*?"topline"[\s\S]*?"signal";/m,
    'Image4 presence should stay pinned to the presence rhythm row',
  )
  assertSourcePattern(
    panelCompanionLayout,
    /\.panel-window--image4 \.image4-dial-stage\s*\{[\s\S]*?grid-row:\s*dial;[\s\S]*?display:\s*flex;[\s\S]*?justify-content:\s*center;/m,
    'Image4 dial stage should stay centered in the dial rhythm row',
  )
  assertSourcePattern(
    panelCompanionDial,
    /\.panel-window--image4 \.companion-presence__dial\s*\{[\s\S]*?place-items:\s*center;[\s\S]*?width:\s*min\(clamp\(180px,\s*46vw,\s*340px\),\s*calc\(var\(--image4-rhythm-dial\) - 4px\)\);/m,
    'Image4 dial body should stay isolated in the dial stylesheet',
  )
  assertSourcePattern(
    panelCompanionLayout,
    /\.panel-window--image4 \.companion-presence__signal::after\s*\{[\s\S]*?content:\s*none;/m,
    'Image4 signal should not restore the mismatched scan-light pseudo layer',
  )
  assertSourcePattern(
    panelCompanionLayout,
    /\.panel-window--image4 \.companion-presence__signal\s*\{[\s\S]*?opacity:\s*0\.24;[\s\S]*?pointer-events:\s*none;/m,
    'Image4 idle voice signal wrapper should stay low-noise and non-interactive',
  )
  assertSourcePattern(
    panelCompanionLayout,
    /html\[data-theme='warm-day'\] \.panel-window--image4 \.companion-presence__signal\s*\{[\s\S]*?opacity:\s*0\.22;/m,
    'warm-day Image4 idle signal should stay quieter after the softened topbar pass',
  )
  assertSourcePattern(
    panelCompanionLayout,
    /\.panel-window--image4 \.companion-presence__signal\.is-idle \.companion-presence__signal-bar\s*\{[\s\S]*?opacity:\s*0\.14;[\s\S]*?transform:\s*scaleY\(0\.32\);/m,
    'Image4 idle voice bars should stay visually quiet until speaking',
  )
  assertSourcePattern(
    panelCompanionMessages,
    /\.panel-window--image4 \.image4-message-list,[\s\S]*?html\[data-theme='warm-day'\] \.panel-window--image4 \.image4-message-list\s*\{[\s\S]*?grid-row:\s*greeting \/ actions;/m,
    'Image4 message list should occupy the greeting/action span from the active-chat message stylesheet',
  )
  assertSourcePattern(
    panelCompanionChat,
    /\.panel-window--image4 \.image4-greeting,[\s\S]*?html\[data-theme='warm-day'\] \.panel-window--image4 \.image4-greeting\s*\{[\s\S]*?grid-row:\s*greeting;/m,
    'Image4 greeting should stay pinned to the greeting rhythm row',
  )
  assertSourcePattern(
    panelCompanionChat,
    /\.panel-window--image4 \.image4-action-list\s*\{[\s\S]*?grid-row:\s*actions;[\s\S]*?grid-auto-rows:\s*minmax\(clamp\(58px,\s*6\.2vh,\s*72px\),\s*max-content\);[\s\S]*?align-content:\s*center;[\s\S]*?border-top:\s*1px solid var\(--image4-row-boundary-line\);/m,
    'Image4 action rows should stay in the actions rhythm row with a quiet separator',
  )
  assertSourcePattern(
    panelCompanionChat,
    /\.panel-window--image4 \.image4-action-list::before\s*\{[\s\S]*?content:\s*none;/m,
    'Image4 suggestion actions should not use timeline-style decoration',
  )
  assertSourcePattern(
    panelCompanionChat,
    /\.panel-window--image4 \.image4-action,[\s\S]*?html\[data-theme='warm-day'\] \.panel-window--image4 \.image4-action\s*\{[\s\S]*?grid-template-columns:\s*clamp\(34px,\s*6\.6vw,\s*48px\) minmax\(0,\s*1fr\) clamp\(16px,\s*2\.5vw,\s*24px\);[\s\S]*?min-height:\s*clamp\(58px,\s*6\.2vh,\s*72px\);/m,
    'Image4 suggestion actions should stay as lightweight prompt rows instead of heavy cards',
  )
  assertSourcePattern(
    panelCompanionChat,
    /\.panel-window--image4 \.empty-chat__prompt-icon,[\s\S]*?html\[data-theme='warm-day'\] \.panel-window--image4 \.empty-chat__prompt-icon\s*\{[\s\S]*?width:\s*clamp\(30px,\s*5\.4vw,\s*44px\);[\s\S]*?height:\s*clamp\(30px,\s*5\.4vw,\s*44px\);/m,
    'Image4 suggestion icons should stay below the old card-scale icon size',
  )
  assertSourcePattern(
    panelCompanionChat,
    /\.panel-window--image4 \.empty-chat__prompt-copy small,[\s\S]*?html\[data-theme='warm-day'\] \.panel-window--image4 \.empty-chat__prompt-copy small\s*\{[\s\S]*?font-size:\s*clamp\(10\.5px,\s*2vw,\s*16px\);[\s\S]*?-webkit-line-clamp:\s*1;/m,
    'Image4 suggestion descriptions should stay as one-line previews',
  )
  assertSourcePattern(
    panelCompanionChat,
    /\.panel-window--image4 \.image4-action::after,[\s\S]*?html\[data-theme='warm-day'\] \.panel-window--image4 \.image4-action::after\s*\{[\s\S]*?color:\s*rgba\(218,\s*227,\s*242,\s*0\.34\);[\s\S]*?font-size:\s*clamp\(20px,\s*3\.4vw,\s*30px\);/m,
    'Image4 suggestion chevrons should stay tertiary and not read as oversized controls',
  )
  assertSourcePattern(
    panelCompanionChat,
    /\.panel-window--image4 \.image4-action:hover,[\s\S]*?html\[data-theme='warm-day'\] \.panel-window--image4 \.image4-action:hover\s*\{[\s\S]*?transform:\s*none;/m,
    'Image4 action hover should not add lift or scale',
  )
  assertSourcePattern(
    panelCompanionChat,
    /\/\* Image 4 concise button pass\. \*\/[\s\S]*?html\[data-theme='warm-day'\] \.panel-window--image4 \.image4-action:hover\s*\{[\s\S]*?background:\s*color-mix\(in srgb,\s*var\(--image4-companion-surface\) 52%,\s*transparent\);[\s\S]*?html\[data-theme='warm-day'\] \.panel-window--image4 \.empty-chat__prompt-icon,[\s\S]*?background:\s*color-mix\(in srgb,\s*var\(--image4-companion-surface-strong\) 56%,\s*transparent\);[\s\S]*?html\[data-theme='warm-day'\] \.panel-window--image4 \.image4-action::after\s*\{[\s\S]*?color:\s*color-mix\(in srgb,\s*var\(--image4-companion-muted\) 50%,\s*transparent\);/m,
    'Image4 warm-day suggestion rows should stay quiet but still read as clickable actions',
  )
  assertSourcePattern(
    panelCompanionChat,
    /\.panel-window--image4 \.image4-composer\s*\{[\s\S]*?grid-row:\s*composer;[\s\S]*?grid-template-areas:\s*"input";/m,
    'Image4 composer should stay pinned to the composer rhythm row',
  )
  assertSourcePattern(
    panelCompanionComposer,
    /\.panel-window--image4 \.image4-composer__field,[\s\S]*?html\[data-theme='warm-day'\] \.panel-window--image4 \.image4-composer__field\s*\{[\s\S]*?height:\s*clamp\(58px,\s*6\.7vh,\s*76px\);[\s\S]*?border:\s*1px solid rgba\(240,\s*246,\s*252,\s*0\.16\);/m,
    'Image4 composer dock should keep its selected input height and boundary',
  )
  assertSourcePattern(
    panelCompanionComposer,
    /\.panel-window--image4 \.image4-composer__field \.composer textarea,[\s\S]*?html\[data-theme='warm-day'\] \.panel-window--image4 \.image4-composer__field textarea\s*\{[\s\S]*?padding:\s*17px 82px 13px 52px;/m,
    'Image4 composer textarea should reserve stable space for the right action rail',
  )
  assertSourcePattern(
    panelCompanionComposer,
    /\.panel-window--image4 \.image4-composer__field textarea::placeholder,[\s\S]*?html\[data-theme='warm-day'\] \.panel-window--image4 \.image4-composer__field textarea::placeholder\s*\{[\s\S]*?color:\s*rgba\(58,\s*74,\s*90,\s*0\.68\);[\s\S]*?opacity:\s*1;/m,
    'Image4 composer placeholder should keep the dark preview text color in warm-day',
  )
  assertSourcePattern(
    panelCompanionComposer,
    /\.panel-window--image4 \.image4-composer__field \.composer__actions,[\s\S]*?html\[data-theme='warm-day'\] \.panel-window--image4 \.image4-composer__field \.composer__actions\s*\{[\s\S]*?right:\s*12px;[\s\S]*?display:\s*inline-grid;[\s\S]*?grid-auto-flow:\s*column;[\s\S]*?grid-auto-columns:\s*29px;[\s\S]*?height:\s*29px;/m,
    'Image4 composer mic and send controls should share a compact action rail',
  )
  assertSourcePattern(
    panelCompanionComposer,
    /\.panel-window--image4 \.image4-composer__field \.composer__actions \.ghost-button,[\s\S]*?html\[data-theme='warm-day'\] \.panel-window--image4 \.image4-composer__field \.composer__actions \.primary-button\s*\{[\s\S]*?width:\s*29px;[\s\S]*?height:\s*29px;/m,
    'Image4 composer action buttons should keep equal compact hit boxes',
  )
  assertSourcePattern(
    panelCompanionComposer,
    /\.panel-window--image4 \.image4-composer__field\[data-send-state='disabled'\] \.composer__actions \.primary-button:disabled,[\s\S]*?html\[data-theme='warm-day'\] \.panel-window--image4 \.image4-composer__field\[data-send-state='disabled'\] \.composer__actions \.primary-button:disabled\s*\{[\s\S]*?background:\s*transparent;[\s\S]*?color:\s*rgba\(76,\s*92,\s*108,\s*0\.36\);[\s\S]*?cursor:\s*default;/m,
    'Image4 disabled send should stay tertiary and not read as the active send action',
  )
  assertSourcePattern(
    panelCompanionRhythm,
    /\.panel-window--image4 \.image4-rhythm-grid\s*\{[\s\S]*?opacity:\s*0\.24;[\s\S]*?pointer-events:\s*none;/m,
    'Image4 rhythm grid should remain a low-noise pointer-transparent calibration layer',
  )
  assertSourcePattern(
    panelCompanionRhythm,
    /\.panel-window--image4 \.image4-chat\.is-image4-snapshot \.image4-rhythm-grid\s*\{[\s\S]*?display:\s*none;/m,
    'Image4 snapshot mode should hide the rhythm grid for clean review',
  )
  assertSourcePattern(
    panelCompanionRhythm,
    /\.panel-window--image4 \.image4-rhythm-grid__rail\s*\{[\s\S]*?right:\s*-23px;[\s\S]*?width:\s*20px;[\s\S]*?opacity:\s*0\.66;/m,
    'Image4 rhythm labels should stay in the right rail rather than inside content',
  )
  assertSourcePattern(
    panelCompanionMotion,
    /@media \(max-height:\s*620px\)\s*\{[\s\S]*?--image4-rhythm-dial:\s*0px;[\s\S]*?\.panel-window--image4 \.image4-dial-stage,[\s\S]*?html\[data-theme='warm-day'\] \.panel-window--image4 \.image4-dial-stage\s*\{[\s\S]*?display:\s*none;/m,
    'short viewports should collapse the dial rhythm row instead of overflowing the panel',
  )
  assert.doesNotMatch(
    panelCompanionMotion,
    /image4-wave-scan/m,
    'Image4 motion should not restore the rejected scan-light animation',
  )
})

test('panel shell scrollbar polish stays consolidated at the final override', () => {
  const app = readWorkspaceFile('src/app/App.css')
  const simpleShellSource = extractSourceRange(
    app,
    '.panel-window--simple {',
    '.panel-window--simple.is-collapsed',
  )
  const messageListSource = extractSourceRange(
    app,
    '.message-list {',
    '.message-list {',
  )

  assertSourcePattern(
    app,
    /\.companion-chat__messages,[\s\S]*?\.panel-window--simple\s*\{[\s\S]*?scrollbar-width:\s*thin;[\s\S]*?scrollbar-color:\s*var\(--nx-scrollbar-thumb\) var\(--nx-scrollbar-track\);/m,
    'shared panel shell scrollbar polish should keep the final visible scrollbar rule',
  )
  assert.doesNotMatch(
    simpleShellSource,
    /scrollbar-width:\s*none;/m,
    'panel simple shell should not keep an earlier hidden scrollbar rule that is overridden later',
  )
  assert.doesNotMatch(
    app,
    /\.panel-window--simple::-webkit-scrollbar\s*\{\s*display:\s*none;\s*\}/m,
    'panel simple shell should not hide webkit scrollbars before the final shared polish',
  )
  assert.doesNotMatch(
    messageListSource,
    /scrollbar-width:\s*none;/m,
    'message list should not keep an earlier hidden scrollbar rule that is overridden later',
  )
  assert.doesNotMatch(
    app,
    /\.message-list::-webkit-scrollbar\s*\{\s*display:\s*none;\s*\}/m,
    'message list should not hide webkit scrollbars before the final shared polish',
  )
})

test('companion chat base shell avoids overridden early duplicates', () => {
  const app = readWorkspaceFile('src/app/App.css')

  assert.equal(
    countSourceMatches(app, /^\.companion-chat\s*\{/gm),
    3,
    'companion chat should keep one visual shell, one padding block, and one layout block',
  )
  assertSourceOrder(
    app,
    '.companion-chat {\n  border-radius: 8px;',
    '.companion-chat {\n  padding: 20px;',
    'companion chat visual shell should precede its final padding block',
  )
  assertSourceOrder(
    app,
    '.companion-chat {\n  padding: 20px;',
    '.companion-chat {\n  display: grid;',
    'companion chat padding should precede its layout block',
  )
  assert.doesNotMatch(
    app,
    /\.companion-chat\s*\{\s*padding:\s*18px;\s*\}/m,
    'companion chat should not keep an early padding value overridden by the final padding block',
  )
})
