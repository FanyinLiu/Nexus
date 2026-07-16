import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const settingsStylesPath = new URL('../src/app/styles/settings.css', import.meta.url)

test('settings reduced motion disables only drawer and backdrop animations', async () => {
  const styles = await readFile(settingsStylesPath, 'utf8')
  const reducedMotion = styles.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/)?.[1] ?? ''

  assert.match(reducedMotion, /\.sb,[\s\S]*?\.sd\s*\{[\s\S]*?animation: none !important;/)
  assert.doesNotMatch(reducedMotion, /\.sd\s*\*/)
  assert.doesNotMatch(reducedMotion, /transition\s*:/)
  assert.match(styles, /@keyframes settings-backdrop-in/)
  assert.match(styles, /@keyframes settings-drawer-in/)
})
