import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { tmpdir } from 'node:os'

import { buildSettingsCssReport } from '../scripts/settings-css-audit.mjs'

const LEGACY_SETTINGS_FILES = [
  'settings.css',
  'settings-home.css',
  'settings-themes.css',
  'settings-themes-legacy.css',
  'settings-chat-aligned.css',
  'settings-chat-final.css',
  'settings-visual-system.css',
  'settings-visibility-final.css',
  'settings-product-shell.css',
  'settings-product-reference-final.css',
]
const MODERN_SETTINGS_FILES = [
  { id: 'settings-v2.css', path: 'src/features/uiV2/settings-v2.css' },
  { id: 'settings-v3.css', path: 'src/features/settingsV3/settings-v3.css' },
  { id: 'settings-v3-collection.css', path: 'src/features/settingsV3/settings-v3-collection.css' },
  { id: 'settings-product-reference-modern-bridge.css', path: 'src/app/styles/settings-product-reference-modern-bridge.css' },
  { id: 'chat-section-v3.css', path: 'src/features/settingsV3/chat-section-v3.css' },
  { id: 'voice-section-v3.css', path: 'src/features/settingsV3/voice-section-v3.css' },
  { id: 'integrations-section-v3.css', path: 'src/features/settingsV3/integrations-section-v3.css' },
  { id: 'console-section-v3.css', path: 'src/features/settingsV3/console-section-v3.css' },
]
const SETTINGS_STYLE_BUNDLES = [
  {
    module: 'settingsStylesFoundation.ts',
    importPath: './settingsStylesFoundation',
    files: ['settings.css', 'settings-home.css'],
  },
  {
    module: 'settingsStylesTheme.ts',
    importPath: './settingsStylesTheme',
    files: ['settings-themes.css', 'settings-themes-legacy.css', 'settings-chat-aligned.css'],
  },
  {
    module: 'settingsStylesSurface.ts',
    importPath: './settingsStylesSurface',
    files: ['settings-chat-final.css', 'settings-visual-system.css'],
  },
  {
    module: 'settingsStylesFinal.ts',
    importPath: './settingsStylesFinal',
    files: ['settings-visibility-final.css', 'settings-product-shell.css', 'settings-product-reference-modern-bridge.css'],
  },
]

function createFixture(overrides: Record<string, string | null> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'settings-css-audit-'))
  const appDir = join(root, 'src/app')
  const stylesDir = join(appDir, 'styles')
  const uiV2Dir = join(root, 'src/features/uiV2')
  const settingsV3Dir = join(root, 'src/features/settingsV3')
  mkdirSync(stylesDir, { recursive: true })
  mkdirSync(uiV2Dir, { recursive: true })
  mkdirSync(settingsV3Dir, { recursive: true })
  const entrySource = "import { loadSettingsStyleBundles } from './settingsStyleBundles'\nawait loadSettingsStyleBundles()\n"
  const loaderSource = `
export const SETTINGS_STYLE_BUNDLES = [
${SETTINGS_STYLE_BUNDLES.map((bundle) => `  { id: '${bundle.module}', load: () => import('${bundle.importPath}') },`).join('\n')}
]
export async function loadSettingsStyleBundles() {
  for (const bundle of SETTINGS_STYLE_BUNDLES) {
    await bundle.load()
  }
}
`
  if (overrides['src/app/settingsDrawerEntry.ts'] !== null) {
    writeFileSync(join(appDir, 'settingsDrawerEntry.ts'), overrides['src/app/settingsDrawerEntry.ts'] ?? entrySource)
  }
  if (overrides['src/app/settingsStyleBundles.ts'] !== null) {
    writeFileSync(join(appDir, 'settingsStyleBundles.ts'), overrides['src/app/settingsStyleBundles.ts'] ?? loaderSource)
  }
  SETTINGS_STYLE_BUNDLES.forEach((bundle) => {
    if (overrides[`src/app/${bundle.module}`] === null) return
    const defaultSource = bundle.module === 'settingsStylesTheme.ts'
      ? `import './styles/settings-themes.css'\nif (new URLSearchParams(window.location.search).get('uiV2') === '0') {\n  await import('./settingsStylesThemeLegacy')\n}\nawait import('./settingsStylesThemeAligned')`
      : bundle.files.map((file) => `import './styles/${file}'`).join('\n')
    writeFileSync(join(appDir, bundle.module), overrides[`src/app/${bundle.module}`] ?? defaultSource)
  })
  writeFileSync(join(appDir, 'settingsStylesThemeLegacy.ts'), "import './styles/settings-themes-legacy.css'")
  writeFileSync(join(appDir, 'settingsStylesThemeAligned.ts'), "import './styles/settings-chat-aligned.css'")
  LEGACY_SETTINGS_FILES.forEach((file, index) => {
    if (overrides[file] === null) return
    writeFileSync(join(stylesDir, file), overrides[file] ?? `.fixture-${index} { color: rgb(${index}, 0, 0); }`)
  })
  MODERN_SETTINGS_FILES.forEach((file, index) => {
    writeFileSync(join(root, file.path), overrides[file.id] ?? `.modern-fixture-${index} { color: rgb(0, ${index}, 0); }`)
  })
  return root
}

