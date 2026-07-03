import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { buildArchitectureBoundaryReport } from '../scripts/architecture-boundary-audit.mjs'

function writeFileWithParents(root: string, relativePath: string, content: string) {
  const absolutePath = join(root, relativePath)
  mkdirSync(join(absolutePath, '..'), { recursive: true })
  writeFileSync(absolutePath, content)
}

function createArchitectureFixture(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'nexus-architecture-boundary-audit-'))
  for (const [relativePath, content] of Object.entries(files)) {
    writeFileWithParents(root, relativePath, content)
  }
  return root
}

function withArchitectureFixture<T>(files: Record<string, string>, callback: (root: string) => T): T {
  const root = createArchitectureFixture(files)
  try {
    return callback(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('architecture boundary audit passes allowed downward imports', () => {
  withArchitectureFixture({
    'src/app/App.tsx': "import { helper } from '../lib/helper'\nexport const app = helper\n",
    'src/components/Card.tsx': "import { helper } from '../lib/helper'\nexport const card = helper\n",
    'src/features/chat/runtime.ts': "import { helper } from '../../lib/helper'\nexport const runtime = helper\n",
    'src/lib/helper.ts': 'export const helper = true\n',
  }, (root) => {
    const report = buildArchitectureBoundaryReport(root)

    assert.equal(report.summary.ok, true)
    assert.equal(report.summary.errors, 0)
    assert.equal(report.privacy.staticSourceOnly, true)
    assert.equal(report.privacy.readsStoredValues, false)
  })
})

test('architecture boundary audit rejects shared lib imports from app composition', () => {
  withArchitectureFixture({
    'src/app/App.tsx': 'export const app = true\n',
    'src/lib/helper.ts': "import { app } from '../app/App'\nexport const helper = app\n",
  }, (root) => {
    const report = buildArchitectureBoundaryReport(root)

    assert.equal(report.summary.ok, false)
    assert.deepEqual(report.errors.layerViolations, [
      {
        file: 'src/lib/helper.ts',
        imports: 'src/app/App.tsx',
        fromLayer: 'lib',
        toLayer: 'app',
        reason: 'shared library code must not depend on UI/app composition',
      },
    ])
  })
})

test('architecture boundary audit rejects feature imports from app composition', () => {
  withArchitectureFixture({
    'src/app/App.tsx': 'export const app = true\n',
    'src/features/chat/runtime.ts': "import { app } from '../../app/App'\nexport const runtime = app\n",
  }, (root) => {
    const report = buildArchitectureBoundaryReport(root)

    assert.equal(report.summary.ok, false)
    assert.deepEqual(report.errors.layerViolations, [
      {
        file: 'src/features/chat/runtime.ts',
        imports: 'src/app/App.tsx',
        fromLayer: 'features',
        toLayer: 'app',
        reason: 'feature modules must stay reusable below app composition',
      },
    ])
  })
})
