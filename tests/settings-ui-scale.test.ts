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
    '--settings-control-font-size: 12px;',
    '--settings-body-font-size: 12px;',
    '--settings-heading-small-font-size: 12px;',
    '--settings-meta-font-size: 11px;',
  ]) {
    assert.ok(settings.includes(token), `missing settings size token: ${token}`)
  }
  assertSourcePattern(
    settings,
    /\.sd\s*\{[\s\S]*?width:\s*min\(300px,\s*calc\(100vw - 18px\)\);[\s\S]*?max-height:\s*min\(470px,\s*calc\(100vh - 18px\)\);[\s\S]*?gap:\s*4px;[\s\S]*?padding:\s*5px;[\s\S]*?font-size:\s*var\(--settings-body-font-size\);/m,
    'compact settings drawer should not keep the older 392px shell scale',
  )
  assertSourcePattern(
    settings,
    /\.settings-drawer__window-title\s*\{[\s\S]*?gap:\s*4px;[\s\S]*?font-size:\s*12px;/m,
    'compact settings title should stay below the older 24px drawer heading',
  )
  assertSourcePattern(
    settings,
    /\.sda \.ghost-button,[\s\S]*?\.sda \.primary-button\s*\{[\s\S]*?min-height:\s*var\(--settings-control-height\);[\s\S]*?padding:\s*0 7px;/m,
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
    /\.sd \.settings-appearance-switch__option\s*\{[\s\S]*?min-height:\s*var\(--settings-control-height-small\);[\s\S]*?font-size:\s*var\(--settings-control-font-size\);/m,
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
  const metadata = readWorkspaceFile('src/components/settingsDrawerMetadata.ts')

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
  assertContains(metadata, "ti('settings.preview.letters.next')", 'letters home preview should use short status copy')
  assert.doesNotMatch(metadata, /letters:\s*\{[\s\S]*?preview:\s*\[[\s\S]*?settings\.letters\.(?:empty_state|note)/m, 'settings home rows should not reuse long letters section copy')
})

test('every settings home destination remains available in child-page navigation', () => {
  const support = readWorkspaceFile('src/components/settingsDrawerSupport.ts')
  const architecture = readWorkspaceFile('src/components/settingsHomeArchitecture.ts')

  for (const sectionId of [
    'console', 'model', 'chat', 'history', 'letters', 'memory',
    'lorebooks', 'voice', 'window', 'integrations', 'tools', 'autonomy',
  ]) {
    assertContains(architecture, `'${sectionId}'`, `settings home should expose ${sectionId}`)
    assertSourcePattern(
      support,
      new RegExp(`\\{ id: '${sectionId}', groupId:`),
      `child-page navigation should keep ${sectionId} reachable`,
    )
  }
})

test('lorebooks uses a distinct document icon instead of the onboarding glyph', () => {
  const metadata = readWorkspaceFile('src/components/settingsDrawerMetadata.ts')
  const icons = readWorkspaceFile('src/components/settingsDrawerIcons.tsx')
  const lorebooksRange = extractSourceRange(metadata, '    lorebooks: {', '    voice: {')

  assertContains(lorebooksRange, "glyph: 'lorebooks'", 'lorebooks should use its semantic icon key')
  assert.doesNotMatch(lorebooksRange, /glyph:\s*'onboarding'/, 'lorebooks must not reuse the onboarding icon')
  assertContains(icons, "case 'lorebooks':", 'the icon registry should render a distinct lorebooks glyph')
})

test('settings visual system defines the 0.4.3 shared child-page contract', () => {
  const visualSystem = readWorkspaceFile('src/app/styles/settings-visual-system.css')
  const productReferenceFinal = readWorkspaceFile('src/app/styles/settings-product-reference-final.css')
  const entry = readWorkspaceFile('src/app/settingsDrawerEntry.ts')
  const styleBundles = [
    'src/app/settingsStylesFoundation.ts',
    'src/app/settingsStylesTheme.ts',
    'src/app/settingsStylesThemeLegacy.ts',
    'src/app/settingsStylesThemeAligned.ts',
    'src/app/settingsStylesSurface.ts',
    'src/app/settingsStylesFinal.ts',
  ].map(readWorkspaceFile).join('\n')

  assertSourceOrder(
    styleBundles,
    "import './styles/settings-visual-system.css'",
    "import './styles/settings-visibility-final.css'",
    'settings visual system should load before the final readability layer',
  )
  assert.doesNotMatch(entry, /import\s+['"]\.\/styles\/settings-[^'"\n]+\.css['"]/, 'settings drawer entry should not aggregate CSS statically')
  const orderedCssImports = [
    './styles/settings.css',
    './styles/settings-home.css',
    './styles/settings-themes.css',
    './styles/settings-themes-legacy.css',
    './styles/settings-chat-aligned.css',
    './styles/settings-chat-final.css',
    './styles/settings-visual-system.css',
    './styles/settings-visibility-final.css',
    './styles/settings-product-shell.css',
    './styles/settings-product-reference-modern-bridge.css',
  ]
  for (let index = 0; index < orderedCssImports.length - 1; index += 1) {
    assertSourceOrder(
      styleBundles,
      orderedCssImports[index],
      orderedCssImports[index + 1],
      `settings CSS import order should remain canonical at ${orderedCssImports[index]}`,
    )
  }

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

  for (const themeClass of ['.sd-night', '.sd-day', '.sd-warm', '.sb-night', '.sb-day', '.sb-warm']) {
    assert.ok(visualSystem.includes(themeClass), `visual system should define theme contract for ${themeClass}`)
  }

  assertSourcePattern(
    visualSystem,
    /\.sd-section \.sp\.sp\s*\{[\s\S]*?--settings-child-control-height:\s*var\(--nx-settings-control-height\);[\s\S]*?--settings-child-control-font-size:\s*var\(--nx-settings-font-body\);/m,
    'settings child pages should derive their scale from the Nexus visual-system tokens',
  )
  assertSourcePattern(
    visualSystem,
    /\.sd-section \.sp\.sp :is\(input:not\(\[type='checkbox'\]\):not\(\[type='radio'\]\):not\(\[type='range'\]\):not\(\[type='file'\]\), select, textarea, \.settings-url-input\)\s*\{[\s\S]*?min-height:\s*var\(--nx-settings-field-height\);[\s\S]*?border-radius:\s*var\(--nx-settings-radius-control\);[\s\S]*?background:\s*var\(--nx-settings-field\);/m,
    'text inputs, selects, textareas, and URL inputs should share one field treatment',
  )
  assertSourcePattern(
    productReferenceFinal,
    /\.sd-section \.sp\.sp \.settings-toggle input:checked\s*\{[\s\S]*?background:\s*var\(--nx-settings-accent\);[\s\S]*?box-shadow:\s*none;/m,
    'the final product layer should own the effective checked-toggle treatment',
  )
  assertSourcePattern(
    productReferenceFinal,
    /\.sd-section \.sp\.sp :is\(\.settings-appearance-switch__control, \.settings-relationship__options, \.settings-sprite-preview__states, \.settings-companion-state-preview__states\)\s*\{[\s\S]*?gap:\s*2px;[\s\S]*?background:\s*var\(--nx-settings-segment-surface\);/m,
    'the final product layer should own the effective segmented track treatment',
  )
  assertSourcePattern(
    productReferenceFinal,
    /\.sd-section \.sp\.sp :is\(\.settings-appearance-switch__option\.is-active, \.settings-relationship__chip\.is-active, \.settings-sprite-preview__states button\.is-active, \.settings-companion-state-preview__states button\.is-active\)\s*\{[\s\S]*?background:\s*var\(--nx-settings-segment-active\);/m,
    'the final product layer should own the effective segmented active surface',
  )
  assertSourcePattern(
    productReferenceFinal,
    /html\[data-theme\] \.sd-section \.settings-segmented-control\s*\{[\s\S]*?display:\s*grid;[\s\S]*?gap:\s*2px;[\s\S]*?background:\s*var\(--nx-settings-segment-surface\);/m,
    'the final product layer should preserve the shared Settings segmented-control track',
  )
  assertSourcePattern(
    productReferenceFinal,
    /html\[data-theme\] \.sd-section \.settings-segmented-control__option\s*\{[\s\S]*?min-height:\s*32px;[\s\S]*?border:\s*1px solid transparent;[\s\S]*?color:\s*var\(--nx-settings-muted\);/m,
    'the final product layer should preserve the shared Settings segmented-control option',
  )
  assertSourcePattern(
    productReferenceFinal,
    /html\[data-theme\] \.sd-section \.settings-segmented-control__option\.is-active\s*\{[\s\S]*?background:\s*var\(--nx-settings-surface-soft\);[\s\S]*?color:\s*var\(--nx-settings-ink\);/m,
    'the final product layer should preserve the shared Settings segmented-control active state',
  )
  assertSourcePattern(
    visualSystem,
    /\.sd-section \.sp\.sp :is\(\.settings-form-row__validation, \.settings-model-advanced__error, \.settings-test-result\.is-error, \.settings-url-input--invalid\)\s*\{[\s\S]*?var\(--nx-settings-danger\)/m,
    'validation and error states should share one danger treatment',
  )
  assertSourcePattern(
    visualSystem,
    /\.sd-section \.sda\s*\{[\s\S]*?min-height:\s*var\(--nx-settings-footer-height\);[\s\S]*?background:\s*var\(--nx-settings-footer-surface\);/m,
    'settings footer actions should share one bottom operation surface',
  )
  assertSourcePattern(
    visualSystem,
    /\.sb \.confirm-dialog-card\s*\{[\s\S]*?border:\s*1px solid var\(--nx-settings-line\);[\s\S]*?background:\s*var\(--nx-settings-surface\);[\s\S]*?color:\s*var\(--nx-settings-ink\);/m,
    'settings confirmation dialogs should inherit the settings visual-system surface',
  )
  assertSourcePattern(
    visualSystem,
    /\.sb \.confirm-dialog-card \.ghost-button,[\s\S]*?\.sb \.confirm-dialog-card__confirm\s*\{[\s\S]*?min-height:\s*38px;/m,
    'settings confirmation actions must meet the practical 38px minimum target size',
  )
  assertSourcePattern(
    visualSystem,
    /\.sb \.confirm-dialog-card__confirm\.is-danger\s*\{[\s\S]*?border-color:\s*var\(--nx-settings-danger\);[\s\S]*?background:\s*var\(--nx-settings-danger\);/m,
    'danger confirmations should use the shared danger token',
  )

  const visibilityFinal = readWorkspaceFile('src/app/styles/settings-visibility-final.css')
  assertSourcePattern(
    visibilityFinal,
    /\.sd-home \.sda,[\s\S]*?\.sd-section \.sda\s*\{[\s\S]*?min-height:\s*var\(--nx-settings-footer-height\);[\s\S]*?background:\s*var\(--nx-settings-footer-surface\);/m,
    'final visibility layer should keep every settings tone footer on the visual-system token after per-theme overrides',
  )
  assertSourcePattern(
    visibilityFinal,
    /\.sd-home \.settings-home-card,[\s\S]*?\.sd-home \.settings-home-card:nth-child\(even\):hover\s*\{[\s\S]*?grid-template-columns:\s*28px minmax\(0,\s*1fr\) 14px;/m,
    'settings home cards should use the product 3-column glyph/copy/chevron grid, not a 4-column ghost track',
  )
  assert.doesNotMatch(
    visibilityFinal,
    /grid-template-columns:\s*4px\s+\d+px\s+minmax\(0,\s*1fr\)\s+\d+px/,
    'settings visibility final must not revive the stale 4-column ghost-card home layout',
  )
  assertSourcePattern(
    visibilityFinal,
    /\.sd-home \.settings-home-card__glyph\s*\{[\s\S]*?grid-column:\s*1;[\s\S]*?\.sd-home \.settings-home-card__copy\s*\{[\s\S]*?grid-column:\s*2;[\s\S]*?\.sd-home \.settings-home-card__chevron\s*\{[\s\S]*?grid-column:\s*3;/m,
    'settings home-card children must map to the 3-column product tracks',
  )
})

test('chat settings use the active V3 route and its real responsive choice contract', () => {
  const routes = readWorkspaceFile('src/components/settingsSectionModules.ts')
  const chat = readWorkspaceFile('src/features/settingsV3/ChatSectionV3.tsx')
  const styles = readWorkspaceFile('src/features/settingsV3/chat-section-v3.css')

  assert.match(routes, /loadChatSection\s*=\s*\(\)\s*=>\s*import\('\.\.\/features\/settingsV3\/ChatSectionV3\.tsx'\)/)
  assert.match(chat, /<SettingsV3Page className="settings-v3-chat">/)
  assert.match(chat, /className="settings-v3-editor settings-v3-chat-identity"/)
  assert.match(chat, /className="settings-v3-choice-grid" role="radiogroup"/)
  assert.match(chat, /import '\.\/chat-section-v3\.css'/)
  assert.match(chat, /data-selected=\{draft\.companionRelationshipType === option\.value \? 'true' : undefined\}/)
  assert.match(styles, /\.settings-v3-choice-grid \{[\s\S]*?grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/)
  assert.match(styles, /\.settings-v3-choice\[data-selected='true'\]/)
  assert.match(styles, /\.settings-v3-choice:focus-visible\s*\{[\s\S]*?outline: 3px solid var\(--nx-v2-focus-ring\)/)
  assert.match(styles, /\.settings-v3-choice-grid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/)
})

test('settings home stacks title and preview inside one text block at <=320px', () => {
  const productFinal = readWorkspaceFile('src/app/styles/settings-product-reference-final.css')
  const productNarrow = extractSourceRange(
    productFinal,
    '@media (max-width: 320px) {',
    '.sd-section .sp.sp {',
  )

  // Final product layer wins cascade and must re-assert the narrow stack.
  // Distinct grid-row assignments are required: base CSS pins both to row 1
  // for the wide side-by-side copy layout; without an explicit value row-2
  // override, both land in the same cell at one copy column.
  assertSourcePattern(
    productNarrow,
    /\.sd-home(?::is\(\.sd-night,\s*\.sd-day,\s*\.sd-light,\s*\.sd-warm\))? \.settings-home-card(?:[^{]*\{[\s\S]*?grid-template-columns:\s*28px minmax\(0,\s*1fr\) 14px;[\s\S]*?min-height:\s*38px;)/m,
    'narrow settings home cards must keep the product 3-column glyph/copy/chevron grid with a practical 38px row target',
  )
  assert.doesNotMatch(
    productNarrow,
    /grid-template-columns:\s*4px\s+\d+px\s+minmax\(0,\s*1fr\)\s+\d+px/,
    'narrow settings home must not revive the retired 4-column ghost track',
  )
  assertSourcePattern(
    productNarrow,
    /\.settings-home-card__copy[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\);[\s\S]*?grid-template-rows:\s*auto auto;[\s\S]*?grid-auto-flow:\s*row;/m,
    'narrow settings home copy must be a single stacked text block, not side-by-side title/preview columns',
  )
  assertSourcePattern(
    productNarrow,
    /\.settings-home-card__label[\s\S]*?grid-column:\s*1;[\s\S]*?grid-row:\s*1;[\s\S]*?font-size:\s*13px;[\s\S]*?white-space:\s*normal;[\s\S]*?overflow-wrap:\s*break-word;[\s\S]*?word-break:\s*normal;/m,
    'narrow title must occupy copy row 1 at 13px with word/phrase wrapping (not mid-token splits)',
  )
  assertSourcePattern(
    productNarrow,
    /\.settings-home-card__value[\s\S]*?grid-column:\s*1;[\s\S]*?grid-row:\s*2;[\s\S]*?font-size:\s*11px;[\s\S]*?white-space:\s*normal;[\s\S]*?overflow-wrap:\s*break-word;[\s\S]*?word-break:\s*normal;[\s\S]*?-webkit-line-clamp:\s*unset;/m,
    'narrow preview must occupy copy row 2 under the title — not share row 1 with the label',
  )
  // Scope to the value rule block so :is(...__value) selectors do not false-positive.
  assert.doesNotMatch(
    productNarrow,
    /\.settings-home-card__value[^{]*\{[^}]*grid-row:\s*1\b/,
    'narrow preview rule must not pin grid-row:1 (that collapses onto the title)',
  )
  assert.doesNotMatch(
    productNarrow,
    /:is\(\.settings-home-card__label,\s*\.settings-home-card__value\)[^{]*\{[^}]*grid-row:\s*/,
    'narrow label/value must not share a combined grid-row assignment',
  )
  assertSourcePattern(
    productNarrow,
    /\.settings-home-card[^{]*\{[\s\S]*?align-items:\s*center;/,
    'narrow home card keeps glyph/copy/chevron vertically centered as a row',
  )
  assert.doesNotMatch(
    productNarrow,
    /\.settings-home-card__label[^{]*\{[^}]*font-size:\s*(?:9|10|11)px;/,
    'narrow title must not shrink below the shared home label scale',
  )
  assert.doesNotMatch(
    productNarrow,
    /\.settings-home-card__value[^{]*\{[^}]*font-size:\s*(?:8|9|10)px;/,
    'narrow preview must not shrink below the shared home meta scale',
  )
  assert.doesNotMatch(
    productNarrow,
    /overflow-wrap:\s*anywhere/,
    'narrow home text should prefer break-word over anywhere so EN tokens and CJK phrases do not fragment arbitrarily',
  )
})

test('final warm settings top bar stays calm and readable', () => {
  const finalSettings = readWorkspaceFile('src/app/styles/settings-chat-final.css')

  assertSourcePattern(
    finalSettings,
    /\.sd-light\.sd-home \.sdh,[\s\S]*?\.sd-light\.sd-section \.sdh\s*\{[\s\S]*?padding:\s*1px 2px 2px;[\s\S]*?border:\s*0;[\s\S]*?border-bottom:\s*1px solid transparent;[\s\S]*?border-radius:\s*0;[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none;/m,
    'final warm settings title bar should stay integrated instead of reading as a separate hard strip',
  )
  assertSourcePattern(
    finalSettings,
    /\.sd-light\.sd-home \.sdhm,[\s\S]*?\.sd-light\.sd-section \.sdhm\s*\{[\s\S]*?min-height:\s*28px;[\s\S]*?padding:\s*0 1px 0 6px;[\s\S]*?border:\s*0;[\s\S]*?border-radius:\s*0;[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none;/m,
    'final warm settings header should stay as a native app bar instead of an inner capsule',
  )
  assertSourcePattern(
    finalSettings,
    /\.sd-light\.sd-home \.sdtb,[\s\S]*?\.sd-light\.sd-section \.sdtb\s*\{[\s\S]*?gap:\s*3px;[\s\S]*?padding:\s*0;[\s\S]*?border:\s*0;[\s\S]*?border-radius:\s*0;[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none;/m,
    'final warm settings title buttons should be simple app-bar glyph buttons instead of a shared capsule',
  )
  assertSourcePattern(
    finalSettings,
    /\.sd-light\.sd-home \.settings-drawer__window-title-name,[\s\S]*?\.sd-light\.sd-section \.settings-drawer__window-title-name\s*\{[\s\S]*?display:\s*inline;[\s\S]*?font-size:\s*12px;[\s\S]*?font-weight:\s*620;/m,
    'final warm settings title should keep Settings as the only visible title word',
  )
  assertSourcePattern(
    finalSettings,
    /\.sd-light\.sd-home \.settings-drawer__window-title-label,[\s\S]*?\.sd-light\.sd-section \.settings-drawer__window-title-label\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?width:\s*1px;[\s\S]*?height:\s*1px;[\s\S]*?clip-path:\s*inset\(50%\);[\s\S]*?white-space:\s*nowrap;/m,
    'final warm settings title should keep companion context out of the visible app bar',
  )
  assertSourcePattern(
    finalSettings,
    /\.sd-light\.sd-home \.settings-drawer__language-button,[\s\S]*?\.sd-light\.sd-section \.settings-drawer__icon-button\s*\{[\s\S]*?width:\s*36px;[\s\S]*?height:\s*36px;[\s\S]*?min-width:\s*36px;[\s\S]*?min-height:\s*36px;[\s\S]*?border-radius:\s*6px;/m,
    'final warm settings top controls should use compact Codex-like glyph hit targets',
  )
  assertSourcePattern(
    finalSettings,
    /\.sd-light\.sd-home,[\s\S]*?\.sd-light\.sd-section\s*\{[\s\S]*?--settings-surface:\s*#fffaf3;[\s\S]*?linear-gradient\(180deg,\s*#fffaf3 0%,\s*#f6ecde 100%\);[\s\S]*?backdrop-filter:\s*none;[\s\S]*?-webkit-backdrop-filter:\s*none;/m,
    'final warm settings drawer should use an opaque warm surface so chat content cannot bleed through',
  )
  assertSourcePattern(
    finalSettings,
    /\.sd-light\.sd-home \.sda,[\s\S]*?\.sd-light\.sd-section \.sda\s*\{[\s\S]*?display:\s*flex;[\s\S]*?justify-content:\s*flex-end;[\s\S]*?gap:\s*8px;[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none;/m,
    'final warm settings footer should use compact right-aligned actions instead of two wide button columns',
  )
  assertSourcePattern(
    finalSettings,
    /\.sd-light\.sd-home \.sda \.ghost-button,[\s\S]*?html\[data-theme='system-day'\] \.sd-light\.sd-section \.sda \.primary-button\s*\{[\s\S]*?backdrop-filter:\s*none;[\s\S]*?-webkit-backdrop-filter:\s*none;/m,
    'final warm settings footer buttons should not keep a hidden blur base',
  )
  assertSourcePattern(
    finalSettings,
    /\.sd-light\.sd-home \.settings-home-group__head\s*\{[\s\S]*?min-height:\s*22px;[\s\S]*?padding:\s*3px 6px 1px;/m,
    'final warm settings group headings should not waste vertical space above the settings rows',
  )
  assertSourcePattern(
    finalSettings,
    /\.sd-light\.sd-home \.settings-home-card,[\s\S]*?\.sd-light\.sd-home \.settings-home-card:nth-child\(even\):hover\s*\{[\s\S]*?grid-template-columns:\s*18px minmax\(0,\s*1fr\) minmax\(68px,\s*min\(48%,\s*176px\)\);[\s\S]*?min-height:\s*34px;/m,
    'final warm settings home rows should reserve a left glyph lane like the companion chat action rows',
  )
  assertSourcePattern(
    finalSettings,
    /\.sd-light\.sd-home \.settings-home-card__glyph\s*\{[\s\S]*?grid-column:\s*1;[\s\S]*?justify-self:\s*center;[\s\S]*?opacity:\s*0\.62;/m,
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
    '  .sd .settings-home-card__value {',
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
      /\.sda \.ghost-button,[\s\S]*?\.sda \.primary-button\s*\{[\s\S]*?min-height:\s*var\(--settings-control-height-small\);[\s\S]*?padding-right:\s*6px;[\s\S]*?padding-left:\s*6px;/m,
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
      /\.sd \.settings-home-card,[\s\S]*?\.sd \.settings-home-card:nth-child\(even\):hover\s*\{[\s\S]*?min-height:\s*var\(--settings-control-height\);/m,
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
    /@media \(max-width:\s*300px\) and \(max-height:\s*480px\)\s*\{[\s\S]*?\.sp\.sp \.sphd\s*\{[\s\S]*?grid-template-columns:\s*28px minmax\(0,\s*1fr\);[\s\S]*?gap:\s*4px;/m,
    'tiny child settings pages should keep a compact title-bar grid',
  )
  assertSourcePattern(
    themes,
    /@media \(max-width:\s*300px\) and \(max-height:\s*480px\)\s*\{[\s\S]*?\.sp\.sp \.settings-page__back\s*\{[\s\S]*?width:\s*28px;[\s\S]*?min-width:\s*28px;/m,
    'tiny child settings page back button should not grow to the old 34px icon slot',
  )
  assertSourcePattern(
    themes,
    /@media \(max-width:\s*300px\) and \(max-height:\s*480px\)\s*\{[\s\S]*?\.sp\.sp \.sph h4\s*\{[\s\S]*?font-size:\s*11px;/m,
    'tiny child settings page headline should stay on the compact heading scale',
  )
})

test('settings child pages inherit the shared control scale', () => {
  const settings = readWorkspaceFile('src/app/styles/settings.css')
  const themes = readWorkspaceFile('src/app/styles/settings-themes.css')
  const legacyThemes = readWorkspaceFile('src/app/styles/settings-themes-legacy.css')

  assertSourcePattern(
    settings,
    /\.sd-section\s*\{[\s\S]*?width:\s*min\(480px,\s*calc\(100vw - 18px\)\);[\s\S]*?height:\s*min\(480px,\s*calc\(100vh - 18px\)\);/m,
    'settings child pages should not jump back to the older oversized 680px drawer',
  )
  assertSourcePattern(
    themes,
    /\.sp\.sp\s*\{[\s\S]*?--settings-child-control-height:\s*var\(--settings-control-height\);[\s\S]*?--settings-child-control-font-size:\s*var\(--settings-control-font-size\);[\s\S]*?--settings-child-meta-font-size:\s*var\(--settings-meta-font-size\);[\s\S]*?--settings-child-gap:\s*4px;/m,
    'settings child pages should derive their control scale from the shared settings tokens',
  )
  assertSourcePattern(
    themes,
    /\.sp\.sp \.settings-page__back,[\s\S]*?\.sp\.sp \.settings-about-panel__link(?:\s*,|\s*\{)[\s\S]*?min-height:\s*var\(--settings-child-control-height\);[\s\S]*?font-size:\s*var\(--settings-child-control-font-size\);/m,
    'settings child-page buttons and links should share one height and font scale',
  )
  assertSourcePattern(
    themes,
    /\.sp\.sp \.sph h4\s*\{[\s\S]*?font-size:\s*11px;/m,
    'settings child-page headings should stay below the older 18px section title scale',
  )
  assertSourcePattern(
    themes,
    /\.sd \.sp\.sp \.settings-toggle:not\(\.settings-lorebook-check\)(?:\s*,|\s*\{)[\s\S]*?gap:\s*8px;/m,
    'settings child-page toggle rows should use the tighter shared row gap',
  )
  assertSourcePattern(
    themes,
    /\.sd \.sp\[data-section='window'\] \.settings-window-section > \.settings-control-grid > \.settings-control-card:not\(\.settings-window-field\):not\(\.settings-window-control\)\s*\{[\s\S]*?gap:\s*0;[\s\S]*?padding:\s*3px 5px;/m,
    'desktop/window child-page control cards should not keep the older tall card padding',
  )
  assertSourcePattern(
    themes,
    /\.sd \.sp\[data-section='window'\] \.settings-window-section > \.settings-control-grid > \.settings-control-card:not\(\.settings-window-field\):not\(\.settings-window-control\) > p(?:\s*,|\s*\{)[\s\S]*?position:\s*absolute;[\s\S]*?width:\s*1px;[\s\S]*?height:\s*1px;[\s\S]*?clip-path:\s*inset\(50%\);[\s\S]*?white-space:\s*nowrap;/m,
    'desktop/window child-page helper copy should remain in the DOM without making compact rows tall',
  )
  assertSourcePattern(
    themes,
    /\.sd \.sp\[data-section='window'\] \.settings-window-section > \.settings-control-grid > \.settings-control-card:not\(\.settings-window-field\):not\(\.settings-window-control\) > \.settings-toggle\s*\{[\s\S]*?gap:\s*7px;/m,
    'desktop/window child-page toggle rows should keep the tighter final gap after legacy overrides',
  )
  assertSourcePattern(
    themes,
    /\.sd \.sp\[data-section='window'\] label\.settings-window-field\s*\{[\s\S]*?grid-template-columns:\s*minmax\(66px,\s*0\.36fr\) minmax\(0,\s*1fr\);[\s\S]*?min-height:\s*32px;[\s\S]*?padding:\s*3px 4px;/m,
    'desktop/window child-page select rows should keep the tighter field rhythm',
  )
  assertSourcePattern(
    themes,
    /\.sd \.sp\[data-section='voice'\] \.settings-voice-loop-card \.settings-voice-control:has\(> p\)\s*\{[\s\S]*?position:\s*relative;[\s\S]*?min-height:\s*31px;[\s\S]*?align-content:\s*center;/m,
    'voice child-page toggle cards with helper copy should not keep the older 66px card height',
  )
  assertSourcePattern(
    themes,
    /\.sd \.sp\[data-section='voice'\] \.settings-voice-loop-card \.settings-voice-control > p\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?width:\s*1px;[\s\S]*?height:\s*1px;[\s\S]*?clip-path:\s*inset\(50%\);[\s\S]*?white-space:\s*nowrap;/m,
    'voice helper copy should stay in the DOM without inflating compact toggle cards',
  )
  assertSourcePattern(
    themes,
    /\.sd \.sp\[data-section='tools'\] \.settings-tools-section > \.settings-control-grid > \.settings-control-card:has\(> \.settings-toggle \+ p\)\s*\{[\s\S]*?position:\s*relative;[\s\S]*?min-height:\s*31px;[\s\S]*?padding:\s*3px 4px;[\s\S]*?align-content:\s*center;/m,
    'tools child-page toggle cards with helper copy should not keep the older 66px card height',
  )
  assertSourcePattern(
    themes,
    /\.sd \.sp\[data-section='tools'\] \.settings-tools-section > \.settings-control-grid > \.settings-control-card:has\(> \.settings-toggle \+ p\) > p(?:\s*,|\s*\{)[\s\S]*?position:\s*absolute;[\s\S]*?width:\s*1px;[\s\S]*?height:\s*1px;[\s\S]*?clip-path:\s*inset\(50%\);[\s\S]*?white-space:\s*nowrap;/m,
    'tools helper copy should stay in the DOM without inflating compact toggle cards',
  )
  assertSourcePattern(
    themes,
    /\.sd \.sp\[data-section='tools'\] label\.settings-tools-field\s*\{[\s\S]*?grid-template-columns:\s*minmax\(86px,\s*0\.42fr\) minmax\(0,\s*1fr\);[\s\S]*?min-height:\s*34px;[\s\S]*?padding:\s*3px 5px;/m,
    'tools backend fields should stay below the older 58px form-row height',
  )
  assertSourcePattern(
    themes,
    /\.sd \.sp\.sp \.settings-tools-section > \.settings-mini-group:has\(> \.settings-tools-control\) > \.settings-tools-field\s*\{[\s\S]*?min-height:\s*34px;[\s\S]*?padding:\s*3px 5px;/m,
    'tools grouped backend fields should not be re-inflated by the provider-specific layout rule',
  )
  assertSourcePattern(
    themes,
    /\.sp\.sp \.settings-chat-system-prompt\s*\{[\s\S]*?min-height:\s*88px;/m,
    'chat system prompt should no longer dominate the child page as a 140px text area',
  )
  assertSourcePattern(
    themes,
    /\.sd \.sp\[data-section='chat'\] \.settings-chat-relationship-card(?:\s*,|\s*\{)[\s\S]*?gap:\s*4px;[\s\S]*?padding:\s*4px 5px;/m,
    'chat relationship options should read as a compact chooser instead of a large card group',
  )
  assertSourcePattern(
    themes,
    /\.sd \.sp\[data-section='chat'\] \.settings-chat-advanced-control:has\(> \.settings-toggle \+ p\) > p(?:\s*,|\s*\{)[\s\S]*?position:\s*absolute;[\s\S]*?width:\s*1px;[\s\S]*?height:\s*1px;[\s\S]*?clip-path:\s*inset\(50%\);[\s\S]*?white-space:\s*nowrap;/m,
    'chat helper copy should stay in the DOM without inflating compact advanced controls',
  )
  assertSourcePattern(
    themes,
    /\.sd \.sp\[data-section='chat'\] \.settings-choice-field--pet-model \.settings-choice-card\s*\{[\s\S]*?min-height:\s*36px;[\s\S]*?padding:\s*4px 5px;/m,
    'pet model cards should not keep the older tall choice-card rhythm',
  )
  assertSourcePattern(
    legacyThemes,
    /\.sd \.sp\[data-section='memory'\] \.settings-memory-transparency__card\s*\{[\s\S]*?min-height:\s*34px;[\s\S]*?padding:\s*4px 5px;[\s\S]*?align-content:\s*center;/m,
    'memory transparency summary cards should be short status tiles',
  )
  assertSourcePattern(
    legacyThemes,
    /\.sd \.sp\.sp \.settings-memory-context-status\s*\{[\s\S]*?gap:\s*3px;[\s\S]*?min-height:\s*32px;[\s\S]*?padding:\s*3px 5px;/m,
    'memory context status rows should not keep the older 53px card height',
  )
  assertSourcePattern(
    themes,
    /\.sp\[data-section='model'\] \.settings-model-source-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(100%,\s*132px\),\s*176px\)\);[\s\S]*?justify-content:\s*start;/m,
    'model source cards should not stretch into oversized full-width tiles',
  )
  assertSourcePattern(
    themes,
    /\.sd \.sp\.sp \.settings-model-source-card\s*\{[\s\S]*?grid-template-columns:\s*12px minmax\(0,\s*1fr\) 6px;[\s\S]*?min-height:\s*31px;[\s\S]*?padding:\s*3px 4px;/m,
    'model source cards should follow the smaller child-page row scale',
  )
  assertSourcePattern(
    themes,
    /\.sd \.sp\.sp \.settings-model-source-card:last-child:nth-child\(odd\)\s*\{[\s\S]*?grid-column:\s*auto;/m,
    'odd model source cards should not stretch across the full source grid',
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

test('active V3 child pages do not depend on retired legacy page overrides', () => {
  const finalSettings = readWorkspaceFile('src/app/styles/settings-chat-final.css')
  const routes = readWorkspaceFile('src/components/settingsSectionModules.ts')

  for (const selectorFragment of [
    'settings-model-detail-card',
    'settings-tools-section >',
    'settings-console-sections > section',
    'settings-history-summary-grid',
    'settings-lorebook-item',
    'settings-memory-context-status',
    'settings-voice-loop-card > label.settings-control-card',
  ]) {
    assert.ok(
      !finalSettings.includes(selectorFragment),
      `retired selector block should not stay in the global final settings layer: ${selectorFragment}`,
    )
  }
  assert.match(routes, /loadModelSection\s*=\s*\(\)\s*=>\s*import\('\.\.\/features\/settingsV3\/ModelSectionV3\.tsx'\)/)
  assert.match(routes, /loadVoiceSection\s*=\s*\(\)\s*=>\s*import\('\.\.\/features\/settingsV3\/VoiceSectionV3\.tsx'\)/)
  assert.match(routes, /loadMemorySection\s*=\s*\(\)\s*=>\s*import\('\.\.\/features\/settingsV3\/MemorySectionV3\.tsx'\)/)
})

test('warm-day settings drawer uses trace-list surfaces', () => {
  const themes = readWorkspaceFile('src/app/styles/settings-themes.css')
  const legacyThemes = readWorkspaceFile('src/app/styles/settings-themes-legacy.css')
  const finalSettings = readWorkspaceFile('src/app/styles/settings-chat-final.css')

  assertSourcePattern(
    themes,
    /\.sd-warm\s*\{[\s\S]*?--settings-trace-cool:\s*rgba\(80,\s*125,\s*198,\s*0\.56\);[\s\S]*?--settings-trace-warm:\s*rgba\(206,\s*122,\s*76,\s*0\.54\);/m,
    'warm-day settings drawer should define shared trace colors',
  )
  assertSourcePattern(
    finalSettings,
    /\.sd-light\.sd-home \.sdtb,[\s\S]*?\.sd-light\.sd-section \.sdtb\s*\{[\s\S]*?gap:\s*3px;[\s\S]*?padding:\s*0;[\s\S]*?border:\s*0;/m,
    'warm-day settings toolbar should be a compact glyph cluster from the final settings shell',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer__language-button,[\s\S]*?\.settings-drawer__icon-button\s*\{[\s\S]*?width:\s*36px;[\s\S]*?height:\s*36px;[\s\S]*?min-width:\s*36px;/m,
    'warm-day settings toolbar buttons should stay compact icon glyph controls',
  )
  assertSourcePattern(
    finalSettings,
    /\.settings-drawer__icon-button--danger:hover\s*\{[\s\S]*?border-color:\s*rgba\(160,\s*62,\s*46,\s*0\.12\);[\s\S]*?background:\s*rgba\(160,\s*62,\s*46,\s*0\.08\);/m,
    'warm-day settings close button should keep a subtle danger hover tone',
  )
  assert.ok(!themes.includes('settings-home-release'), 'warm-day theme should not keep settings-home release-card styles')
  assertSourcePattern(
    legacyThemes,
    /\.sd-warm \.sda\s*\{[\s\S]*?background:\s*rgba\(255,\s*253,\s*249,\s*0\.68\);[\s\S]*?box-shadow:\s*none;/m,
    'warm-day settings footer should not cast a raised panel shadow over trace rows',
  )
  assertSourcePattern(
    legacyThemes,
    /\.sd-warm \.sda \.primary-button,[\s\S]*?html\[data-theme='warm-day'\] \.sd-warm \.sda \.primary-button,[\s\S]*?html\[data-theme='system-day'\] \.sd-warm \.sda \.primary-button\s*\{[\s\S]*?background:\s*rgba\(186,\s*92,\s*60,\s*0\.92\);[\s\S]*?box-shadow:\s*none;/m,
    'warm-day settings save action should keep primary color without orange lift',
  )
  assertSourcePattern(
    legacyThemes,
    /\.sd-warm \.settings-section-nav__button,[\s\S]*?\.sd-warm \.settings-home-card:nth-child\(even\):hover\s*\{[\s\S]*?border-left:\s*2px solid transparent;[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none;/m,
    'warm-day settings nav and home rows should start as flat trace rows',
  )
  assertSourcePattern(
    legacyThemes,
    /\.sd-warm \.settings-section-nav__button\.is-active\s*\{[\s\S]*?border-left-color:\s*var\(--settings-trace-cool\);[\s\S]*?background:\s*rgba\(255,\s*253,\s*249,\s*0\.58\);[\s\S]*?box-shadow:\s*none;/m,
    'active warm-day settings nav item should use a cool trace edge rather than a raised card',
  )
  assertSourcePattern(
    legacyThemes,
    /\.sd-warm \.settings-home-card,[\s\S]*?\.sd-warm \.settings-home-card\[data-trust-group\]\s*\{[\s\S]*?border-left-color:\s*color-mix\(in srgb,\s*var\(--settings-trust-trace,\s*var\(--settings-trace-cool\)\)\s*64%,\s*transparent\);/m,
    'warm-day settings home rows should use section trust traces without becoming raised cards',
  )
  assertSourcePattern(
    legacyThemes,
    /\.sd-warm \.settings-home-card\[data-trust-group='memoryContext'\]\s*\{[\s\S]*?--settings-trust-trace:\s*var\(--settings-trace-memory\);/m,
    'warm-day memory settings rows should expose a distinct trust trace',
  )
  assertSourcePattern(
    legacyThemes,
    /\.sd-warm \.settings-home-card\[data-trust-group='permissionsIntegrations'\]\s*\{[\s\S]*?--settings-trust-trace:\s*var\(--settings-trace-permission\);/m,
    'warm-day permissions and integration settings rows should expose a distinct trust trace',
  )
  assertSourcePattern(
    legacyThemes,
    /\.sd-warm \.sdc,[\s\S]*?\.sd-warm \.settings-section\s*\{[\s\S]*?background:\s*rgba\(255,\s*253,\s*249,\s*0\.38\);[\s\S]*?box-shadow:\s*none;/m,
    'warm-day settings content and sections should stay flat enough for trace-list styling',
  )
  assertSourcePattern(
    legacyThemes,
    /\.sd-warm \.settings-section:hover\s*\{[\s\S]*?border-left-color:\s*var\(--settings-trace-warm\);[\s\S]*?background:\s*rgba\(255,\s*253,\s*249,\s*0\.52\);[\s\S]*?box-shadow:\s*none;/m,
    'warm-day settings section hover should clarify edge state without lift',
  )
})

test('panel window controls stay compact, icon-only, and visually distinct', () => {
  const app = readWorkspaceFile('src/app/App.css')
  const toolbarControls = readWorkspaceFile('src/app/styles/panel-toolbar-controls.css')
  const panelCompanion = readWorkspaceFile('src/app/styles/panel-companion-shell.css')
  const panelFinal = readWorkspaceFile('src/app/styles/panel-companion-final.css')
  const panelView = readWorkspaceFile('src/app/views/LegacyPanelView.tsx')
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
    /html\[data-theme\] \.desktop-pet-root--panel \.panel-window--image4 \.companion-chat__toolbar\.image4-header-controls\s*\{[\s\S]*?top:\s*14px !important;[\s\S]*?right:\s*10px !important;/m,
    'final Image4 top controls should sit on the companion identity line',
  )
  assertSourcePattern(
    panelFinal,
    /\.panel-window--image4 \.panel-window__header-actions--image4\s*\{[\s\S]*?gap:\s*4px !important;[\s\S]*?opacity:\s*1;/m,
    'final Image4 top controls should not render as a separate floating tray',
  )
  assertSourcePattern(
    panelFinal,
    /html\[data-theme\] \.desktop-pet-root--panel \.panel-window--image4 \.panel-window__header-actions--image4 \.panel-window__icon-button\s*\{[\s\S]*?width:\s*32px !important;[\s\S]*?background:\s*transparent !important;[\s\S]*?box-shadow:\s*none !important;/m,
    'final Image4 top control buttons should stay compact and tray-free',
  )
  assertSourcePattern(
    panelFinal,
    /\.panel-window--image4 \.panel-window__header-actions--image4 \.panel-window__icon-button,[\s\S]*?html\[data-theme='warm-day'\] \.panel-window--image4 \.panel-window__header-actions--image4 \.panel-window__icon-button--danger\s*\{[\s\S]*?width:\s*32px !important;[\s\S]*?height:\s*32px !important;[\s\S]*?min-width:\s*32px !important;[\s\S]*?min-height:\s*32px !important;/m,
    'final cascade should lock every primary Image4 toolbar icon button to intentional 32px geometry',
  )
  assertSourcePattern(
    readWorkspaceFile('src/app/styles/panel-companion-polish.css'),
    /\.panel-window--image4 \.panel-window__header-actions--image4 \.panel-window__icon-button,[\s\S]*?html\[data-theme='warm-day'\] \.panel-window--image4 \.panel-window__header-actions--image4 \.panel-window__icon-button--danger\s*\{[\s\S]*?width:\s*32px !important;[\s\S]*?height:\s*32px !important;[\s\S]*?min-width:\s*32px !important;[\s\S]*?min-height:\s*32px !important;/m,
    'polish layer must share the intentional 32px toolbar geometry instead of a competing clamp cascade',
  )
  assertSourcePattern(
    readWorkspaceFile('src/app/styles/panel-companion-motion.css'),
    /@media \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.panel-window--image4 \.companion-presence__signal\.is-speaking \.companion-presence__signal-bar,[\s\S]*?animation:\s*none !important;[\s\S]*?animation-play-state:\s*paused !important;/m,
    'reduced-motion must stop infinite speaking/listening decorative signal animation',
  )
  assertSourcePattern(
    panelFinal,
    /html\[data-theme\] \.desktop-pet-root--panel \.panel-window--image4 \.panel-window__header-actions--image4 \.panel-window__icon-button--settings\s*\{[\s\S]*?width:\s*32px !important;[\s\S]*?background:\s*rgba\(255,\s*255,\s*255,\s*0\.46\) !important;/m,
    'final settings control should remain the clearest utility without becoming loud',
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

test('Image4 companion surface keeps the selected voice-first Live2D structure', () => {
  const panelCompanionHub = readWorkspaceFile('src/app/styles/panel-companion.css')
  const panelCompanionFinal = readWorkspaceFile('src/app/styles/panel-companion-final.css')
  const panelView = readWorkspaceFile('src/app/views/LegacyPanelView.tsx')
  const image4CompanionField = readWorkspaceFile('src/app/views/Image4CompanionField.tsx')

  assertContains(panelCompanionHub, "@import './panel-companion-final.css';", 'voice-first final layout should stay in the companion import spine')
  assertContains(panelView, 'Image4PresenceHeader', 'Image4 presence should stay componentized')
  assertContains(panelView, 'Live2DCanvas', 'Live2D should remain the primary companion presence')
  assertContains(panelView, 'image4-conversation-recap', 'conversation recap should remain compact and visible')
  assertContains(panelView, 'companion-chat__composer image4-composer', 'composer should remain separate from the Live2D stage')
  assertContains(image4CompanionField, 'Image4Signal', 'voice signal should stay componentized')
  assert.doesNotMatch(panelView, /image4-greeting|image4-action-list|className="empty-chat__prompt image4-action"/m, 'retired greeting and quick-action DOM should not return')
  assert.doesNotMatch(image4CompanionField, /Image4Dial|image4-dial-stage|companion-presence__dial/m, 'retired dial markup should not return')
  assertSourcePattern(
    panelCompanionFinal,
    /\.panel-window--image4 \.image4-chat\s*\{[\s\S]*?grid-template-rows:\s*48px minmax\(0, 1fr\) auto 62px;/m,
    'voice-first panel should keep one bounded header-stage-recap-composer grid',
  )
  assertSourcePattern(
    panelCompanionFinal,
    /\.panel-window--image4 \.image4-live2d-stage\s*\{[\s\S]*?min-height:\s*0;[\s\S]*?overflow:\s*hidden;/m,
    'Live2D stage should remain bounded inside the panel',
  )
  assertSourcePattern(
    panelCompanionFinal,
    /\.panel-window--image4 \.image4-message-list--archive\s*\{[\s\S]*?display:\s*none !important;/m,
    'the full message archive should stay hidden behind the compact recap',
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
