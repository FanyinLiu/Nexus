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
  const gallery = summarizePetModelRequest(
    'pet-model:import-codex-gallery',
    'https://codex-pet.example/private-pet?token=secret',
  )
  assert.deepEqual(gallery, {
    channel: 'pet-model:import-codex-gallery',
    inputLength: 50,
    looksLikeUrl: true,
  })

  const install = summarizePetModelRequest('pet-model:install-creator-kit-codex', {
    kitDirectory: '/Users/me/Documents/private-kit',
    manifestPath: '/Users/me/Documents/private-kit/pet.json',
  })
  assert.deepEqual(install, {
    channel: 'pet-model:install-creator-kit-codex',
    kitDirectory: {
      present: true,
      length: 31,
    },
    manifestPath: {
      present: true,
      length: 40,
    },
  })

  const result = summarizePetModelResult('pet-model:assemble-creator-kit', {
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

  const serialized = JSON.stringify({ gallery, install, result })
  for (const privateValue of [
    'codex-pet.example',
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

test('pet model creator-kit UI renders display paths instead of raw artifact paths', () => {
  const pathSource = readSource('electron/services/petModelPaths.js')
  const serviceSource = readSource('electron/services/petModelService.js')
  const chatSectionSource = readSource('src/components/settingsSections/ChatSection.tsx')
  const creatorPanelSource = readSource('src/components/settingsSections/chat/SpriteCreatorKitPanel.tsx')

  assert.match(pathSource, /USER_DATA_DISPLAY_ROOT = 'app-user-data'/)
  assert.match(pathSource, /CODEX_HOME_DISPLAY_ROOT = 'codex-home'/)
  assert.match(pathSource, /return `\.\.\.\/\$\{path\.basename\(resolvedTarget\) \|\| 'path'\}`/)

  assert.match(serviceSource, /getPetArtifactDisplayPath/)
  assert.match(serviceSource, /packageDirectoryDisplay/)
  assert.match(serviceSource, /archivePathDisplay/)
  assert.doesNotMatch(serviceSource, /制作包输出：\$\{assembled\.packageDirectory\}/)
  assert.doesNotMatch(serviceSource, /可分享 ZIP：\$\{archivePath\}/)
  assert.doesNotMatch(serviceSource, /已打开制作包文件夹：\$\{targetRealPath\}/)
  assert.doesNotMatch(serviceSource, /已打开制作包文件：\$\{targetRealPath\}/)

  assert.match(
    chatSectionSource,
    /generatedSpritePetPackage\.packageDirectoryDisplay \?\? generatedSpritePetPackage\.packageDirectory/,
  )
  assert.match(
    chatSectionSource,
    /generatedSpritePetPackage\.archivePathDisplay \?\? generatedSpritePetPackage\.archivePath/,
  )
  assert.match(
    creatorPanelSource,
    /lastCreatorKitDirectoryDisplay \|\| lastCreatorKitDirectory/,
  )
  assert.match(
    creatorPanelSource,
    /assembledCreatorKitPackage\.packageDirectoryDisplay \?\? assembledCreatorKitPackage\.packageDirectory/,
  )
  assert.match(
    creatorPanelSource,
    /creatorKitInspection\.contactSheetPathDisplay \?\? creatorKitInspection\.contactSheetPath/,
  )
})

test('pet model error summaries omit private error messages', () => {
  const summary = summarizePetModelResult(
    'pet-model:open-creator-kit-path',
    {},
    new Error('failed to open /Users/me/private-kit/pet.json'),
  )

  assert.equal(summary.ok, false)
  assert.equal(summary.errorName, 'Error')
  assert.equal(summary.errorMessageLength, 45)
  assert.ok(!JSON.stringify(summary).includes('/Users/me/private-kit/pet.json'))
})

test('pet model confirmation policy distinguishes dialog-backed and direct actions', () => {
  assert.equal(petModelActionNeedsConfirmation('pet-model:import', {}), false)
  assert.equal(petModelActionNeedsConfirmation('pet-model:create-from-image', {}), false)
  assert.equal(petModelActionNeedsConfirmation('pet-model:inspect-creator-kit', {}), false)
  assert.equal(
    petModelActionNeedsConfirmation('pet-model:inspect-creator-kit', { kitDirectory: '/tmp/private-kit' }),
    true,
  )
  assert.equal(petModelActionNeedsConfirmation('pet-model:import-codex-gallery', 'private-slug'), true)
  assert.equal(petModelActionNeedsConfirmation('pet-model:open-creator-kit-path', {
    kitDirectory: '/tmp/private-kit',
    targetPath: '/tmp/private-kit/pet.json',
  }), true)
})
