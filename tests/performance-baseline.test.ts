import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import {
  mkdir as mkdirDirectory,
  open as openFile,
  readFile as readLockFile,
  readdir as readdirLock,
  rmdir as rmdirDirectory,
  unlink as unlinkFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  acquireBuildLock,
  BUILD_LOCK_FILE,
  buildLockOwnerFileName,
  buildProject,
  releaseBuildLock,
  shouldWriteBuildIntegrityStamp,
} from '../scripts/build.mjs'
import { computeBuildInputFingerprint } from '../scripts/build-fingerprint.mjs'
import { buildPerformanceBaselineReport } from '../scripts/performance-baseline.mjs'

const REQUIRED_LAZY_FILES = {
  'src/features/memory/vectorSearchRuntime.ts': "export const load = () => import('@huggingface/transformers')\n",
  'src/features/hearing/browserVad.ts': "export const load = () => import('@ricky0123/vad-web')\n",
  'src/features/vision/ocrWorker.ts': "export const load = () => import('tesseract.js')\n",
  'src/features/pet/components/live2d/vendor.ts': 'export function ensureLive2DVendorScripts() {}\n',
}

const REQUIRED_SETTINGS_UI_BASES = [
  'AutonomySectionV3',
  'ChatSectionV3',
  'ConsoleSectionV3',
  'HistorySectionV3',
  'IntegrationsSectionV3',
  'LettersSectionV3',
  'LorebooksSectionV3',
  'MemorySectionV3',
  'ModelSectionV3',
  'ToolsSectionV3',
  'VoiceSectionV3',
  'WindowSectionV3',
]
const DEFAULT_SETTINGS_UI_ASSETS = Object.fromEntries([
  'settings-ui',
  ...REQUIRED_SETTINGS_UI_BASES,
  'SettingsV3Primitives',
].map((base) => [`${base}-abc123.js`, 1_000]))
const SETTINGS_STYLE_CSS_BASES = [
  'settingsStylesFoundation',
  'settingsStylesTheme',
  'settingsStylesThemeLegacy',
  'settingsStylesThemeAligned',
  'settingsStylesSurface',
  'settingsStylesFinal',
]
const DEFAULT_SETTINGS_STYLE_CSS_ASSETS = Object.fromEntries(
  SETTINGS_STYLE_CSS_BASES.map((base) => [`${base}-abc123.css`, 0]),
)
const DEFAULT_ONBOARDING_GUIDE_CSS_ASSETS = {
  'OnboardingGuide-abc123.css': 0,
}

function writeBytes(path: string, bytes: number) {
  writeFileSync(path, Buffer.alloc(bytes, 97))
}

function writeFileWithParents(root: string, relativePath: string, content: string) {
  const absolutePath = join(root, relativePath)
  mkdirSync(join(absolutePath, '..'), { recursive: true })
  writeFileSync(absolutePath, content)
}

function deferred() {
  let resolvePromise!: () => void
  let rejectPromise!: (error: unknown) => void
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return { promise, resolve: resolvePromise, reject: rejectPromise }
}

type BaselineFixtureOptions = {
  includeCompleteSettings?: boolean
  omitSettingsUiBases?: string[]
  includeSettingsStyleCss?: boolean
  omitSettingsStyleBases?: string[]
  includeOnboardingGuideCss?: boolean
}

function createBaselineFixture(
  assets: Record<string, number | string>,
  options: BaselineFixtureOptions = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'nexus-performance-baseline-'))
  mkdirSync(join(root, 'dist', 'assets'), { recursive: true })

  for (const [relativePath, content] of Object.entries(REQUIRED_LAZY_FILES)) {
    writeFileWithParents(root, relativePath, content)
  }

  writeFileSync(join(root, 'package.json'), JSON.stringify({
    build: {
      files: [
        '!**/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.*',
        '!**/onnxruntime-web/dist/ort-wasm-simd-threaded.jspi.*',
        '!**/onnxruntime-web/dist/ort.training.wasm.min.*',
        '!**/onnxruntime-web/dist/ort.webgl.*',
        '!**/onnxruntime-web/dist/ort.webgpu.*',
      ],
    },
  }))

  const omittedBases = new Set(options.omitSettingsUiBases ?? [])
  const omittedStyleBases = new Set(options.omitSettingsStyleBases ?? [])
  const defaultAssets = options.includeCompleteSettings === false
    ? {}
    : Object.fromEntries(Object.entries(DEFAULT_SETTINGS_UI_ASSETS)
      .filter(([fileName]) => ![...omittedBases].some((base) => fileName.startsWith(`${base}-`))))
  const defaultStyleAssets = options.includeSettingsStyleCss === false
    ? {}
    : Object.fromEntries(Object.entries(DEFAULT_SETTINGS_STYLE_CSS_ASSETS)
      .filter(([fileName]) => ![...omittedStyleBases].some((base) => fileName.startsWith(`${base}-`))))
  const defaultOnboardingAssets = options.includeOnboardingGuideCss === false
    ? {}
    : DEFAULT_ONBOARDING_GUIDE_CSS_ASSETS
  for (const [fileName, value] of Object.entries({
    ...defaultStyleAssets,
    ...defaultOnboardingAssets,
    ...defaultAssets,
    ...assets,
  })) {
    const path = join(root, 'dist', 'assets', fileName)
    if (typeof value === 'number') writeBytes(path, value)
    else writeFileSync(path, value)
  }

  const fingerprint = computeBuildInputFingerprint(root)
  writeFileSync(join(root, 'dist', 'build-integrity.json'), JSON.stringify({
    schemaVersion: 1,
    algorithm: 'sha256',
    inputFingerprint: fingerprint.digest,
    inputFileCount: fingerprint.fileCount,
    buildSteps: ['tsc -b', 'vite build', 'scripts/minify-built-css.mjs'],
  }))

  return root
}