test('settings CSS audit passes the repository controlled cascade', () => {
  const report = buildSettingsCssReport()
  assert.equal(report.metrics.fileCount, LEGACY_SETTINGS_FILES.length + MODERN_SETTINGS_FILES.length)
  assert.equal(report.metrics.groups.legacy.maxRuleCount, 1_700)
  assert.equal(report.metrics.groups.modernShared.maxRuleCount, 190)
  assert.equal(report.metrics.groups.modernSection.maxRuleCount, 120)
  assert.equal(report.metrics.identicalCrossFileRuleCount, 0)
  assert.equal(report.metrics.identicalSameFileRuleCount, 0)
  assert.equal(report.metrics.adjacentPropertyOverrideCount, 0)
  assert.equal(report.summary.ok, true)
})

test('settings CSS audit checks duplicate rules across legacy and modern groups', () => {
  const duplicate = '.cross-group-duplicate { color: red; }'
  const root = createFixture({
    'settings.css': duplicate,
    'settings-v2.css': duplicate,
  })
  try {
    const report = buildSettingsCssReport(root)
    assert.equal(report.metrics.identicalCrossFileRuleCount, 1)
    assert.equal(report.summary.ok, false)
    assert.ok(report.errors.some((error) => error.type === 'identical-cross-file-rules'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('settings CSS audit keeps shared modern rules inside their own budget', () => {
  const modernRules = Array.from(
    { length: 191 },
    (_, index) => `.modern-budget-${index} { color: rgb(${index % 255}, 0, 0); }`,
  ).join('\n')
  const root = createFixture({ 'settings-v2.css': modernRules })
  try {
    const report = buildSettingsCssReport(root)
    assert.equal(report.metrics.groups.legacy.ruleCount, LEGACY_SETTINGS_FILES.length)
    assert.ok(report.metrics.groups.modernShared.ruleCount > report.metrics.groups.modernShared.maxRuleCount)
    assert.ok(report.errors.some((error) => error.type === 'modernShared-rule-count-budget'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('settings CSS audit rejects an identical rule repeated in one file', () => {
  const root = createFixture({
    'settings.css': '.duplicate { color: red; }\n.duplicate { color: red; }',
  })
  try {
    const report = buildSettingsCssReport(root)
    assert.equal(report.metrics.identicalSameFileRuleCount, 1)
    assert.equal(report.summary.ok, false)
    assert.ok(report.errors.some((error) => error.type === 'identical-same-file-rules'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('settings CSS audit rejects adjacent declarations that immediately override the same property', () => {
  const root = createFixture({
    'settings.css': '.override { border-color: transparent; border-color: red; }',
  })
  try {
    const report = buildSettingsCssReport(root)
    assert.equal(report.metrics.adjacentPropertyOverrideCount, 1)
    assert.equal(report.adjacentPropertyOverrides[0]?.property, 'border-color')
    assert.equal(report.summary.ok, false)
    assert.ok(report.errors.some((error) => error.type === 'adjacent-property-overrides'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('settings CSS audit fails closed when the ordered bundle loader regresses', () => {
  const cases = [
    {
      name: 'static entry and missing bundle',
      overrides: {
        'src/app/settingsDrawerEntry.ts': "import './styles/settings.css'\n",
        'src/app/settingsStyleBundles.ts': 'export const SETTINGS_STYLE_BUNDLES = []\nawait Promise.all([])\n',
        'src/app/settingsStylesSurface.ts': null,
      },
      errors: ['static-entry-css-imports', 'style-bundle-order', 'parallel-style-bundles', 'missing-style-bundle'],
    },
    {
      name: 'duplicate CSS',
      overrides: {
        'src/app/settingsStylesFoundation.ts': "import './styles/settings.css'\nimport './styles/settings.css'\nimport './styles/settings-home.css'",
      },
      errors: ['style-bundle-files'],
    },
    {
      name: 'final CSS is not last',
      overrides: {
        'src/app/settingsStylesFinal.ts': "import './styles/settings-visibility-final.css'\nimport './styles/settings-product-reference-modern-bridge.css'\nimport './styles/settings-product-shell.css'",
      },
      errors: ['style-bundle-files', 'style-bundle-cascade-order', 'final-style-bundle-order'],
    },
  ] as const

  for (const item of cases) {
    const root = createFixture(item.overrides)
    try {
      const report = buildSettingsCssReport(root)
      assert.equal(report.summary.ok, false, item.name)
      for (const errorType of item.errors) {
        assert.ok(report.errors.some((error) => error.type === errorType), `${item.name}: ${errorType}`)
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
})
