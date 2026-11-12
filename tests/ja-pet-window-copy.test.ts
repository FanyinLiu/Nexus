import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { jaCore } from '../src/i18n/locales/ja/core.ts'

const README = readFileSync(new URL('../docs/README.ja.md', import.meta.url), 'utf8')

test('Japanese copy calls the pet surface a window, not a physical window', () => {
  const spotlight = jaCore['about.release_spotlight.bullet.takeover.body']
  assert.ok(spotlight.includes('ペットのウィンドウ'), spotlight)
  assert.equal(spotlight.includes('ペットの窓'), false, spotlight)

  assert.ok(README.includes('ペットのウィンドウ'), 'README.ja.md should say ペットのウィンドウ')
  assert.equal(README.includes('ペットの窓'), false, 'README.ja.md should not say ペットの窓')
})
