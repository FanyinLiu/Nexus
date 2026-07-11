import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { buildPerformanceBaselineReport } from '../scripts/performance-baseline.mjs'

const REQUIRED_LAZY_FILES = {
  'src/features/memory/vectorSearchRuntime.ts': "export const load = () => import('@huggingface/transformers')\n",
  'src/features/hearing/browserVad.ts': "export const load = () => import('@ricky0123/vad-web')\n",
  'src/features/vision/ocrWorker.ts': "export const load = () => import('tesseract.js')\n",
  'src/features/pet/components/live2d/vendor.ts': 'export function ensureLive2DVendorScripts() {}\n',
}

function writeBytes(path: string, bytes: number) {
  writeFileSync(path, Buffer.alloc(bytes, 97))
}

function writeFileWithParents(root: string, relativePath: string, content: string) {
  const absolutePath = join(root, relativePath)
  mkdirSync(join(absolutePath, '..'), { recursive: true })
  writeFileSync(absolutePath, content)
}

function createBaselineFixture(assets: Record<string, number>) {
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

  for (const [fileName, bytes] of Object.entries(assets)) {
    writeBytes(join(root, 'dist', 'assets', fileName), bytes)
  }

  return root
}

function withBaselineFixture<T>(assets: Record<string, number>, callback: (root: string) => T): T {
  const root = createBaselineFixture(assets)
  try {
    return callback(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('performance baseline reports the largest CSS chunk without failing under budget', () => {
  withBaselineFixture({
    'index-abc123.css': 220_000,
    'settingsDrawerEntry-abc123.css': 320_000,
    'settingsDrawerEntry-abc123.js': 16_000,
    'settings-ui-abc123.js': 340_000,
    'app.js': 64_000,
  }, (root) => {
    const report = buildPerformanceBaselineReport(root)

    assert.equal(report.assetMetrics.largestCssChunk?.fileName, 'settingsDrawerEntry-abc123.css')
    assert.equal(report.assetMetrics.largestCssChunk?.bytes, 320_000)
    assert.equal(report.assetMetrics.initialCssChunk?.bytes, 220_000)
    assert.equal(report.assetMetrics.settingsDrawerCssChunk?.bytes, 320_000)
    assert.equal(report.assetMetrics.settingsUiChunk?.bytes, 340_000)
    assert.equal(report.assetMetrics.totals.totalCssBytes, 540_000)
    assert.equal(report.summary.ok, true)
  })
})

test('performance baseline fails when a single CSS chunk crosses the budget', () => {
  withBaselineFixture({
    'index-abc123.css': 220_000,
    'settingsDrawerEntry-abc123.css': 480_001,
    'settingsDrawerEntry-abc123.js': 16_000,
    'ModelSection-abc123.js': 340_000,
    'app.js': 64_000,
  }, (root) => {
    const report = buildPerformanceBaselineReport(root)

    assert.equal(report.assetMetrics.largestCssChunk?.fileName, 'settingsDrawerEntry-abc123.css')
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
    'settingsDrawerEntry-abc123.css': 320_000,
    'settings-extra.css': 1,
    'settingsDrawerEntry-abc123.js': 16_000,
    'ModelSection-abc123.js': 340_000,
    'app.js': 64_000,
  }, (root) => {
    const report = buildPerformanceBaselineReport(root)

    assert.deepEqual(
      report.errors.filter((error) => error.metric === 'totalCssBytes'),
      [{ metric: 'totalCssBytes', actual: 760_001, budget: 760_000 }],
    )
    assert.equal(report.summary.ok, false)
  })
})

test('performance baseline warns when CSS budget headroom is nearly exhausted', () => {
  withBaselineFixture({
    'index-abc123.css': 250_000,
    'settingsDrawerEntry-abc123.css': 440_000,
    'settingsDrawerEntry-abc123.js': 16_000,
    'ModelSection-abc123.js': 340_000,
    'app.js': 64_000,
  }, (root) => {
    const report = buildPerformanceBaselineReport(root)

    assert.equal(report.summary.ok, true)
    assert.deepEqual(
      report.warnings.map((warning) => warning.metric),
      ['totalCssBytes', 'maxCssChunkBytes', 'maxSettingsDrawerCssChunkBytes'],
    )
    assert.equal(report.summary.warnings, 3)
  })
})

test('performance baseline fails when initial CSS crosses the startup budget', () => {
  withBaselineFixture({
    'index-abc123.css': 450_001,
    'settingsDrawerEntry-abc123.css': 320_000,
    'settingsDrawerEntry-abc123.js': 16_000,
    'ModelSection-abc123.js': 340_000,
    'app.js': 64_000,
  }, (root) => {
    const report = buildPerformanceBaselineReport(root)

    assert.deepEqual(
      report.errors.filter((error) => error.metric === 'maxInitialCssChunkBytes'),
      [{ metric: 'maxInitialCssChunkBytes', actual: 450_001, budget: 450_000 }],
    )
    assert.equal(report.summary.ok, false)
  })
})

test('performance baseline fails when settings lazy CSS crosses budget', () => {
  withBaselineFixture({
    'index-abc123.css': 220_000,
    'settingsDrawerEntry-abc123.css': 480_001,
    'settingsDrawerEntry-abc123.js': 16_000,
    'ModelSection-abc123.js': 340_000,
    'app.js': 64_000,
  }, (root) => {
    const report = buildPerformanceBaselineReport(root)

    assert.deepEqual(
      report.errors.filter((error) => error.metric === 'maxSettingsDrawerCssChunkBytes'),
      [{ metric: 'maxSettingsDrawerCssChunkBytes', actual: 480_001, budget: 480_000 }],
    )
    assert.equal(report.summary.ok, false)
  })
})

test('performance baseline tracks the lazy settings drawer entry budget', () => {
  withBaselineFixture({
    'settingsDrawerEntry-abc123.css': 320_000,
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
    'settingsDrawerEntry-abc123.css': 320_000,
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
    'settingsDrawerEntry-abc123.css': 320_000,
    'settingsDrawerEntry-abc123.js': 16_000,
    'ModelSection-abc123.js': 390_001,
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

test('performance baseline fails when settings drawer lazy assets disappear', () => {
  withBaselineFixture({
    'index-abc123.css': 220_000,
    'app.js': 64_000,
  }, (root) => {
    const report = buildPerformanceBaselineReport(root)

    assert.deepEqual(
      report.errors.filter((error) => error.metric.startsWith('missingSettings')),
      [
        { metric: 'missingSettingsDrawerCssChunk', actual: 0, budget: 1 },
        { metric: 'missingSettingsDrawerEntryChunk', actual: 0, budget: 1 },
        { metric: 'missingSettingsUiChunk', actual: 0, budget: 1 },
      ],
    )
    assert.equal(report.summary.ok, false)
  })
})
