#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const REQUIRED_FILES = [
  'src/app/styles/panel-companion-shell.css',
  'src/app/styles/panel-companion-layout.css',
  'src/app/styles/panel-companion-composer.css',
  'docs/IMAGE4_COMPANION_FIELD_REFERENCE_REVIEW.md',
]

const REQUIRED_TOKENS = [
  '--image4-companion-bg',
  '--image4-companion-surface',
  '--image4-companion-surface-strong',
  '--image4-companion-primary',
  '--image4-companion-primary-soft',
  '--image4-companion-secondary',
  '--image4-companion-text',
  '--image4-companion-muted',
]

const REQUIRED_PATTERNS = [
  {
    id: 'research-basis-recorded',
    file: 'docs/IMAGE4_COMPANION_FIELD_REFERENCE_REVIEW.md',
    patterns: [
      '## Companion Color Research Basis',
      'positive low-arousal emotions such as comfort and relaxation',
      'peach/apricot as a restrained emotional accent',
      'W3C non-text contrast guidance',
      'the embedded attachment, send-ready, and focus cues should be legible through companion tokens. Voice runtime controls stay in Settings; the main companion composer has no voice-control role',
    ],
  },
  {
    id: 'time-of-day-palette-model-recorded',
    file: 'docs/IMAGE4_COMPANION_FIELD_REFERENCE_REVIEW.md',
    patterns: [
      '## Companion Palette Time-Of-Day Model',
      'The model is a three-state review lens: morning warmth, daytime calm, and night low-light.',
      'Morning and normal daytime use the warm-day palette.',
      'Night/dark themes are intentional low-light states, not the default companion mood.',
      'Treating night/dark as the default mood for morning or daytime companionship.',
    ],
  },
  {
    id: 'composer-uses-token-contrast-formulas',
    file: 'src/app/styles/panel-companion-composer.css',
    patterns: [
      'color: color-mix(in srgb, var(--image4-companion-muted) 88%, var(--image4-companion-text));',
      'color: color-mix(in srgb, var(--image4-companion-secondary) 82%, var(--image4-companion-text));',
      'color: color-mix(in srgb, var(--image4-companion-secondary) 76%, var(--image4-companion-text));',
      'color: color-mix(in srgb, var(--image4-companion-muted) 36%, transparent);',
    ],
  },
  {
    id: 'presence-signal-uses-companion-palette',
    file: 'src/app/styles/panel-companion-layout.css',
    patterns: [
      '/* Xinghui companion palette: signal line and bars stay attached to the warm field. */',
      "html[data-theme='warm-day'] .panel-window--image4 .companion-presence__signal::before",
      "html[data-theme='warm-day'] .panel-window--image4 .companion-presence__signal.is-speaking::before",
      "html[data-theme='warm-day'] .panel-window--image4 .companion-presence__signal-bar",
      "html[data-theme='warm-day'] .panel-window--image4 .companion-presence__signal.is-speaking .companion-presence__signal-bar",
      'var(--image4-companion-primary-soft)',
      'var(--image4-companion-secondary)',
      'var(--image4-companion-primary)',
      'var(--image4-companion-muted)',
    ],
  },
]

function readProjectFile(root, file) {
  const fullPath = join(root, file)
  if (!existsSync(fullPath)) return null
  return readFileSync(fullPath, 'utf8')
}

