import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

function readWorkspaceFile(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

test('lazy settings sections load only after the user enters a section', () => {
  const modules = readWorkspaceFile('src/components/settingsSectionModules.ts')
  const drawer = readWorkspaceFile('src/components/SettingsDrawer.tsx')
  const home = readWorkspaceFile('src/components/SettingsHomeView.tsx')

  assert.match(modules, /export const loadVoiceSection\s*=\s*\(\)\s*=>\s*import/)
  assert.doesNotMatch(modules, /preloadSettingsSection|SETTINGS_SECTION_PRELOADERS/)
  assert.doesNotMatch(drawer, /preloadSettingsSection/)
  assert.doesNotMatch(home, /onPreloadSettingsSection/)
  assert.match(drawer, /onClick=\{\(\) => handleOpenSettingsSection\(section\.id\)\}/)
  assert.match(home, /onClick=\{\(\) => onOpenSettingsSection\(card\.sectionId\)\}/)
})

test('lazy settings sections render a themed non-empty loading state', () => {
  const activeSection = readWorkspaceFile('src/components/SettingsDrawerActiveSection.tsx')
  const visualSystem = readWorkspaceFile('src/app/styles/settings-visual-system.css')

  assert.match(activeSection, /fallback=\{<SettingsSectionLoading label=\{loadingLabel\} \/>\}/)
  assert.match(activeSection, /className="settings-section-loading" role="status"/)
  assert.match(visualSystem, /\.sd-section \.settings-section-loading\s*\{/)
  assert.match(visualSystem, /background:\s*var\(--nx-settings-surface-soft\);/)
})

test('settings CSS coverage waits for lazy section content before sampling rules', () => {
  const coverage = readWorkspaceFile('scripts/settings-css-coverage.mjs')

  assert.match(coverage, /\.settings-v3-page:not\(\.is-hidden\)/)
  assert.match(coverage, /activePage\.children\.length > 0/)
  assert.match(coverage, /!content\.querySelector\('\.settings-section-loading'\)/)
  assert.match(coverage, /section\.id === 'console'/)
  assert.match(coverage, /node\.open = true/)
  assert.match(coverage, /\.settings-plan-panel__empty', \{ state: 'visible' \}/)
})

test('V3 section-owned CSS follows the lazy section module boundary', () => {
  const shared = readWorkspaceFile('src/features/settingsV3/settings-v3.css')
  const chat = readWorkspaceFile('src/features/settingsV3/ChatSectionV3.tsx')
  const voice = readWorkspaceFile('src/features/settingsV3/VoiceSectionV3.tsx')
  const integrations = readWorkspaceFile('src/features/settingsV3/IntegrationsSectionV3.tsx')
  const consoleSection = readWorkspaceFile('src/features/settingsV3/ConsoleSectionV3.tsx')
  const memory = readWorkspaceFile('src/features/settingsV3/MemorySectionV3.tsx')

  assert.doesNotMatch(shared, /\.settings-v3-(?:choice|studio|provider|tuning|integration-status-list)/)
  assert.match(chat, /import '\.\/settings-v3-collection\.css'/)
  assert.match(chat, /import '\.\/chat-section-v3\.css'/)
  assert.match(voice, /import '\.\/voice-section-v3\.css'/)
  assert.match(integrations, /import '\.\/integrations-section-v3\.css'/)
  assert.match(consoleSection, /import '\.\/settings-v3-collection\.css'/)
  assert.match(consoleSection, /import '\.\/console-section-v3\.css'/)
  assert.match(memory, /import '\.\/settings-v3-collection\.css'/)
})

test('the production CSS pipeline normalizes media ranges before final compression', () => {
  const minifier = readWorkspaceFile('scripts/minify-built-css.mjs')

  assert.match(minifier, /width\|height\|aspect-ratio\|resolution/)
  assert.match(minifier, /operator === '>=' \? 'min' : 'max'/)
})
