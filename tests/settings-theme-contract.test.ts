import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const productReferenceUrl = new URL(
  '../src/app/styles/settings-product-reference-final.css',
  import.meta.url,
)
const productShellUrl = new URL(
  '../src/app/styles/settings-product-shell.css',
  import.meta.url,
)

async function readSettingsProductStyles() {
  const [shellSource, referenceSource] = await Promise.all([
    readFile(productShellUrl, 'utf8'),
    readFile(productReferenceUrl, 'utf8'),
  ])
  return `${shellSource}\n${referenceSource}`
}

test('settings product layout keeps distinct black, night, day, and warm-day palettes', async () => {
  const source = await readSettingsProductStyles()

  assert.match(
    source,
    /\.sd-black:is\([^)]+\)[\s\S]*?--nx-settings-surface:\s*#0b0c0e;/,
  )
  assert.match(
    source,
    /\.sd-night:is\([^)]+\)[\s\S]*?--nx-settings-surface:\s*#17151c;/,
  )
  assert.match(
    source,
    /\.sd-day:not\(\.sd-warm\):is\([^)]+\)[\s\S]*?--nx-settings-surface:\s*#f7f9fc;/,
  )
  assert.match(
    source,
    /\.sd-warm:is\([^)]+\)[\s\S]*?--nx-settings-surface:\s*#fbf8f3;/,
  )
  assert.match(source, /grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\);/)
})

test('settings product layout consumes palette variables instead of a warm-only shell', async () => {
  const source = await readSettingsProductStyles()
  const declarationsAfterPalette = source.slice(source.indexOf('.settings-drawer.settings-drawer--home::before'))

  assert.match(source, /background:\s*var\(--nx-settings-backdrop\);/)
  assert.match(source, /background:\s*var\(--nx-settings-surface\);/)
  assert.match(source, /box-shadow:\s*var\(--nx-settings-shell-shadow\);/)
  assert.match(source, /--settings-accent:\s*var\(--nx-settings-accent\);/)
  assert.match(source, /--settings-concept-ink:\s*var\(--nx-settings-ink\);/)
  assert.match(source, /width:\s*min\(720px, calc\(100vw - 20px\)\);/)
  assert.doesNotMatch(
    declarationsAfterPalette,
    /background:\s*(?:#fbf8f3|#ffffff|#f4f0ea|#efebe5);/i,
  )
})

test('settings narrow shell and backdrop share the same viewport inset', async () => {
  const source = await readSettingsProductStyles()

  assert.match(
    source,
    /@media \(max-width: 679px\)[\s\S]*?\.sb-night:has\(\.sd-home\)[\s\S]*?padding:\s*8px;/,
  )
  assert.match(source, /width:\s*min\(392px, calc\(100vw - 16px\)\);/)
  assert.match(source, /height:\s*min\(784px, calc\(100vh - 16px\)\);/)
})

test('programmatically focused section headings do not look like text fields', async () => {
  const source = await readSettingsProductStyles()

  assert.match(
    source,
    /\.sph h4\[tabindex='-1'\]:focus\s*\{\s*outline:\s*none;/,
  )
})