function parseHexColor(value) {
  const match = value.trim().match(/^#([0-9a-f]{6})$/i)
  if (!match) return null
  const hex = match[1]
  return [0, 2, 4].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
}

function extractTokenMap(cssText) {
  const tokens = {}
  for (const name of REQUIRED_TOKENS) {
    const match = cssText.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6});`))
    if (match) tokens[name] = match[1].toLowerCase()
  }
  return tokens
}

function channelToLinear(value) {
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function relativeLuminance(rgb) {
  const [red, green, blue] = rgb.map(channelToLinear)
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function contrastRatio(foreground, background) {
  const foregroundLuminance = relativeLuminance(foreground)
  const backgroundLuminance = relativeLuminance(background)
  const lighter = Math.max(foregroundLuminance, backgroundLuminance)
  const darker = Math.min(foregroundLuminance, backgroundLuminance)
  return (lighter + 0.05) / (darker + 0.05)
}

function mixColors(primary, secondary, primaryWeight) {
  return primary.map((value, index) => value * primaryWeight + secondary[index] * (1 - primaryWeight))
}

function round(value) {
  return Math.round(value * 100) / 100
}

function getColorEntries(tokens) {
  const entries = {}
  for (const [name, value] of Object.entries(tokens)) {
    const rgb = parseHexColor(value)
    if (rgb) entries[name] = rgb
  }
  return entries
}

function buildContrastChecks(colors) {
  const surface = colors['--image4-companion-surface']
  const text = colors['--image4-companion-text']
  const muted = colors['--image4-companion-muted']
  const secondary = colors['--image4-companion-secondary']

  return [
    {
      id: 'text-on-surface',
      role: 'Primary readable text on the warm companion surface.',
      ratio: contrastRatio(text, surface),
      minimum: 7,
    },
    {
      id: 'muted-on-surface',
      role: 'Secondary labels and metadata on the warm companion surface.',
      ratio: contrastRatio(muted, surface),
      minimum: 4.5,
    },
    {
      id: 'embedded-tool-icon-on-surface',
      role: 'Available attachment icon inside the composer.',
      ratio: contrastRatio(mixColors(muted, text, 0.88), surface),
      minimum: 3,
    },
    {
      id: 'send-ready-on-surface',
      role: 'Send-ready and focus affordance color inside the composer.',
      ratio: contrastRatio(mixColors(secondary, text, 0.82), surface),
      minimum: 3,
    },
    {
      id: 'active-attachment-on-surface',
      role: 'Active attachment state inside the composer.',
      ratio: contrastRatio(mixColors(secondary, text, 0.76), surface),
      minimum: 3,
    },
  ]
}

function buildMissingPatterns(files) {
  const missingPatterns = []
  for (const contract of REQUIRED_PATTERNS) {
    const text = files.get(contract.file)
    if (typeof text !== 'string') continue
    const missing = contract.patterns.filter((pattern) => !text.includes(pattern))
    if (missing.length) missingPatterns.push({ ...contract, missingPatterns: missing })
  }
  return missingPatterns
}

function buildRoleIssues(colors) {
  const issues = []
  const bg = colors['--image4-companion-bg']
  const surface = colors['--image4-companion-surface']
  const secondary = colors['--image4-companion-secondary']

  if (relativeLuminance(bg) < 0.9) {
    issues.push({ id: 'background-too-dark', detail: 'Warm-day companion background must stay visibly light.' })
  }
  if (relativeLuminance(surface) < 0.9) {
    issues.push({ id: 'surface-too-dark', detail: 'Warm-day composer and bubble surface must stay visibly light.' })
  }
  if (contrastRatio(secondary, surface) >= 4.5) {
    issues.push({ id: 'secondary-too-dominant', detail: 'Sage blue-green should support focus states, not become dominant body text color.' })
  }

  return issues
}

function buildThemeSourceIssues(shellCss) {
  const issues = []
  const finalPaletteMarker = '/* Xinghui companion palette: warm off-white base with blue-green support and apricot emotional accent. */'
  const neutralOverrideMarker = '/* Codex-like neutral pass'
  const finalPaletteIndex = shellCss.lastIndexOf(finalPaletteMarker)
  const neutralOverrideIndex = shellCss.lastIndexOf(neutralOverrideMarker)

  if (finalPaletteIndex === -1) {
    issues.push({ id: 'missing-final-palette-block', detail: 'Warm-day companion palette must have a final source-order block.' })
    return issues
  }

  if (neutralOverrideIndex !== -1 && finalPaletteIndex < neutralOverrideIndex) {
    issues.push({ id: 'palette-before-neutral-override', detail: 'Warm-day companion palette must be declared after the neutral override block.' })
  }

  const finalPaletteCss = shellCss.slice(finalPaletteIndex)
  if (!finalPaletteCss.includes('seaside.day.jpg')) {
    issues.push({ id: 'missing-day-scene', detail: 'Warm-day companion palette must use the day scene asset after final override.' })
  }
  if (finalPaletteCss.includes('seaside.night.jpg')) {
    issues.push({ id: 'night-scene-after-final-palette', detail: 'Warm-day final palette must not fall back to the night scene asset.' })
  }
  if (/background:\s*#(?:07101b|0d1117|120d0b)\b/i.test(finalPaletteCss)) {
    issues.push({ id: 'dark-background-after-final-palette', detail: 'Warm-day final palette must not restore a dark panel root background.' })
  }

  return issues
}

function buildSummary(errors) {
  const count = Object.values(errors).reduce((sum, items) => sum + items.length, 0)
  return { ok: count === 0, errors: count }
}

export function buildImage4CompanionColorReport(root = ROOT) {
  const missingFiles = REQUIRED_FILES.filter((file) => !existsSync(join(root, file)))
  const files = new Map()
  for (const file of REQUIRED_FILES) {
    const text = readProjectFile(root, file)
    if (text !== null) files.set(file, text)
  }

  const shellCss = files.get('src/app/styles/panel-companion-shell.css') ?? ''
  const tokens = extractTokenMap(shellCss)
  const missingTokens = REQUIRED_TOKENS.filter((token) => !tokens[token]).map((token) => ({ token }))
  const colors = getColorEntries(tokens)
  const missingColorTokens = REQUIRED_TOKENS.filter((token) => !colors[token]).map((token) => ({ token }))
  const missingPatterns = buildMissingPatterns(files)
  const contrastChecks = missingColorTokens.length ? [] : buildContrastChecks(colors).map((check) => ({
    ...check,
    ratio: round(check.ratio),
  }))
  const contrastFailures = contrastChecks
    .filter((check) => check.ratio < check.minimum)
    .map((check) => ({ ...check, detail: `${check.ratio}:1 is below ${check.minimum}:1` }))
  const roleIssues = missingColorTokens.length ? [] : buildRoleIssues(colors)
  const themeSourceIssues = buildThemeSourceIssues(shellCss)
  const errors = { missingFiles, missingTokens, missingPatterns, contrastFailures, roleIssues, themeSourceIssues }

  return {
    audit: 'image4-companion-color',
    checkedFiles: REQUIRED_FILES,
    tokens,
    contrastChecks,
    errors,
    summary: buildSummary(errors),
    privacy: {
      readsUserStorage: false,
      staticSourceOnly: true,
    },
  }
}

function formatHumanReport(report) {
  const lines = ['Image4 companion color audit']
  lines.push(`- checked files: ${report.checkedFiles.length}`)
  lines.push(`- contrast checks: ${report.contrastChecks.length}`)
  lines.push('')
  for (const check of report.contrastChecks) {
    lines.push(`- ${check.id}: ${check.ratio}:1 minimum ${check.minimum}:1`)
  }
  lines.push('')
  for (const [name, items] of Object.entries(report.errors)) {
    lines.push(`ERROR ${name}: ${items.length}`)
    for (const item of items) {
      if (item.file) lines.push(`  - ${item.id ?? item.file} ${item.file}`)
      if (item.token) lines.push(`  - ${item.token}`)
      if (item.detail) lines.push(`  - ${item.id}: ${item.detail}`)
      if (item.missingPatterns) {
        for (const pattern of item.missingPatterns) lines.push(`    missing ${pattern}`)
      }
    }
  }
  lines.push('')
  lines.push(`Summary: ok=${report.summary.ok} errors=${report.summary.errors}`)
  return lines.join('\n')
}

function main(argv) {
  const report = buildImage4CompanionColorReport(ROOT)
  const json = argv.includes('--json') || argv.includes('--format=json')
  process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : `${formatHumanReport(report)}\n`)
  if (!report.summary.ok) process.exit(1)
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null
if (invokedPath && resolve(fileURLToPath(import.meta.url)) === invokedPath) {
  main(process.argv.slice(2))
}
