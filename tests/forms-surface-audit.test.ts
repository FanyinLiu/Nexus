import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { buildFormsSurfaceReport } from '../scripts/forms-surface-audit.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const BASELINE_FILES: Record<string, string> = {
  'docs/FORMS_SURFACE_REFERENCE_REVIEW.md': `
# Forms Surface Reference Review

Forms use label, description, control, validation slots.

- shadcn/ui
- Radix UI Primitives
- htmlFor
- aria-labelledby
- aria-describedby
- aria-invalid
- aria-disabled
- Escape/Tab behavior

\`\`\`text
forms = low-noise configuration row system
forms = card-heavy settings dashboard
\`\`\`
`,
  'src/components/settingsFields.tsx': `
export function TextField() {
  const inputId = 'model-provider'
  const descriptionId = description ? \`\${inputId}-description\` : undefined
  const validationId = validation ? \`\${inputId}-validation\` : undefined
  const describedBy = [descriptionId, validationId].filter(Boolean).join(' ') || undefined
  return (
    <div className="settings-form-row">
      <label className="settings-form-row__label" htmlFor="model-provider">Provider</label>
      <p className="settings-form-row__description" id={descriptionId}>Choose a provider.</p>
      <input id="model-provider" aria-describedby={describedBy} aria-invalid={validation ? true : undefined} />
      <p className="settings-form-row__validation" id={validationId}>Error</p>
      <p className="settings-form-row__status">Saved</p>
    </div>
  )
}
`,
  'src/components/settingsSections/ModelSection.tsx': `
export function ModelSection() {
  return (
    <label>
      <span>Provider</span>
      <select />
      <UrlInput />
      <p className="settings-drawer__hint">Choose a provider.</p>
      <small className="settings-model-advanced__error">Error</small>
    </label>
  )
}
`,
  'src/components/settingsSections/MemorySection.tsx': 'export function MemorySection() { return <label htmlFor="memory"><input id="memory" /></label> }',
  'src/components/settingsSections/ToolsSection.tsx': 'export function ToolsSection() { return <label htmlFor="tool"><input id="tool" /></label> }',
  'src/components/settingsSections/WindowSection.tsx': 'export function WindowSection() { return <label htmlFor="window"><input id="window" /></label> }',
  'src/app/styles/settings.css': `
:root { --settings-control-height: 26px; }
.settings-form-row {}
.settings-form-row__label {}
.settings-form-row__description {}
.settings-form-row__validation {}
.settings-control-card {}
.settings-toggle {}
.settings-section__note {}
.settings-drawer__hint {}
.settings-control-card:focus-visible {}
`,
  'src/app/styles/settings-home.css': '.settings-home-card:focus-visible {} .settings-appearance-switch {}',
  'src/app/styles/settings-visual-system.css': `
.sd, .sb {
  --nx-settings-control-height: 30px;
  --nx-settings-row-height: 38px;
  --nx-settings-field-height: 32px;
}
.sd-section .sp.sp {
  --settings-child-control-height: var(--nx-settings-control-height);
}
.sd-section .sp.sp .settings-form-row {}
.sd-section .sp.sp .settings-form-row__validation {}
`,
  'src/app/styles/settings-product-reference-final.css': `
.sd-section .sp.sp .settings-toggle input:checked {
  background: var(--nx-settings-accent);
  box-shadow: none;
}
`,
  'src/features/settingsV3/settings-v3.css': `
.settings-v3-switch input:checked + .settings-v3-switch__track { background: var(--sv3-accent); }
.settings-v3-switch input:focus-visible + .settings-v3-switch__track {}
`,
}

function createFixture(overrides: Record<string, string | null> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'nexus-forms-surface-audit-'))
  mkdirSync(join(root, 'src/components/settingsSections'), { recursive: true })
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

test('forms surface audit passes the protected forms contract', () => {
  withFixture({}, (root) => {
    const report = buildFormsSurfaceReport(root)

    assert.equal(report.summary.ok, true)
    assert.equal(report.summary.errors, 0)
    assert.equal(report.privacy.staticSourceOnly, true)
    assert.ok(report.formsDom.labelOccurrences >= 1)
    assert.ok(report.formsDom.htmlForOccurrences >= 1)
    assert.ok(report.formsDom.formRowOccurrences >= 1)
    assert.ok(report.formsDom.ariaDescribedByOccurrences >= 1)
    assert.ok(report.formsDom.ariaInvalidOccurrences >= 1)
  })
})

test('forms surface audit rejects missing Pro contract phrases', () => {
  withFixture({
    'docs/FORMS_SURFACE_REFERENCE_REVIEW.md': BASELINE_FILES['docs/FORMS_SURFACE_REFERENCE_REVIEW.md'].replace(
      'forms = low-noise configuration row system',
      'forms = generic settings',
    ),
  }, (root) => {
    const report = buildFormsSurfaceReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.missingContracts.some((item) => item.id === 'forms-pro-contract-recorded'))
  })
})

test('forms surface audit rejects dashboard card chrome', () => {
  withFixture({
    'src/app/styles/settings.css': `${BASELINE_FILES['src/app/styles/settings.css']}
.settings-card-stack {}
`,
  }, (root) => {
    const report = buildFormsSurfaceReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.forbiddenPatterns.some((item) => item.id === 'forms-dashboard-card-chrome'))
  })
})

test('forms surface audit rejects missing shared form-row semantics', () => {
  withFixture({
    'src/components/settingsFields.tsx': 'export function TextField() { return <label><input /></label> }',
  }, (root) => {
    const report = buildFormsSurfaceReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.missingContracts.some((item) => item.id === 'settings-form-row-component'))
  })
})

test('forms surface audit rejects a split description and validation chain', () => {
  withFixture({
    'src/components/settingsFields.tsx': BASELINE_FILES['src/components/settingsFields.tsx'].replace(
      "const describedBy = [descriptionId, validationId].filter(Boolean).join(' ') || undefined",
      'const describedBy = descriptionId',
    ),
  }, (root) => {
    const report = buildFormsSurfaceReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.missingContracts.some((item) => item.id === 'settings-form-row-describedby-chain'))
  })
})

test('forms surface audit keeps active and fallback toggle states independently owned', () => {
  withFixture({
    'src/features/settingsV3/settings-v3.css': '',
  }, (root) => {
    const report = buildFormsSurfaceReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.missingContracts.some((item) => item.id === 'v3-settings-toggle-state-css'))
  })
})

test('forms surface audit runs against the repository', () => {
  const report = buildFormsSurfaceReport(ROOT)

  assert.equal(report.summary.ok, true)
  assert.equal(report.summary.errors, 0)
})
