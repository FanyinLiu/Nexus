import assert from 'node:assert/strict'
import { test } from 'node:test'

import { findSettingsStyleImportOrderIssues } from '../scripts/settings-surface-audit.mjs'

const orderedEntry = `
import { loadSettingsStyleBundles } from './settingsStyleBundles'
await loadSettingsStyleBundles()
`

const orderedBundles = `
export const SETTINGS_STYLE_BUNDLES = [
  { load: () => import('./settingsStylesFoundation') },
  { load: () => import('./settingsStylesTheme') },
  { load: () => import('./settingsStylesSurface') },
  { load: () => import('./settingsStylesFinal') },
]
export async function loadSettingsStyleBundles() {
  for (const bundle of SETTINGS_STYLE_BUNDLES) await bundle.load()
}
`

const orderedSources = new Map([
  ['src/app/settingsStylesFoundation.ts', "import './styles/settings.css'\nimport './styles/settings-home.css'"],
  ['src/app/settingsStylesTheme.ts', `import './styles/settings-themes.css'
if (new URLSearchParams(window.location.search).get('uiV2') === '0') {
  await import('./settingsStylesThemeLegacy')
}
await import('./settingsStylesThemeAligned')`],
  ['src/app/settingsStylesThemeLegacy.ts', "import './styles/settings-themes-legacy.css'"],
  ['src/app/settingsStylesThemeAligned.ts', "import './styles/settings-chat-aligned.css'"],
  ['src/app/settingsStylesSurface.ts', "import './styles/settings-chat-final.css'\nimport './styles/settings-visual-system.css'"],
  ['src/app/settingsStylesFinal.ts', "import './styles/settings-visibility-final.css'\nimport './styles/settings-product-shell.css'\nimport './styles/settings-product-reference-modern-bridge.css'"],
])

test('settings style import order accepts the product reference layer last', () => {
  assert.deepEqual(findSettingsStyleImportOrderIssues(orderedEntry, orderedBundles, orderedSources), [])
})

test('settings style import order rejects static aggregation and parallel loading', () => {
  const report = findSettingsStyleImportOrderIssues(`
import './styles/settings.css'
`, `
export const SETTINGS_STYLE_BUNDLES = [
  { load: () => import('./settingsStylesFinal') },
  { load: () => import('./settingsStylesFoundation') },
]
await Promise.all(SETTINGS_STYLE_BUNDLES.map((bundle) => bundle.load()))
`)

  assert.equal(report.some((item) => item.id === 'settings-style-static-entry'), true)
  assert.equal(report.some((item) => item.id === 'settings-style-bundle-order'), true)
  assert.equal(report.some((item) => item.id === 'settings-style-sequential-loader'), true)
})
