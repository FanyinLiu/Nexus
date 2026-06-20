#!/usr/bin/env node

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const HEAVY_RENDERER_MODULES = [
  '@huggingface/transformers',
  '@ricky0123/vad-web',
  'onnxruntime-web',
  'pixi-live2d-display',
  'pixi.js',
  'tesseract.js',
]

const REQUIRED_LAZY_PATTERNS = [
  {
    file: 'src/features/memory/vectorSearchRuntime.ts',
    pattern: "import('@huggingface/transformers')",
    reason: 'memory embeddings load only when vector recall is used',
  },
  {
    file: 'src/features/hearing/browserVad.ts',
    pattern: "import('@ricky0123/vad-web')",
    reason: 'browser VAD loads only when voice activity detection starts',
  },
  {
    file: 'src/features/vision/ocrWorker.ts',
    pattern: "import('tesseract.js')",
    reason: 'OCR worker loads only when screen OCR is requested',
  },
  {
    file: 'src/features/pet/components/live2d/vendor.ts',
    pattern: 'ensureLive2DVendorScripts',
    reason: 'Live2D runtime is loaded through vendor scripts on demand',
  },
]

function walkFiles(root, directory, predicate) {
  const base = join(root, directory)
  const files = []
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    const fullPath = join(base, entry.name)
    const rel = relative(root, fullPath)
    if (entry.isDirectory()) {
      files.push(...walkFiles(root, rel, predicate))
    } else if (entry.isFile() && predicate(rel)) {
      files.push(rel)
    }
  }
  return files
}

function stripTypeOnlyImports(source) {
  return source
    .replace(/import\s+type\s+[^;]+from\s+['"][^'"]+['"];?/g, '')
    .replace(/type\s+\w+\s*=\s*typeof\s+import\(['"][^'"]+['"]\)/g, '')
    .replace(/type\s+\w+\s*=\s*import\(['"][^'"]+['"]\)\.[A-Za-z0-9_$]+/g, '')
}

function findStaticHeavyImports(root = ROOT) {
  const files = walkFiles(root, 'src', (file) => /\.(ts|tsx)$/.test(file))
  const violations = []

  for (const file of files) {
    const source = stripTypeOnlyImports(readFileSync(join(root, file), 'utf8'))
    for (const moduleName of HEAVY_RENDERER_MODULES) {
      const staticImport = new RegExp(`import\\s+(?!\\()[^\\n;]*['"]${moduleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`)
      if (staticImport.test(source)) {
        violations.push({ file, module: moduleName })
      }
    }
  }

  return violations
}

export function buildHeavyModuleAuditReport(root = ROOT) {
  const staticRendererImports = findStaticHeavyImports(root)
  const missingLazyPatterns = REQUIRED_LAZY_PATTERNS
    .filter((item) => !readFileSync(join(root, item.file), 'utf8').includes(item.pattern))
    .map(({ file, pattern, reason }) => ({ file, pattern, reason }))

  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const packageText = JSON.stringify(packageJson, null, 2)
  const missingPackagingExclusions = [
    'ort-wasm-simd-threaded.asyncify',
    'ort-wasm-simd-threaded.jspi',
    'ort.training.wasm.min',
    'ort.webgl',
    'ort.webgpu',
  ].filter((needle) => !packageText.includes(needle))

  const errors = {
    staticRendererImports,
    missingLazyPatterns,
    missingPackagingExclusions,
  }
  const errorCount = Object.values(errors).reduce((sum, list) => sum + list.length, 0)

  return {
    heavyRendererModules: HEAVY_RENDERER_MODULES,
    checkedLazyPatterns: REQUIRED_LAZY_PATTERNS.length,
    errors,
    summary: {
      ok: errorCount === 0,
      errors: errorCount,
    },
    privacy: {
      readsUserStorage: false,
      staticSourceOnly: true,
    },
  }
}

function formatHumanReport(report) {
  const lines = ['Heavy module audit']
  lines.push(`- renderer heavy modules: ${report.heavyRendererModules.join(', ')}`)
  lines.push(`- lazy-load patterns checked: ${report.checkedLazyPatterns}`)
  lines.push('')
  for (const [name, items] of Object.entries(report.errors)) {
    lines.push(`ERROR ${name}: ${items.length}`)
    if (items.length) {
      lines.push(`  ${items.slice(0, 8).map((item) => item.file ?? item).join(', ')}`)
    }
  }
  lines.push('')
  lines.push(`Summary: ok=${report.summary.ok} errors=${report.summary.errors}`)
  return lines.join('\n')
}

function main(argv) {
  const report = buildHeavyModuleAuditReport(ROOT)
  const json = argv.includes('--json') || argv.includes('--format=json')
  process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : `${formatHumanReport(report)}\n`)
  if (!report.summary.ok) process.exit(1)
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null
if (invokedPath && resolve(fileURLToPath(import.meta.url)) === invokedPath) {
  main(process.argv.slice(2))
}
