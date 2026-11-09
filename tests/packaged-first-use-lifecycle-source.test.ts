import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const scriptPath = new URL('../scripts/packaged-first-use-lifecycle.mjs', import.meta.url)

test('the packaged first-use harness never touches the real macOS keychain', async () => {
  const source = await readFile(scriptPath, 'utf8')

  assert.match(
    source,
    /'--use-mock-keychain'/,
    'safeStorage must use Chromium\'s mock keychain during the measurement run',
  )
  assert.match(source, /`--remote-debugging-port=\$\{port\}`/)
  assert.match(source, /`--user-data-dir=\$\{userDataDir\}`/)
})
