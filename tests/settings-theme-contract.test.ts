import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const productReferenceUrl = new URL(
  '../src/app/styles/settings-product-reference-final.css',
  import.meta.url,
)
const productReferenceModernBridgeUrl = new URL(
  '../src/app/styles/settings-product-reference-modern-bridge.css',
  import.meta.url,
)
const productShellUrl = new URL(
  '../src/app/styles/settings-product-shell.css',
  import.meta.url,
)
const settingsV2Url = new URL(
  '../src/features/uiV2/settings-v2.css',
  import.meta.url,
)

async function readSettingsProductStyles() {
  const [shellSource, referenceSource, modernBridgeSource] = await Promise.all([
    readFile(productShellUrl, 'utf8'),
    readFile(productReferenceUrl, 'utf8'),
    readFile(productReferenceModernBridgeUrl, 'utf8'),
  ])
  return `${shellSource}\n${referenceSource}\n${modernBridgeSource}`
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

type Rgb = readonly [number, number, number]

function rgb(hex: string): Rgb {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ]
}

function alphaComposite(foreground: Rgb, background: Rgb, alpha: number): Rgb {
  return [
    foreground[0] * alpha + background[0] * (1 - alpha),
    foreground[1] * alpha + background[1] * (1 - alpha),
    foreground[2] * alpha + background[2] * (1 - alpha),
  ]
}

function mixSrgb(primary: Rgb, secondary: Rgb, primaryWeight: number): Rgb {
  return alphaComposite(primary, secondary, primaryWeight)
}

function relativeLuminance(color: Rgb): number {
  const channels = color.map((channel) => {
    const normalized = channel / 255
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function contrastRatio(first: Rgb, second: Rgb): number {
  const firstLuminance = relativeLuminance(first)
  const secondLuminance = relativeLuminance(second)
  const lighter = Math.max(firstLuminance, secondLuminance)
  const darker = Math.min(firstLuminance, secondLuminance)
  return (lighter + 0.05) / (darker + 0.05)
}

test('light settings tokens meet contrast while day and dark palette contracts stay fixed', async () => {
  const shellSource = await readFile(productShellUrl, 'utf8')
  const daySurface = rgb('#f7f9fc')
  const warmSurface = rgb('#fbf8f3')

  assert.match(shellSource, /\.sb-day:not\(\.sb-warm\):has\(\.sd-home\),[\s\S]*?--nx-settings-muted:\s*rgba\(23, 32, 42, 0\.66\);/)
  assert.match(shellSource, /\.sb-day:not\(\.sb-warm\):has\(\.sd-home\),[\s\S]*?--nx-settings-faint:\s*rgba\(23, 32, 42, 0\.48\);/)
  assert.match(shellSource, /\.sd-warm:is\(\.sd-home, \.sd-section\)[\s\S]*?--nx-settings-muted:\s*rgba\(72, 63, 55, 0\.74\);/)
  assert.match(shellSource, /\.sd-warm:is\(\.sd-home, \.sd-section\)[\s\S]*?--nx-settings-faint:\s*rgba\(72, 63, 55, 0\.58\);/)

  assert.ok(contrastRatio(alphaComposite(rgb('#17202a'), daySurface, 0.48), daySurface) >= 3)
  assert.ok(contrastRatio(alphaComposite(rgb('#483f37'), warmSurface, 0.58), warmSurface) >= 3)
  assert.ok(contrastRatio(alphaComposite(rgb('#483f37'), warmSurface, 0.74), warmSurface) >= 4.5)

  assert.match(shellSource, /\.sb-night:has\(\.sd-home\),[\s\S]*?--nx-settings-muted:\s*rgba\(226, 218, 232, 0\.68\);[\s\S]*?--nx-settings-faint:\s*rgba\(226, 218, 232, 0\.44\);/)
  assert.match(shellSource, /\.sb-black:has\(\.sd-home\),[\s\S]*?--nx-settings-muted:\s*rgba\(218, 221, 227, 0\.68\);[\s\S]*?--nx-settings-faint:\s*rgba\(218, 221, 227, 0\.42\);/)
})

test('light V2 accent is scoped to day and warm and preserves accent-soft', async () => {
  const source = await readFile(settingsV2Url, 'utf8')
  const localRule = source.match(
    /\.settings-drawer--v2:is\(\.sd-day, \.sd-warm\) > \.settings-v2\s*\{([\s\S]*?)\n\}/,
  )?.[0] ?? ''

  assert.match(localRule, /--nx-settings-accent:\s*color-mix\(in srgb, var\(--color-accent, #a88bff\) 55%, var\(--nx-settings-ink\) 45%\);/)
  assert.match(localRule, /--settings-v2-accent:\s*var\(--nx-settings-accent\);/)
  assert.doesNotMatch(localRule, /\.sd-night|\.sd-black|accent-soft/)
  assert.match(source, /--settings-v2-accent-soft:\s*var\(--color-accent-soft, var\(--nx-settings-accent-soft\)\);/)

  const scenarios: Array<{ accent: Rgb; ink: Rgb; soft: Rgb }> = [
    {
      accent: rgb('#3478f6'),
      ink: rgb('#17202a'),
      soft: alphaComposite(rgb('#3478f6'), rgb('#f7f9fc'), 0.1),
    },
    {
      accent: rgb('#8f5b43'),
      ink: rgb('#26211c'),
      soft: alphaComposite(rgb('#8f5b43'), rgb('#fbf8f3'), 0.1),
    },
    {
      accent: rgb('#a88bff'),
      ink: rgb('#17202a'),
      soft: alphaComposite(rgb('#a88bff'), rgb('#ffffff'), 0.14),
    },
  ]

  for (const { accent, ink, soft } of scenarios) {
    const mixedAccent = mixSrgb(accent, ink, 0.55)
    assert.ok(contrastRatio(mixedAccent, soft) >= 4.5)
    assert.ok(contrastRatio(rgb('#ffffff'), mixedAccent) >= 4.5)
  }
})