function withBaselineFixture<T>(
  assets: Record<string, number | string>,
  callback: (root: string) => T,
  options: BaselineFixtureOptions = {},
): T {
  const root = createBaselineFixture(assets, options)
  try {
    return callback(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('performance baseline reports the largest CSS chunk without failing under budget', () => {
  withBaselineFixture({
    'index-abc123.css': 220_000,
    'generic-shell.css': 320_000,
    'settingsDrawerEntry-abc123.js': 16_000,
    'settings-ui-abc123.js': 340_000,
    'app.js': 64_000,
  }, (root) => {
    const report = buildPerformanceBaselineReport(root)

    assert.equal(report.assetMetrics.largestCssChunk?.fileName, 'generic-shell.css')
    assert.equal(report.assetMetrics.largestCssChunk?.bytes, 320_000)
    assert.equal(report.assetMetrics.initialCssChunk?.bytes, 220_000)
    assert.equal(report.assetMetrics.onboardingGuideCssChunk?.fileName, 'OnboardingGuide-abc123.css')
    assert.equal(report.assetMetrics.onboardingGuideCssChunks.length, 1)
    assert.equal(report.assetMetrics.settingsUiChunk?.bytes, 340_000)
    assert.equal(report.assetMetrics.settingsUiChunks.length, 14)
    assert.equal(report.assetMetrics.settingsUiChunksByBase.MemorySectionV3.length, 1)
    assert.equal(report.assetMetrics.totalSettingsUiChunkBytes, 353_000)
    assert.equal(report.buildFreshness.ok, true)
    assert.equal(report.privacy.readsUserStorage, false)
    assert.equal(report.privacy.readsRuntimeMetrics, false)
    assert.equal(report.privacy.readsStaticProjectInputs, true)
    assert.equal(report.privacy.readsDistBuildOutput, true)
    assert.equal(report.assetMetrics.totals.totalCssBytes, 540_000)
    assert.equal(report.summary.ok, true)
  })
})

test('performance baseline enforces the lazy onboarding CSS chunk boundary', () => {
  withBaselineFixture({
    'index-abc123.css': 220_000,
    'OnboardingGuide-abc123.css': 24_000,
    'settingsDrawerEntry-abc123.js': 16_000,
    'app.js': 64_000,
  }, (root) => {
    const report = buildPerformanceBaselineReport(root)

    assert.equal(report.assetMetrics.onboardingGuideCssChunk?.bytes, 24_000)
    assert.equal(report.budgets.maxOnboardingGuideCssChunkBytes, 30_000)
    assert.equal(report.assetMetrics.initialCssForbiddenOnboardingSelectors.length, 0)
    assert.equal(report.summary.ok, true)
  })
})

test('performance baseline rejects missing, duplicate, oversized, or eager onboarding CSS', () => {
  withBaselineFixture({
    'index-abc123.css': '.app{}',
    'settingsDrawerEntry-abc123.js': 16_000,
  }, (root) => {
    const report = buildPerformanceBaselineReport(root)
    assert.deepEqual(
      report.errors.filter((error) => error.metric === 'missingOnboardingGuideCssChunk'),
      [{ metric: 'missingOnboardingGuideCssChunk', actual: 0, budget: 1 }],
    )
  }, { includeOnboardingGuideCss: false })

  withBaselineFixture({
    'index-abc123.css': '.app{}',
    'OnboardingGuide-def456.css': 1,
    'settingsDrawerEntry-abc123.js': 16_000,
  }, (root) => {
    const report = buildPerformanceBaselineReport(root)
    assert.deepEqual(
      report.errors.filter((error) => error.metric === 'duplicateOnboardingGuideCssChunk'),
      [{
        metric: 'duplicateOnboardingGuideCssChunk',
        actual: 2,
        budget: 1,
        files: ['OnboardingGuide-def456.css', 'OnboardingGuide-abc123.css'],
      }],
    )
  })

  withBaselineFixture({
    'index-abc123.css': '.app{}',
    'OnboardingGuide-abc123.css': 30_001,
    'settingsDrawerEntry-abc123.js': 16_000,
  }, (root) => {
    const report = buildPerformanceBaselineReport(root)
    assert.deepEqual(
      report.errors.filter((error) => error.metric === 'maxOnboardingGuideCssChunkBytes'),
      [{ metric: 'maxOnboardingGuideCssChunkBytes', actual: 30_001, budget: 30_000 }],
    )
  })

  withBaselineFixture({
    'index-abc123.css': '.app{}',
    'index-eager-secondary.css': '.onboarding-region-tabs{}',
    'settingsDrawerEntry-abc123.js': 16_000,
  }, (root) => {
    const report = buildPerformanceBaselineReport(root)
    assert.deepEqual(
      report.errors.filter((error) => error.metric === 'initialCssOnboardingSelectorLeak'),
      [{
        metric: 'initialCssOnboardingSelectorLeak',
        actual: 1,
        budget: 0,
        selectors: ['.onboarding-region-tabs'],
      }],
    )
  })

  withBaselineFixture({
    'index-abc123.css': '.ai-disclosure-copy{}@keyframes onboarding-pulse{}',
    'settingsDrawerEntry-abc123.js': 16_000,
  }, (root) => {
    const report = buildPerformanceBaselineReport(root)
    assert.deepEqual(
      report.errors.filter((error) => error.metric === 'initialCssOnboardingSelectorLeak'),
      [{
        metric: 'initialCssOnboardingSelectorLeak',
        actual: 2,
        budget: 0,
        selectors: ['.ai-disclosure-copy', '@keyframes onboarding-pulse'],
      }],
    )
  })
})

test('performance baseline reports all ordered settings CSS bundles', () => {
  withBaselineFixture({
    'index-abc123.css': 220_000,
    'settingsStylesFoundation-abc123.css': 70_000,
    'settingsStylesTheme-abc123.css': 80_000,
    'settingsStylesSurface-abc123.css': 75_000,
    'settingsStylesFinal-abc123.css': 85_000,
    'settingsDrawerEntry-abc123.js': 16_000,
    'app.js': 64_000,
  }, (root) => {
    const report = buildPerformanceBaselineReport(root)

    assert.equal(report.assetMetrics.settingsStyleCssChunks.length, 6)
    assert.equal(report.assetMetrics.totalSettingsStyleCssChunkBytes, 310_000)
    assert.equal(report.assetMetrics.largestSettingsStyleCssChunk?.fileName, 'settingsStylesFinal-abc123.css')
    assert.equal(report.assetMetrics.largestSettingsStyleCssChunk?.bytes, 85_000)
    assert.equal(report.budgets.maxSettingsStyleCssChunkBytes, 200_000)
    assert.equal(report.budgets.totalSettingsStyleCssChunkBytes, 330_000)
    assert.equal(report.summary.ok, true)
  })
})

test('performance baseline rejects a missing settings CSS base', () => {
  withBaselineFixture({
    'settingsDrawerEntry-abc123.js': 16_000,
  }, (root) => {
    const report = buildPerformanceBaselineReport(root)

    assert.deepEqual(
      report.errors.filter((error) => error.metric === 'missingSettingsCssChunk'),
      [{ metric: 'missingSettingsCssChunk', actual: 0, budget: 1, chunk: 'settingsStylesSurface' }],
    )
    assert.equal(report.summary.ok, false)
  }, { omitSettingsStyleBases: ['settingsStylesSurface'] })
})

test('performance baseline rejects a duplicate settings CSS base', () => {
  withBaselineFixture({
    'settingsStylesTheme-def456.css': 1,
    'settingsDrawerEntry-abc123.js': 16_000,
  }, (root) => {
    const report = buildPerformanceBaselineReport(root)

    assert.deepEqual(
      report.errors.filter((error) => error.metric === 'duplicateSettingsCssChunk'),
      [{ metric: 'duplicateSettingsCssChunk', actual: 2, budget: 1, chunk: 'settingsStylesTheme' }],
    )
    assert.equal(report.summary.ok, false)
  })
})

test('performance baseline rejects the aggregate settings CSS budget', () => {
  withBaselineFixture({
    'settingsStylesFoundation-abc123.css': 130_000,
    'settingsStylesTheme-abc123.css': 130_000,
    'settingsStylesSurface-abc123.css': 130_000,
    'settingsStylesFinal-abc123.css': 130_000,
    'settingsDrawerEntry-abc123.js': 16_000,
  }, (root) => {
    const report = buildPerformanceBaselineReport(root)

    assert.deepEqual(
      report.errors.filter((error) => error.metric === 'totalSettingsStyleCssChunkBytes'),
      [{ metric: 'totalSettingsStyleCssChunkBytes', actual: 520_000, budget: 330_000 }],
    )
    assert.equal(report.summary.ok, false)
  })
})

test('performance baseline fails when a single CSS chunk crosses the budget', () => {
  withBaselineFixture({
    'index-abc123.css': 220_000,
    'generic-shell.css': 480_001,
    'settingsDrawerEntry-abc123.js': 16_000,
    'ModelSection-abc123.js': 340_000,
    'app.js': 64_000,
  }, (root) => {
    const report = buildPerformanceBaselineReport(root)

    assert.equal(report.assetMetrics.largestCssChunk?.fileName, 'generic-shell.css')
    assert.deepEqual(
      report.errors.filter((error) => error.metric === 'maxCssChunkBytes'),
      [{ metric: 'maxCssChunkBytes', actual: 480_001, budget: 480_000 }],
    )
    assert.equal(report.summary.ok, false)
  })
})

test('performance baseline fails when total CSS drifts above the tightened budget', () => {
  withBaselineFixture({
    'index-abc123.css': 440_000,
    'generic-shell.css': 320_000,
    'settings-extra.css': 1,
    'settingsDrawerEntry-abc123.js': 16_000,
    'ModelSection-abc123.js': 340_000,
    'app.js': 64_000,
  }, (root) => {
    const report = buildPerformanceBaselineReport(root)

    assert.deepEqual(
      report.errors.filter((error) => error.metric === 'totalCssBytes'),
      [{ metric: 'totalCssBytes', actual: 760_001, budget: 710_000 }],
    )
    assert.equal(report.summary.ok, false)
  })
})

test('performance baseline warns when CSS budget headroom is nearly exhausted', () => {
  withBaselineFixture({
    'index-abc123.css': 250_000,
    'generic-shell.css': 440_000,
    'settingsDrawerEntry-abc123.js': 16_000,
    'ModelSection-abc123.js': 340_000,
    'app.js': 64_000,
  }, (root) => {
    const report = buildPerformanceBaselineReport(root)

    assert.equal(report.summary.ok, true)
    assert.deepEqual(
      report.warnings.map((warning) => warning.metric),
      ['totalCssBytes', 'maxCssChunkBytes'],
    )
    assert.equal(report.summary.warnings, 2)
  })
})

test('performance baseline fails when initial CSS crosses the startup budget', () => {
  withBaselineFixture({
    'index-abc123.css': 260_001,
    'generic-shell.css': 320_000,
    'settingsDrawerEntry-abc123.js': 16_000,
    'ModelSection-abc123.js': 340_000,
    'app.js': 64_000,
  }, (root) => {
    const report = buildPerformanceBaselineReport(root)

    assert.deepEqual(
      report.errors.filter((error) => error.metric === 'maxInitialCssChunkBytes'),
      [{ metric: 'maxInitialCssChunkBytes', actual: 260_001, budget: 260_000 }],
    )
    assert.equal(report.summary.ok, false)
  })
})

test('performance baseline fails when a settings CSS chunk crosses its strict budget', () => {
  withBaselineFixture({
    'index-abc123.css': 220_000,
    'settingsStylesFoundation-abc123.css': 200_001,
    'settingsDrawerEntry-abc123.js': 16_000,
    'ModelSection-abc123.js': 340_000,
    'app.js': 64_000,
  }, (root) => {
    const report = buildPerformanceBaselineReport(root)

    assert.deepEqual(
      report.errors.filter((error) => error.metric === 'maxSettingsStyleCssChunkBytes'),
      [{ metric: 'maxSettingsStyleCssChunkBytes', actual: 200_001, budget: 200_000 }],
    )
    assert.equal(report.summary.ok, false)
  })
})

test('performance baseline rejects a legacy single settings CSS bundle', () => {
  for (const fileName of ['settingsDrawerEntry.css', 'settingsDrawerEntry-abc123.css']) {
    withBaselineFixture({
      [fileName]: 434_268,
      'settingsDrawerEntry-abc123.js': 16_000,
      'app.js': 64_000,
    }, (root) => {
      const report = buildPerformanceBaselineReport(root)

      assert.deepEqual(
        report.errors.filter((error) => error.metric === 'legacySettingsCssChunk'),
        [{
          metric: 'legacySettingsCssChunk',
          actual: 434_268,
          budget: 0,
          files: [fileName],
        }],
      )
      assert.equal(report.summary.ok, false)
    }, {
      includeSettingsStyleCss: false,
    })
  }
})

test('performance baseline tracks the lazy settings drawer entry budget', () => {
  withBaselineFixture({
    'generic-shell.css': 320_000,
    'settingsDrawerEntry-abc123.js': 64_000,
    'ModelSection-abc123.js': 340_000,
    'app.js': 64_000,
  }, (root) => {
    const report = buildPerformanceBaselineReport(root)

    assert.equal(report.assetMetrics.settingsDrawerEntryChunk?.fileName, 'settingsDrawerEntry-abc123.js')
    assert.equal(report.assetMetrics.settingsDrawerEntryChunk?.bytes, 64_000)
    assert.equal(report.summary.ok, true)
  })
})

test('performance baseline fails when the lazy settings drawer entry crosses budget', () => {
  withBaselineFixture({
    'generic-shell.css': 320_000,
    'settingsDrawerEntry-abc123.js': 100_001,
    'ModelSection-abc123.js': 340_000,
    'app.js': 64_000,
  }, (root) => {
    const report = buildPerformanceBaselineReport(root)

    assert.deepEqual(
      report.errors.filter((error) => error.metric === 'maxSettingsDrawerEntryChunkBytes'),
      [{ metric: 'maxSettingsDrawerEntryChunkBytes', actual: 100_001, budget: 100_000 }],
    )
    assert.equal(report.summary.ok, false)
  })
})

test('performance baseline fails when a lazy settings section chunk crosses budget', () => {
  withBaselineFixture({
    'generic-shell.css': 320_000,
    'settingsDrawerEntry-abc123.js': 16_000,
    'ModelSectionV3-abc123.js': 390_001,
    'app.js': 64_000,
  }, (root) => {
    const report = buildPerformanceBaselineReport(root)

    assert.deepEqual(
      report.errors.filter((error) => error.metric === 'maxSettingsUiChunkBytes'),
      [{ metric: 'maxSettingsUiChunkBytes', actual: 390_001, budget: 390_000 }],
    )
    assert.equal(report.summary.ok, false)
  })
})

test('performance baseline identifies the exact ConsoleSectionV3 chunk and enforces its max budget', () => {
  withBaselineFixture({
    'generic-shell.css': 320_000,
    'settingsDrawerEntry-abc123.js': 16_000,
    'ConsoleSectionV3-abc123.js': 390_001,
    'app.js': 64_000,
  }, (root) => {
    const report = buildPerformanceBaselineReport(root)

    assert.equal(report.assetMetrics.settingsUiChunksByBase.ConsoleSectionV3.length, 1)
    assert.equal(report.assetMetrics.largestSettingsUiChunk?.fileName, 'ConsoleSectionV3-abc123.js')
    assert.deepEqual(
      report.errors.filter((error) => error.metric === 'maxSettingsUiChunkBytes'),
      [{ metric: 'maxSettingsUiChunkBytes', actual: 390_001, budget: 390_000 }],
    )
    assert.equal(report.summary.ok, false)
  })
})

test('settings-ui cannot hide a missing required V3 section', () => {
  withBaselineFixture({
    'generic-shell.css': 320_000,
    'settingsDrawerEntry-abc123.js': 16_000,
    'app.js': 64_000,
  }, (root) => {
    const report = buildPerformanceBaselineReport(root)

    assert.equal(report.assetMetrics.settingsUiChunksByBase['settings-ui'].length, 1)
    assert.equal(report.assetMetrics.settingsUiChunksByBase.MemorySectionV3.length, 0)
    assert.deepEqual(
      report.errors.filter((error) => error.metric === 'missingSettingsUiChunk'),
      [{ metric: 'missingSettingsUiChunk', actual: 0, budget: 1, chunk: 'MemorySectionV3' }],
    )
    assert.equal(report.summary.ok, false)
  }, { omitSettingsUiBases: ['MemorySectionV3'] })
})

test('near-miss settings filenames are not counted as exact V3 chunks', () => {
  withBaselineFixture({
    'ConsoleSectionV30-abc123.js': 28_919,
    'prefix-ConsoleSectionV3-abc123.js': 28_919,
    'ConsoleSectionV3-abc.css.js': 28_919,
    'ConsoleSectionV3Extra-abc123.js': 28_919,
    'generic-shell.css': 320_000,
    'settingsDrawerEntry-abc123.js': 16_000,
    'app.js': 64_000,
  }, (root) => {
    const report = buildPerformanceBaselineReport(root)

    assert.equal(report.assetMetrics.settingsUiChunks.some((asset) => asset.fileName.startsWith('ConsoleSectionV30')), false)
    assert.equal(report.assetMetrics.settingsUiChunksByBase.ConsoleSectionV3.length, 0)
    assert.equal(report.assetMetrics.settingsUiChunks.some((asset) => asset.fileName.includes('prefix-ConsoleSectionV3')), false)
    assert.equal(report.assetMetrics.settingsUiChunks.some((asset) => asset.fileName.includes('ConsoleSectionV3-abc.css.js')), false)
    assert.equal(report.assetMetrics.settingsUiChunks.some((asset) => asset.fileName.includes('ConsoleSectionV3Extra')), false)
    assert.equal(report.errors.some((error) => error.metric === 'missingSettingsUiChunk' && error.chunk === 'ConsoleSectionV3'), true)
    assert.equal(report.summary.ok, false)
  }, { omitSettingsUiBases: ['ConsoleSectionV3'] })
})

test('performance baseline fails when a required V3 chunk appears more than once', () => {
  withBaselineFixture({
    'MemorySectionV3-def456.js': 1_001,
    'generic-shell.css': 320_000,
    'settingsDrawerEntry-abc123.js': 16_000,
    'app.js': 64_000,
  }, (root) => {
    const report = buildPerformanceBaselineReport(root)

    assert.equal(report.assetMetrics.settingsUiChunksByBase.MemorySectionV3.length, 2)
    assert.deepEqual(
      report.errors.filter((error) => error.metric === 'duplicateSettingsUiChunk'),
      [{ metric: 'duplicateSettingsUiChunk', actual: 2, budget: 1, chunk: 'MemorySectionV3' }],
    )
    assert.equal(report.summary.ok, false)
  })
})

test('performance baseline enforces the total settings UI chunk budget', () => {
  const assets = Object.fromEntries([
    'settings-ui',
    ...REQUIRED_SETTINGS_UI_BASES,
  ].map((base) => [`${base}-abc123.js`, 30_000]))
  assets['SettingsV3Primitives-abc123.js'] = 1_000

  withBaselineFixture({
    ...assets,
    'generic-shell.css': 320_000,
    'settingsDrawerEntry-abc123.js': 16_000,
    'app.js': 64_000,
  }, (root) => {
    const report = buildPerformanceBaselineReport(root)

    assert.equal(report.assetMetrics.settingsUiChunks.length, 14)
    assert.equal(report.assetMetrics.totalSettingsUiChunkBytes, 391_000)
    assert.deepEqual(
      report.errors.filter((error) => error.metric === 'totalSettingsUiChunkBytes'),
      [{ metric: 'totalSettingsUiChunkBytes', actual: 391_000, budget: 390_000 }],
    )
    assert.equal(report.summary.ok, false)
  })
})

test('performance baseline fails when settings drawer lazy assets disappear', () => {
  withBaselineFixture({
    'index-abc123.css': 220_000,
    'app.js': 64_000,
  }, (root) => {
    const report = buildPerformanceBaselineReport(root)

    const missingSettingsErrors = report.errors.filter((error) => error.metric.startsWith('missingSettings'))
    assert.deepEqual(
      missingSettingsErrors.filter((error) => error.metric !== 'missingSettingsUiChunk'),
      [
        { metric: 'missingSettingsDrawerEntryChunk', actual: 0, budget: 1 },
      ],
    )
    assert.equal(missingSettingsErrors.filter((error) => error.metric === 'missingSettingsUiChunk').length, 13)
    assert.deepEqual(
      missingSettingsErrors
        .filter((error) => error.metric === 'missingSettingsUiChunk')
        .map((error) => error.chunk),
      ['settings-ui', ...REQUIRED_SETTINGS_UI_BASES],
    )
    assert.equal(report.summary.ok, false)
  }, { includeCompleteSettings: false })
})

test('performance baseline fails when the build fingerprint is missing', () => {
  withBaselineFixture({
    'generic-shell.css': 320_000,
    'settingsDrawerEntry-abc123.js': 16_000,
    'app.js': 64_000,
  }, (root) => {
    rmSync(join(root, 'dist', 'build-integrity.json'))
    const report = buildPerformanceBaselineReport(root)

    assert.equal(report.buildFreshness.status, 'missing')
    assert.deepEqual(
      report.errors.filter((error) => error.metric === 'missingBuildFingerprint'),
      [{ metric: 'missingBuildFingerprint', actual: 0, budget: 1 }],
    )
    assert.equal(report.summary.ok, false)
  })
})

test('performance baseline rejects changed build inputs but ignores mtime-only changes', () => {
  withBaselineFixture({
    'generic-shell.css': 320_000,
    'settingsDrawerEntry-abc123.js': 16_000,
    'app.js': 64_000,
  }, (root) => {
    const packagePath = join(root, 'package.json')
    const originalPackage = readFileSync(packagePath, 'utf8')
    utimesSync(packagePath, new Date(Date.now() + 60_000), new Date(Date.now() + 60_000))
    const freshReport = buildPerformanceBaselineReport(root)
    assert.equal(freshReport.buildFreshness.ok, true)

    writeFileSync(packagePath, `${originalPackage}\n`)
    const staleReport = buildPerformanceBaselineReport(root)
    assert.equal(staleReport.buildFreshness.status, 'stale')
    assert.deepEqual(
      staleReport.errors.filter((error) => error.metric === 'staleBuildFingerprint'),
      [{ metric: 'staleBuildFingerprint', actual: 1, budget: 0 }],
    )
    assert.equal(staleReport.summary.ok, false)
  })
})

test('build stamp is not eligible after a before/after content fingerprint changes', () => {
  withBaselineFixture({
    'generic-shell.css': 320_000,
    'settingsDrawerEntry-abc123.js': 16_000,
    'app.js': 64_000,
  }, (root) => {
    const before = computeBuildInputFingerprint(root)
    writeFileWithParents(root, 'src/build-input-change.ts', 'export const changed = true\n')
    const after = computeBuildInputFingerprint(root)

    assert.notEqual(before.digest, after.digest)
    assert.equal(shouldWriteBuildIntegrityStamp(before, after), false)
  })
})

test('build lock rejects a concurrent build without touching the first build lock or stamp', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nexus-build-lock-concurrency-'))
  writeFileWithParents(root, 'src/main.ts', 'export const buildInput = true\n')
  const enteredStep = deferred()
  const releaseStep = deferred()
  const runFirstStep = async (step: { name: string }) => {
    if (step.name === 'tsc -b') {
      enteredStep.resolve()
      await releaseStep.promise
    }
  }

  const firstBuild = buildProject(root, { runStep: runFirstStep })
  try {
    await enteredStep.promise
    const lockPath = join(root, BUILD_LOCK_FILE)
    const stampPath = join(root, 'dist', 'build-integrity.json')
    const ownerFilesBefore = readdirSync(lockPath).filter((fileName) => fileName.startsWith('owner-'))
    assert.equal(ownerFilesBefore.length, 1)
    const ownerPath = join(lockPath, ownerFilesBefore[0])
    const lockBefore = readFileSync(ownerPath, 'utf8')
    const lockRecord = JSON.parse(lockBefore) as { token: string; pid: number; createdAt: string }
    assert.equal(typeof lockRecord.token, 'string')
    assert.equal(typeof lockRecord.pid, 'number')
    assert.equal(typeof lockRecord.createdAt, 'string')
    assert.equal(computeBuildInputFingerprint(root).inputPaths.includes(BUILD_LOCK_FILE), false)

    mkdirSync(join(root, 'dist'), { recursive: true })
    writeFileSync(stampPath, '{"owner":"first-build"}\n')
    const stampBefore = readFileSync(stampPath, 'utf8')
    await assert.rejects(
      buildProject(root, { runStep: async () => undefined }),
      /Build already in progress/,
    )
    assert.deepEqual(readdirSync(lockPath), ownerFilesBefore)
    assert.equal(readFileSync(ownerPath, 'utf8'), lockBefore)
    assert.equal(readFileSync(stampPath, 'utf8'), stampBefore)

    releaseStep.resolve()
    const firstStamp = await firstBuild
    assert.equal(firstStamp.schemaVersion, 1)
    assert.equal(existsSync(lockPath), false)
    assert.deepEqual(
      readdirSync(join(root, 'dist')).filter((fileName) => fileName === 'build-integrity.json'),
      ['build-integrity.json'],
    )
    assert.deepEqual(JSON.parse(readFileSync(stampPath, 'utf8')), firstStamp)
  } finally {
    releaseStep.resolve()
    await firstBuild.catch(() => undefined)
    rmSync(root, { recursive: true, force: true })
  }
})

test('build lock retries once when an existing lock disappears before inspection', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nexus-build-lock-release-race-'))
  let mkdirAttempts = 0
  const io = {
    mkdir: async (path: string) => {
      mkdirAttempts += 1
      if (mkdirAttempts === 1) {
        const error = new Error('lock released before inspection') as Error & { code?: string }
        error.code = 'EEXIST'
        throw error
      }
      return mkdirDirectory(path)
    },
    open: openFile,
    readFile: readLockFile,
    readdir: readdirLock,
    rmdir: rmdirDirectory,
    unlink: unlinkFile,
  }

  try {
    const lock = await acquireBuildLock(root, Date.now(), { io })
    assert.equal(mkdirAttempts, 2)
    assert.equal(await releaseBuildLock(lock), true)
    assert.equal(existsSync(join(root, BUILD_LOCK_FILE)), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('dead or invalid build locks are never auto-reclaimed by competing builds', async () => {
  const fixtures = [
    {
      name: 'dead-pid',
      token: 'dead-owner',
      raw: JSON.stringify({ token: 'dead-owner', pid: 999_999_999, createdAt: new Date().toISOString() }),
    },
    {
      name: 'invalid-owner',
      token: 'invalid-owner',
      raw: '{not-json\n',
    },
  ]

  for (const fixture of fixtures) {
    const root = mkdtempSync(join(tmpdir(), `nexus-build-lock-${fixture.name}-`))
    const lockPath = join(root, BUILD_LOCK_FILE)
    const ownerFileName = buildLockOwnerFileName(fixture.token)
    mkdirSync(lockPath, { recursive: true })
    writeFileSync(join(lockPath, ownerFileName), `${fixture.raw}\n`)
    const ownerBefore = readFileSync(join(lockPath, ownerFileName), 'utf8')
    const entriesBefore = readdirSync(lockPath)

    try {
      const failures = await Promise.all([
        acquireBuildLock(root).then(() => null, (error: unknown) => error),
        acquireBuildLock(root).then(() => null, (error: unknown) => error),
      ])
      for (const failure of failures) {
        assert.ok(failure instanceof Error)
        assert.match(failure.message, /Stale build lock/)
      }
      assert.equal(existsSync(lockPath), true)
      assert.deepEqual(readdirSync(lockPath), entriesBefore)
      assert.equal(readFileSync(join(lockPath, ownerFileName), 'utf8'), ownerBefore)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
})

test('release refuses to remove a later-owner directory before its sentinel unlink', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nexus-build-lock-later-owner-'))
  const lock = await acquireBuildLock(root)
  const lockPath = join(root, BUILD_LOCK_FILE)
  const oldOwnerPath = join(lockPath, buildLockOwnerFileName(lock.token))
  const laterToken = 'later-owner'
  const laterOwnerPath = join(lockPath, buildLockOwnerFileName(laterToken))
  let replaced = false
  let rmdirCalls = 0
  const io = {
    open: openFile,
    readFile: readLockFile,
    readdir: readdirLock,
    rmdir: async (path: string) => {
      rmdirCalls += 1
      return rmdirDirectory(path)
    },
    unlink: async (path: string) => {
      if (!replaced && path === oldOwnerPath) {
        replaced = true
        rmSync(lockPath, { recursive: true, force: true })
        mkdirSync(lockPath)
        writeFileSync(laterOwnerPath, `${JSON.stringify({
          token: laterToken,
          pid: process.pid,
          createdAt: new Date().toISOString(),
        })}\n`)
      }
      return unlinkFile(path)
    },
  }

  try {
    assert.equal(await releaseBuildLock(lock, io), false)
    assert.equal(rmdirCalls, 0)
    assert.equal(existsSync(lockPath), true)
    assert.equal(existsSync(laterOwnerPath), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('release leaves a later-owner directory when replacement happens before rmdir', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nexus-build-lock-rmdir-race-'))
  const lock = await acquireBuildLock(root)
  const lockPath = join(root, BUILD_LOCK_FILE)
  const laterToken = 'later-owner'
  const laterOwnerPath = join(lockPath, buildLockOwnerFileName(laterToken))
  let rmdirCalls = 0
  const io = {
    open: openFile,
    readFile: readLockFile,
    readdir: readdirLock,
    rmdir: async (path: string) => {
      rmdirCalls += 1
      rmSync(lockPath, { recursive: true, force: true })
      mkdirSync(lockPath)
      writeFileSync(laterOwnerPath, `${JSON.stringify({
        token: laterToken,
        pid: process.pid,
        createdAt: new Date().toISOString(),
      })}\n`)
      return rmdirDirectory(path)
    },
    unlink: unlinkFile,
  }

  try {
    assert.equal(await releaseBuildLock(lock, io), false)
    assert.equal(rmdirCalls, 1)
    assert.equal(existsSync(lockPath), true)
    assert.equal(existsSync(laterOwnerPath), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('owner write and close failures clean their own empty lock directory', async () => {
  for (const failureMode of ['write', 'close'] as const) {
    const root = mkdtempSync(join(tmpdir(), `nexus-build-lock-owner-${failureMode}-`))
    const events: string[] = []
    const failure = new Error(`controlled owner ${failureMode} failure`)
    const io = {
      mkdir: mkdirDirectory,
      open: async () => ({
        writeFile: async () => {
          events.push('write')
          if (failureMode === 'write') throw failure
        },
        close: async () => {
          events.push('close')
          if (failureMode === 'close') throw failure
        },
      }),
      readFile: readLockFile,
      readdir: readdirLock,
      rmdir: async (path: string) => {
        events.push('rmdir')
        return rmdirDirectory(path)
      },
      unlink: async (path: string) => {
        events.push('unlink')
        try {
          return await unlinkFile(path)
        } catch (error) {
          if (error?.code === 'ENOENT') return undefined
          throw error
        }
      },
    }

    try {
      await assert.rejects(
        acquireBuildLock(root, Date.now(), { io }),
        (error: unknown) => error === failure,
      )
      assert.equal(existsSync(join(root, BUILD_LOCK_FILE)), false)
      assert.ok(events.indexOf('close') < events.indexOf('unlink'))
      assert.ok(events.includes('rmdir'))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
})

test('failed build removes its stamp, releases the lock, and allows the next build', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nexus-build-lock-failure-'))
  writeFileWithParents(root, 'src/main.ts', 'export const buildInput = true\n')
  try {
    await assert.rejects(
      buildProject(root, {
        runStep: async () => {
          throw new Error('controlled build step failure')
        },
      }),
      /controlled build step failure/,
    )
    assert.equal(existsSync(join(root, 'dist', 'build-integrity.json')), false)
    assert.equal(existsSync(join(root, BUILD_LOCK_FILE)), false)

    const stamp = await buildProject(root, { runStep: async () => undefined })
    assert.equal(stamp.schemaVersion, 1)
    assert.equal(existsSync(join(root, 'dist', 'build-integrity.json')), true)
    assert.equal(existsSync(join(root, BUILD_LOCK_FILE)), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('release failure removes the stamp and fails the build command', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nexus-build-lock-release-failure-'))
  writeFileWithParents(root, 'src/main.ts', 'export const buildInput = true\n')
  const releaseFailure = new Error('controlled release failure')
  const lockIo = {
    mkdir: mkdirDirectory,
    open: openFile,
    readFile: readLockFile,
    readdir: readdirLock,
    rmdir: async () => {
      throw releaseFailure
    },
    unlink: unlinkFile,
  }

  try {
    await assert.rejects(
      buildProject(root, { runStep: async () => undefined, lockIo }),
      (error: unknown) => error === releaseFailure,
    )
    assert.equal(existsSync(join(root, 'dist', 'build-integrity.json')), false)
    assert.equal(existsSync(join(root, BUILD_LOCK_FILE)), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
