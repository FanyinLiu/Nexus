import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { buildV04UiImplementationRouteReport } from '../scripts/v04-ui-implementation-route-audit.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const ROUTE_DOC = `
# Nexus 0.4 UI Implementation Route

## Source Of Truth

docs/open-source-ui-pro-review-registry.json
docs/OPEN_SOURCE_UI_REFERENCE_AUDIT.md
docs/open-source-ui-reference-manifest.json
docs/IMAGE4_COMPANION_FIELD_REFERENCE_REVIEW.md
Companion tone and color
docs/COMPOSER_SURFACE_REFERENCE_REVIEW.md
docs/CHAT_SURFACE_REFERENCE_REVIEW.md
docs/SETTINGS_SURFACE_REFERENCE_REVIEW.md
docs/FORMS_SURFACE_REFERENCE_REVIEW.md
docs/FOCUS_MANAGEMENT_REFERENCE_REVIEW.md
docs/STREAMING_SURFACE_REFERENCE_REVIEW.md
docs/AGENT_ACTIVITY_SURFACE_REFERENCE_REVIEW.md

No raw Pro answer becomes code.
Generating a Pro payload is not the same as asking Pro.
Use the pre-send payload after user confirmation.

## Implementation Order

Contract freeze
do not start implementation for that surface
Image4 shell and rhythm
Companion tone and color
Composer and input controls
Chat and streaming
Settings, forms, and focus
Agent activity and desktop awareness
Human browser review

## Cross-Surface Guardrails

Borrow constraints, not skins.
Companion-first beats dashboard or workbench framing.
No card stack, nested cards, cockpit, terminal log, timeline, or autonomous task board as default UI.
Do not make headers, buttons, or utility controls larger to fix visual hierarchy.
Text must fit within its own container on narrow and normal panel widths.
Motion should clarify state only.
Theme changes must be scoped to the surface being changed.

## Verification Spine

npm run v04:ui-route:audit
npm run ui:references:audit
npm run ui:references:audit -- --pro-readiness
npm run ui:references:audit -- --implementation-status
npm run ui:references:audit -- --surface=<surface> --pro-send-payload
npm run ui:references:audit -- --surface=<surface> --pro-registry-transition=sent
npm run image4:color:audit
npm run image4:visual-contract:audit
npm run image4:contract:check
npm run composer:surface:audit
npm run chat:surface:audit
npm run settings:surface:audit
npm run forms:surface:audit
npm run focus:surface:audit
npm run streaming:surface:audit
npm run agent-activity:surface:audit
npm run source-size:audit
npx tsc -b --pretty false
npm run build

## Acceptance
`

const PANEL_VIEW_SOURCE = `
const useCompanionV2 = new URLSearchParams(window.location.search).get('uiV2') !== '0'
  && (settings.vtsEnabled || Boolean(petModel.spriteAtlas) || Boolean(petModel.modelPath))
return useCompanionV2 ? <CompanionPanelV2 /> : <LegacyPanelView />
`

const PET_VIEW_SOURCE = `
const useCompanionV2 = new URLSearchParams(window.location.search).get('uiV2') !== '0'
  && !settings.vtsEnabled
  && !petModel.spriteAtlas
  && Boolean(petModel.modelPath)
