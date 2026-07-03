import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { buildHeavyModuleAuditReport } from '../scripts/heavy-module-audit.mjs'

const LAZY_FILES: Record<string, string> = {
  'src/features/memory/vectorSearchRuntime.ts': "export const load = () => import('@huggingface/transformers')\n",
  'src/features/hearing/browserVad.ts': "export const load = () => import('@ricky0123/vad-web')\n",
  'src/features/vision/ocrWorker.ts': "export const load = () => import('tesseract.js')\n",
  'src/features/pet/components/live2d/vendor.ts': 'export function ensureLive2DVendorScripts() {}\n',
}

const PACKAGE_EXCLUSIONS = [
  '!**/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.*',
  '!**/onnxruntime-web/dist/ort-wasm-simd-threaded.jspi.*',
  '!**/onnxruntime-web/dist/ort.training.wasm.min.*',
  '!**/onnxruntime-web/dist/ort.webgl.*',
  '!**/onnxruntime-web/dist/ort.webgpu.*',
]

function writeFileWithParents(root: string, relativePath: string, content: string) {
  const absolutePath = join(root, relativePath)
  mkdirSync(join(absolutePath, '..'), { recursive: true })
  writeFileSync(absolutePath, content)
}

function createHeavyModuleFixture(
  files: Record<string, string> = {},
  packageExclusions = PACKAGE_EXCLUSIONS,
) {
  const root = mkdtempSync(join(tmpdir(), 'nexus-heavy-module-audit-'))

  for (const [relativePath, content] of Object.entries({ ...LAZY_FILES, ...files })) {
    writeFileWithParents(root, relativePath, content)
  }

  writeFileSync(join(root, 'package.json'), JSON.stringify({
    build: {
      files: packageExclusions,
    },
  }))

  return root
}

function withHeavyModuleFixture<T>(
  files: Record<string, string>,
  callback: (root: string) => T,
  packageExclusions = PACKAGE_EXCLUSIONS,
): T {
  const root = createHeavyModuleFixture(files, packageExclusions)
  try {
    return callback(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('heavy module audit passes a minimal lazy-loaded fixture', () => {
  withHeavyModuleFixture({}, (root) => {
    const report = buildHeavyModuleAuditReport(root)

    assert.equal(report.summary.ok, true)
    assert.equal(report.summary.errors, 0)
    assert.equal(report.privacy.staticSourceOnly, true)
    assert.equal(report.privacy.readsUserStorage, false)
  })
})

test('heavy module audit rejects static renderer imports of heavy modules', () => {
  withHeavyModuleFixture({
    'src/features/memory/staticImportRegression.ts': "import { pipeline } from '@huggingface/transformers'\nexport const bad = pipeline\n",
  }, (root) => {
    const report = buildHeavyModuleAuditReport(root)

    assert.equal(report.summary.ok, false)
    assert.deepEqual(report.errors.staticRendererImports, [
      {
        file: 'src/features/memory/staticImportRegression.ts',
        module: '@huggingface/transformers',
      },
    ])
  })
})

test('heavy module audit rejects missing unused ORT packaging exclusions', () => {
  withHeavyModuleFixture({}, (root) => {
    const report = buildHeavyModuleAuditReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.errors.missingPackagingExclusions.includes('ort.webgpu'))
  }, PACKAGE_EXCLUSIONS.filter((item) => !item.includes('ort.webgpu')))
})
