import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('App gives the install dialog the listener selected in settings', () => {
  const source = readFileSync(new URL('../src/app/App.tsx', import.meta.url), 'utf8')
  const overlays = source.match(/<ModelSetupOverlay\b/g) ?? []
  assert.equal(overlays.length, 1)
  assert.match(
    source,
    /speechInputProviderId=\{controller\.panelView\.settings\.speechInputProviderId\}/,
  )
})