return useCompanionV2 ? <FramelessCompanionSurface /> : <LegacyPetView />
`

const SETTINGS_DRAWER_SOURCE = `
if (new URLSearchParams(window.location.search).get('uiV2') !== '0') return <SettingsDrawerV2 />
`

const SETTINGS_SECTION_MODULES_SOURCE = `
export const loadMemorySection = () => import('../features/settingsV3/MemorySectionV3.tsx')
const routes = { memory: loadMemorySection }
`

const BASELINE_FILES: Record<string, string> = {
  'docs/V0.4_UI_IMPLEMENTATION_ROUTE.md': ROUTE_DOC,
  'docs/OPEN_SOURCE_UI_REFERENCE_AUDIT.md': 'See docs/V0.4_UI_IMPLEMENTATION_ROUTE.md for the implementation route.',
  'docs/open-source-ui-pro-review-registry.json': '{}',
  'docs/open-source-ui-reference-manifest.json': '{}',
  'docs/IMAGE4_COMPANION_FIELD_REFERENCE_REVIEW.md': '# Image4',
  'docs/COMPOSER_SURFACE_REFERENCE_REVIEW.md': '# Composer',
  'docs/CHAT_SURFACE_REFERENCE_REVIEW.md': '# Chat',
  'docs/SETTINGS_SURFACE_REFERENCE_REVIEW.md': '# Settings',
  'docs/FORMS_SURFACE_REFERENCE_REVIEW.md': '# Forms',
  'docs/FOCUS_MANAGEMENT_REFERENCE_REVIEW.md': '# Focus',
  'docs/STREAMING_SURFACE_REFERENCE_REVIEW.md': '# Streaming',
  'docs/AGENT_ACTIVITY_SURFACE_REFERENCE_REVIEW.md': '# Agent Activity',
  'src/app/views/PanelView.tsx': PANEL_VIEW_SOURCE,
  'src/app/views/PetView.tsx': PET_VIEW_SOURCE,
  'src/components/SettingsDrawer.tsx': SETTINGS_DRAWER_SOURCE,
  'src/components/settingsSectionModules.ts': SETTINGS_SECTION_MODULES_SOURCE,
  'package.json': JSON.stringify({
    scripts: {
      'v04:ui-route:audit': 'node scripts/v04-ui-implementation-route-audit.mjs',
      'image4:color:audit': 'node scripts/image4-companion-color-audit.mjs',
    },
  }),
}

function createFixture(overrides: Record<string, string | null> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'nexus-v04-ui-route-audit-'))
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

test('0.4 UI implementation route audit passes the protected route contract', () => {
  withFixture({}, (root) => {
    const report = buildV04UiImplementationRouteReport(root)

    assert.equal(report.summary.ok, true)
    assert.equal(report.summary.errors, 0)
  })
})

test('0.4 UI implementation route audit rejects missing surface coverage', () => {
  withFixture({
    'docs/V0.4_UI_IMPLEMENTATION_ROUTE.md': ROUTE_DOC.replace('docs/CHAT_SURFACE_REFERENCE_REVIEW.md', ''),
  }, (root) => {
    const report = buildV04UiImplementationRouteReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.missingSurfaceDocs.includes('docs/CHAT_SURFACE_REFERENCE_REVIEW.md'))
  })
})

test('0.4 UI implementation route audit rejects a missing active route source file', () => {
  withFixture({
    'src/app/views/PanelView.tsx': null,
  }, (root) => {
    const report = buildV04UiImplementationRouteReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.activeRouteIssues.some((issue) => (
      issue.contract === 'panel-v2-route'
      && issue.file === 'src/app/views/PanelView.tsx'
      && issue.missingFragment === '[source file missing]'
    )))
  })
})

test('0.4 UI implementation route audit rejects a Panel route without its V2 surface', () => {
  withFixture({
    'src/app/views/PanelView.tsx': PANEL_VIEW_SOURCE.replace('<CompanionPanelV2', ''),
  }, (root) => {
    const report = buildV04UiImplementationRouteReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.activeRouteIssues.some((issue) => (
      issue.contract === 'panel-v2-route'
      && issue.file === 'src/app/views/PanelView.tsx'
      && issue.missingFragment === '<CompanionPanelV2'
    )))
  })
})

test('0.4 UI implementation route audit rejects a Memory route that falls back from V3', () => {
  withFixture({
    'src/components/settingsSectionModules.ts': SETTINGS_SECTION_MODULES_SOURCE.replace('MemorySectionV3.tsx', 'MemorySectionV2.tsx'),
  }, (root) => {
    const report = buildV04UiImplementationRouteReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.activeRouteIssues.some((issue) => (
      issue.contract === 'memory-v3-route'
      && issue.file === 'src/components/settingsSectionModules.ts'
      && issue.missingFragment.includes('MemorySectionV3.tsx')
    )))
  })
})

test('0.4 UI implementation route audit rejects missing companion-tone stage', () => {
  withFixture({
    'docs/V0.4_UI_IMPLEMENTATION_ROUTE.md': ROUTE_DOC.replaceAll('Companion tone and color', ''),
  }, (root) => {
    const report = buildV04UiImplementationRouteReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.missingRoutePatterns.some((item) => item.id === 'companion-tone-and-color'))
  })
})

test('0.4 UI implementation route audit rejects missing verification command', () => {
  withFixture({
    'docs/V0.4_UI_IMPLEMENTATION_ROUTE.md': ROUTE_DOC.replace('npm run agent-activity:surface:audit', ''),
  }, (root) => {
    const report = buildV04UiImplementationRouteReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.missingCommands.includes('npm run agent-activity:surface:audit'))
  })
})

test('0.4 UI implementation route audit rejects missing pre-send transition command', () => {
  withFixture({
    'docs/V0.4_UI_IMPLEMENTATION_ROUTE.md': ROUTE_DOC.replace(
      'npm run ui:references:audit -- --surface=<surface> --pro-registry-transition=sent',
      '',
    ),
  }, (root) => {
    const report = buildV04UiImplementationRouteReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.missingCommands.includes('npm run ui:references:audit -- --surface=<surface> --pro-registry-transition=sent'))
  })
})

test('0.4 UI implementation route audit rejects direct Pro-to-source workflow', () => {
  withFixture({
    'docs/V0.4_UI_IMPLEMENTATION_ROUTE.md': `${ROUTE_DOC}
paste Pro answer into source
`,
  }, (root) => {
    const report = buildV04UiImplementationRouteReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.forbiddenPatterns.some((item) => item.id === 'raw-pro-to-source'))
  })
})

test('0.4 UI implementation route audit requires the npm script wiring', () => {
  withFixture({
    'package.json': JSON.stringify({
      scripts: {
        'image4:color:audit': 'node scripts/image4-companion-color-audit.mjs',
      },
    }),
  }, (root) => {
    const report = buildV04UiImplementationRouteReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.packageScriptIssues.some((item) => item.id === 'missing-v04-ui-route-script'))
  })
})

test('0.4 UI implementation route audit requires the Image4 color audit wiring', () => {
  withFixture({
    'package.json': JSON.stringify({
      scripts: {
        'v04:ui-route:audit': 'node scripts/v04-ui-implementation-route-audit.mjs',
      },
    }),
  }, (root) => {
    const report = buildV04UiImplementationRouteReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.packageScriptIssues.some((item) => item.id === 'missing-image4-color-audit-script'))
  })
})

test('0.4 UI implementation route audit runs against the repository', () => {
  const report = buildV04UiImplementationRouteReport(ROOT)

  assert.equal(report.summary.ok, true)
  assert.equal(report.summary.errors, 0)
})
