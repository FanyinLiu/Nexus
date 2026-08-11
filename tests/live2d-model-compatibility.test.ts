import assert from 'node:assert/strict'
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  inspectLive2dModelFile,
} from '../electron/services/live2dModelCompatibility.js'

function createModelFixture(modelFile: Record<string, unknown>, files: string[] = []) {
  const root = mkdtempSync(join(tmpdir(), 'nexus-live2d-compatibility-'))
  const modelPath = join(root, 'Example.model3.json')
  writeFileSync(modelPath, `${JSON.stringify(modelFile, null, 2)}\n`, 'utf8')

  for (const relativePath of files) {
    const targetPath = join(root, relativePath)
    mkdirSync(join(targetPath, '..'), { recursive: true })
    writeFileSync(targetPath, 'fixture', 'utf8')
  }

  return {
    modelPath,
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}

test('Live2D compatibility inspection accepts a complete local Cubism model', async () => {
  const fixture = createModelFixture({
    Version: 3,
    FileReferences: {
      Moc: 'Example.moc3',
      Textures: ['textures/texture_00.png'],
      Physics: 'Example.physics3.json',
      Expressions: [{ Name: 'smile', File: 'expressions/smile.exp3.json' }],
      Motions: {
        Idle: [{ File: 'motions/idle.motion3.json' }],
      },
    },
  }, [
    'Example.moc3',
    'textures/texture_00.png',
    'Example.physics3.json',
    'expressions/smile.exp3.json',
    'motions/idle.motion3.json',
  ])

  try {
    const inspection = await inspectLive2dModelFile(fixture.modelPath)
    assert.equal(inspection.compatibility.status, 'ready')
    assert.deepEqual(inspection.compatibility.errors, [])
    assert.deepEqual(inspection.compatibility.warnings, [])
    assert.deepEqual(inspection.compatibility.summary, {
      textureCount: 1,
      motionCount: 1,
      expressionCount: 1,
      missingMocCount: 0,
      missingTextureCount: 0,
      missingMotionCount: 0,
      missingExpressionCount: 0,
      missingOptionalCount: 0,
      unsafeResourceCount: 0,
    })
    assert.equal(inspection.modelFile?.Version, 3)
  } finally {
    fixture.cleanup()
  }
})

test('Live2D compatibility inspection keeps renderable models with limited interactions', async () => {
  const fixture = createModelFixture({
    Version: 3,
    FileReferences: {
      Moc: 'Example.moc3',
      Textures: ['texture.png'],
    },
  }, ['Example.moc3', 'texture.png'])

  try {
    const inspection = await inspectLive2dModelFile(fixture.modelPath)
    assert.equal(inspection.compatibility.status, 'limited')
    assert.deepEqual(inspection.compatibility.errors, [])
    assert.deepEqual(inspection.compatibility.warnings, ['no-motions', 'no-expressions'])
    assert.ok(inspection.modelFile)
  } finally {
    fixture.cleanup()
  }
})

test('Live2D compatibility inspection blocks missing declared resources before activation', async () => {
  const fixture = createModelFixture({
    Version: 3,
    FileReferences: {
      Moc: 'missing.moc3',
      Textures: ['missing.png'],
      Physics: 'missing.physics3.json',
      Expressions: [{ Name: 'smile', File: 'missing.exp3.json' }],
      Motions: {
        Idle: [{ File: 'missing.motion3.json' }],
      },
    },
  })

  try {
    const inspection = await inspectLive2dModelFile(fixture.modelPath)
    assert.equal(inspection.compatibility.status, 'blocked')
    assert.deepEqual(new Set(inspection.compatibility.errors), new Set([
      'missing-moc',
      'missing-texture',
      'missing-motion',
      'missing-expression',
      'missing-optional-resource',
    ]))
    assert.deepEqual(inspection.compatibility.summary, {
      textureCount: 1,
      motionCount: 1,
      expressionCount: 1,
      missingMocCount: 1,
      missingTextureCount: 1,
      missingMotionCount: 1,
      missingExpressionCount: 1,
      missingOptionalCount: 1,
      unsafeResourceCount: 0,
    })
  } finally {
    fixture.cleanup()
  }
})

test('Live2D compatibility inspection blocks malformed motion and expression declarations', async () => {
  const fixture = createModelFixture({
    Version: 3,
    FileReferences: {
      Moc: 'Example.moc3',
      Textures: ['texture.png'],
      Motions: { Idle: 'idle.motion3.json' },
      Expressions: { smile: 'smile.exp3.json' },
    },
  }, ['Example.moc3', 'texture.png'])

  try {
    const inspection = await inspectLive2dModelFile(fixture.modelPath)
    assert.equal(inspection.compatibility.status, 'blocked')
    assert.deepEqual(inspection.compatibility.errors, ['invalid-model-file'])
    assert.deepEqual(inspection.compatibility.warnings, ['no-motions', 'no-expressions'])
  } finally {
    fixture.cleanup()
  }
})

test('Live2D compatibility inspection rejects resources outside the model folder', async () => {
  const fixture = createModelFixture({
    Version: 3,
    FileReferences: {
      Moc: '../outside.moc3',
      Textures: ['/tmp/outside.png'],
    },
  })

  try {
    const inspection = await inspectLive2dModelFile(fixture.modelPath)
    assert.equal(inspection.compatibility.status, 'blocked')
    assert.deepEqual(inspection.compatibility.errors, ['unsafe-resource-path'])
    assert.equal(inspection.compatibility.summary.unsafeResourceCount, 2)
    assert.ok(!JSON.stringify(inspection.compatibility).includes('outside'))
  } finally {
    fixture.cleanup()
  }
})

test('Live2D compatibility inspection rejects URI resources without exposing them', async () => {
  const fixture = createModelFixture({
    Version: 3,
    FileReferences: {
      Moc: 'file:///private/avatar.moc3',
      Textures: ['https://private.example/texture.png'],
    },
  })

  try {
    const inspection = await inspectLive2dModelFile(fixture.modelPath)
    assert.equal(inspection.compatibility.status, 'blocked')
    assert.deepEqual(inspection.compatibility.errors, ['unsafe-resource-path'])
    assert.equal(inspection.compatibility.summary.unsafeResourceCount, 2)
    const serialized = JSON.stringify(inspection.compatibility)
    assert.ok(!serialized.includes('private'))
    assert.ok(!serialized.includes('example'))
  } finally {
    fixture.cleanup()
  }
})
