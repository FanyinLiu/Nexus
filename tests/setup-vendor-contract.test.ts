import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const ROOT = process.cwd()

test('vendor setup copies the lockfile-pinned browser VAD AudioWorklet into its runtime base path', () => {
  const setup = readFileSync(join(ROOT, 'scripts', 'setup-vendor.mjs'), 'utf8')
  const browserVad = readFileSync(join(ROOT, 'src', 'features', 'hearing', 'browserVad.ts'), 'utf8')

  assert.match(browserVad, /baseAssetPath: resolvePublicAssetPath\('vendor\/vad\/'\)/)
  assert.match(setup, /@ricky0123', 'vad-web', 'dist', 'vad\.worklet\.bundle\.min\.js/)
  assert.match(setup, /join\(vadDir, 'vad\.worklet\.bundle\.min\.js'\)/)
  assert.match(setup, /copyFileSync\(vadWorkletSource, vadWorkletDest\)/)
  assert.match(setup, /throw new Error\(`\[vendor\] required VAD worklet source not found:/)
})
