import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

function readWorkspaceFile(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

test('lazy settings sections preload from both home cards and section navigation', () => {
  const modules = readWorkspaceFile('src/components/settingsSectionModules.ts')
  const drawer = readWorkspaceFile('src/components/SettingsDrawer.tsx')
  const home = readWorkspaceFile('src/components/SettingsHomeView.tsx')

  assert.match(modules, /export function preloadSettingsSection/)
  assert.match(modules, /voice:\s*\(\) => Promise\.all/)
  assert.match(drawer, /onPointerEnter=\{\(\) => preloadSettingsSection\(section\.id\)\}/)
  assert.match(drawer, /onFocus=\{\(\) => preloadSettingsSection\(section\.id\)\}/)
  assert.match(home, /onPointerEnter=\{\(\) => onPreloadSettingsSection\(card\.sectionId\)\}/)
  assert.match(home, /onFocus=\{\(\) => onPreloadSettingsSection\(card\.sectionId\)\}/)
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

  assert.match(coverage, /content\.children\.length > 0/)
  assert.match(coverage, /!content\.querySelector\('\.settings-section-loading'\)/)
})
