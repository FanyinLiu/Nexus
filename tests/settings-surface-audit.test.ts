import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  buildSettingsSurfaceReport,
  findDuplicateContractPatterns,
} from '../scripts/settings-surface-audit.mjs'
import { BASELINE_FILES } from './fixtures/settingsSurfaceAuditBaseline.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function createFixture(overrides: Record<string, string | null> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'nexus-settings-surface-audit-'))
  for (const [relativePath, baseline] of Object.entries(BASELINE_FILES)) {
    if (overrides[relativePath] === null) continue
    const absolutePath = join(root, relativePath)
    mkdirSync(dirname(absolutePath), { recursive: true })
    writeFileSync(absolutePath, overrides[relativePath] ?? baseline)
  }
  return root
}

function withFixture<T>(overrides: Record<string, string | null>, callback: (root: string) => T): T {
  const root = createFixture(overrides)
  try {
    return callback(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('settings surface audit passes the protected settings contract', () => {
  withFixture({}, (root) => {
    const report = buildSettingsSurfaceReport(root)

    assert.equal(report.summary.ok, true)
    assert.equal(report.summary.errors, 0)
    assert.equal(report.privacy.staticSourceOnly, true)
    assert.deepEqual(report.duplicateContractPatterns, [])
    assert.ok(report.settingsDom.trustGroupOccurrences >= 1)
    assert.ok(report.settingsDom.trustTraceOccurrences >= 5)
    assert.ok(report.settingsDom.focusVisibleOccurrences >= 3)
  })
})

test('settings surface audit detects duplicate contract patterns', () => {
  const duplicates = findDuplicateContractPatterns([
    {
      id: 'duplicate-demo',
      file: 'src/app/styles/settings.css',
      description: 'duplicate demo',
      patterns: ['.settings-drawer', 'border-radius: 8px;', '.settings-drawer'],
    },
  ])

  assert.deepEqual(duplicates, [{
    id: 'duplicate-demo',
    file: 'src/app/styles/settings.css',
    repeatedPatterns: ['.settings-drawer'],
  }])
})

test('settings surface audit rejects missing trust-boundary groups', () => {
  withFixture({
    'src/components/settingsDrawerMetadata.ts': 'export const SETTINGS_SECTION_GROUPS = {}',
  }, (root) => {
    const report = buildSettingsSurfaceReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.missingContracts.some((item) => item.id === 'source-visible-trust-groups'))
  })
})

test('settings surface audit rejects missing home content architecture', () => {
  withFixture({
    'src/components/settingsHomeArchitecture.ts': 'export const SETTINGS_HOME_SECTIONS = []',
  }, (root) => {
    const report = buildSettingsSurfaceReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.missingContracts.some((item) => item.id === 'settings-home-content-architecture'))
  })
})

test('settings surface audit rejects platform-backend chrome', () => {
  withFixture({
    'src/components/SettingsDrawer.tsx': `${BASELINE_FILES['src/components/SettingsDrawer.tsx']}
<div className="admin-dashboard provider-studio agent-marketplace" />
`,
  }, (root) => {
    const report = buildSettingsSurfaceReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.forbiddenPatterns.some((item) => item.id === 'settings-default-platform-backend-chrome'))
  })
})

test('settings surface audit rejects Image4 visual language leaks', () => {
  withFixture({
    'src/app/styles/settings.css': `${BASELINE_FILES['src/app/styles/settings.css']}
.settings-drawer {
  --image4-rhythm-dial: 180px;
}
.settings-row {
  background: var(--image4-companion-surface);
}
.settings-panel-preview {
  composes: panel-companion from './panel-companion.css';
}
`,
  }, (root) => {
    const report = buildSettingsSurfaceReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.forbiddenPatterns.some((item) => item.id === 'settings-image4-visual-language-leak'))
  })
})

test('settings surface audit rejects the removed readability middle layer returning', () => {
  withFixture({
    'src/app/styles/settings-visibility-final.css': `${BASELINE_FILES['src/app/styles/settings-visibility-final.css']}
/* Settings readability pass. */
.settings-drawer {
  --settings-readable-line: rgba(83, 62, 45, 0.135);
}
.settings-home-card::after {
  content: ">";
}
`,
  }, (root) => {
    const report = buildSettingsSurfaceReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.forbiddenPatterns.some((item) => item.id === 'settings-visibility-old-readable-layer'))
  })
})

test('settings surface audit rejects release shortcut actions on settings home', () => {
  withFixture({
    'src/components/SettingsHomeView.tsx': `${BASELINE_FILES['src/components/SettingsHomeView.tsx']}
<ReleaseSpotlightActions />
{CURRENT_RELEASE_SPOTLIGHT.version}
`,
  }, (root) => {
    const report = buildSettingsSurfaceReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.forbiddenPatterns.some((item) => item.id === 'settings-home-release-shortcuts'))
  })
})

test('settings surface audit rejects missing focus-visible behavior', () => {
  withFixture({
    'src/app/styles/settings-home.css': '.settings-home-card:hover {}',
  }, (root) => {
    const report = buildSettingsSurfaceReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.missingContracts.some((item) => item.id === 'focus-visible-behavior'))
  })
})

test('settings surface audit rejects missing final visibility layer', () => {
  withFixture({
    'src/app/styles/settings-visibility-final.css': '',
  }, (root) => {
    const report = buildSettingsSurfaceReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.missingContracts.some((item) => item.id === 'settings-visibility-final-layer'))
  })
})

test('settings surface audit rejects missing home trust traces', () => {
  withFixture({
    'src/components/SettingsHomeView.tsx': '<button className="settings-home-card" />',
    'src/app/styles/settings-home.css': '.settings-home-card:focus-visible {} .settings-appearance-switch__option:focus-visible {}',
  }, (root) => {
    const report = buildSettingsSurfaceReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.missingContracts.some((item) => item.id === 'settings-home-trust-boundary-traces'))
    assert.ok(report.missingContracts.some((item) => item.id === 'settings-home-trust-trace-css'))
  })
})

test('settings surface audit rejects missing external action confirmation control', () => {
  withFixture({
    'src/components/settingsSections/ToolsSection.tsx': BASELINE_FILES['src/components/settingsSections/ToolsSection.tsx'].replace(
      '<ToggleField field="toolOpenExternalRequiresConfirmation" disabled={!draft.toolOpenExternalEnabled} />',
      '',
    ),
  }, (root) => {
    const report = buildSettingsSurfaceReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.missingContracts.some((item) => item.id === 'external-tool-permission-affordances'))
  })
})

test('settings surface audit runs against the repository', () => {
  const report = buildSettingsSurfaceReport(ROOT)

  assert.equal(report.summary.ok, true)
  assert.equal(report.summary.errors, 0)
})
