import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function readSource(relativePath: string) {
  return readFileSync(join(ROOT, relativePath), 'utf8')
}

test('desktop text file dialogs return display paths for renderer status messages', () => {
  const pathSource = readSource('electron/services/petModelPaths.js')
  const serviceSource = readSource('electron/services/petModelService.js')
  const typeSource = readSource('src/types/voice.ts')

  assert.match(pathSource, /export function getLocalFileDisplayPath\(targetPath\)/)
  assert.match(pathSource, /export function getPetArtifactDisplayPath\(targetPath\)/)

  assert.match(serviceSource, /filePathDisplay = getLocalFileDisplayPath\(result\.filePath\)/)
  assert.match(serviceSource, /filePathDisplay = getLocalFileDisplayPath\(filePath\)/)
  assert.match(serviceSource, /message: `已保存到 \$\{filePathDisplay\}`/)
  assert.match(serviceSource, /message: `已读取 \$\{filePathDisplay\}`/)
  assert.doesNotMatch(serviceSource, /message: `已保存到 \$\{result\.filePath\}`/)
  assert.doesNotMatch(serviceSource, /message: `已读取 \$\{filePath\}`/)

  assert.match(typeSource, /filePathDisplay\?: string/)
})

test('browser text file fallbacks keep display paths to file names only', () => {
  const source = readSource('src/lib/textFiles.ts')

  assert.match(source, /filePathDisplay: defaultFileName/)
  assert.match(source, /filePathDisplay: file\.name/)
})

test('file dialog audit summaries stay metadata-only', () => {
  const source = readSource('electron/ipc/windowIpc.js')

  assert.match(source, /extension: extension\.slice\(0, 32\)/)
  assert.match(source, /contentLength: typeof result\?\.content === 'string' \? result\.content\.length : undefined/)
  assert.doesNotMatch(source, /filePath:\s*result\?\.filePath/)
  assert.doesNotMatch(source, /message:\s*result\?\.message/)
})
