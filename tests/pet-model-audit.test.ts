import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  petModelActionNeedsConfirmation,
  summarizePetModelRequest,
  summarizePetModelResult,
} from '../electron/ipc/petModelAudit.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function readSource(relativePath: string) {
  return readFileSync(join(ROOT, relativePath), 'utf8')
}

test('pet model audit summaries exclude paths urls slugs and model content', () => {
  const request = summarizePetModelRequest(
    'pet-model:import',
    'https://example.invalid/private-pet?token=secret',
  )
  assert.deepEqual(request, {
    channel: 'pet-model:import',
    dialogBacked: true,
  })

  const result = summarizePetModelResult('pet-model:import', {
    model: { id: 'private-model', label: 'Private Model' },
    message: 'Imported Private Model',
    packageDirectory: '/Users/me/Documents/private-kit/final-package',
    packageDirectoryDisplay: 'Documents/Nexus Pet Creator Kits/final-package',
    manifestPath: '/Users/me/Documents/private-kit/final-package/pet.json',
    manifestPathDisplay: 'Documents/Nexus Pet Creator Kits/final-package/pet.json',
    visualAuditPath: '/Users/me/Documents/private-kit/final-package/qa/audit.json',
    visualAuditPathDisplay: 'Documents/Nexus Pet Creator Kits/final-package/qa/audit.json',
    archivePath: '/Users/me/Documents/private-kit/final-package/private.zip',
    archivePathDisplay: 'Documents/Nexus Pet Creator Kits/final-package/private.zip',
  })

  assert.equal(result.modelPresent, true)
  assert.equal(result.messageLength, 22)
  assert.equal(result.packageDirectoryLength, 45)
  assert.equal(result.manifestPathLength, 54)
  assert.equal(result.visualAuditPathLength, 59)
  assert.equal(result.archivePathLength, 57)

  const serialized = JSON.stringify({ request, result })
  for (const privateValue of [
    'example.invalid',
    'private-pet',
    'token=secret',
    '/Users/me/Documents/private-kit',
    'Documents/Nexus Pet Creator Kits/final-package',
    'private-model',
    'Private Model',
    'Imported Private Model',
    'private.zip',
  ]) {
    assert.ok(!serialized.includes(privateValue), `${privateValue} should not be logged`)
  }
})

test('pet model import keeps display-path redaction and does not embed raw artifact paths', () => {
  const pathSource = readSource('electron/services/petModelPaths.js')
  const serviceSource = readSource('electron/services/petModelService.js')

  assert.match(pathSource, /USER_DATA_DISPLAY_ROOT = 'app-user-data'/)
  assert.match(pathSource, /export function getPetArtifactDisplayPath\(targetPath\)/)
  assert.match(pathSource, /return `\.\.\.\/\$\{path\.basename\(resolvedTarget\) \|\| 'path'\}`/)

  assert.doesNotMatch(serviceSource, /制作包输出：\$\{assembled\.packageDirectory\}/)
  assert.doesNotMatch(serviceSource, /可分享 ZIP：\$\{archivePath\}/)
  assert.doesNotMatch(serviceSource, /已打开制作包文件夹：\$\{targetRealPath\}/)
  assert.doesNotMatch(serviceSource, /已打开制作包文件：\$\{targetRealPath\}/)
})

test('pet model error summaries omit private error messages', () => {
  const summary = summarizePetModelResult(
    'pet-model:import',
    {},
    new Error('failed to open /Users/me/private-kit/pet.json'),
  )

  assert.equal(summary.ok, false)
  assert.equal(summary.errorName, 'Error')
  assert.equal(summary.errorMessageLength, 45)
  assert.ok(!JSON.stringify(summary).includes('/Users/me/private-kit/pet.json'))
})

test('pet model import is dialog-backed and does not ask for a second confirmation', () => {
  assert.equal(petModelActionNeedsConfirmation('pet-model:import'), false)
})
