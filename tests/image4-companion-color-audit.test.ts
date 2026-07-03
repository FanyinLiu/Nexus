import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { buildImage4CompanionColorReport } from '../scripts/image4-companion-color-audit.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const BASELINE_FILES: Record<string, string> = {
  'src/app/styles/panel-companion-shell.css': `
/* Codex-like neutral pass for Image 4. This intentionally overrides warm-day. */
html[data-theme='warm-day'] .desktop-pet-root--panel:has(.panel-window--image4) {
  background: #0d1117;
}

/* Xinghui companion palette: warm off-white base with blue-green support and apricot emotional accent. */
html[data-theme='warm-day'] .desktop-pet-root--panel:has(.panel-window--image4) {
  --image4-companion-bg: #fff6ea;
  --image4-companion-surface: #fffaf3;
  --image4-companion-surface-strong: #f4e4d0;
  --image4-companion-primary: #d98257;
  --image4-companion-primary-soft: #ffd7b8;
  --image4-companion-secondary: #7fa99b;
  --image4-companion-text: #302823;
  --image4-companion-muted: #7a6a5e;
  background: var(--image4-companion-bg);
}

html[data-theme='warm-day'] .desktop-pet-root--panel:has(.panel-window--image4)::before {
  background:
    linear-gradient(180deg, rgba(255, 250, 243, 0.52), rgba(244, 228, 208, 0.64)),
    url("../../features/panelScene/scenes/seaside.day.jpg") center bottom / cover no-repeat;
}
`,
  'src/app/styles/panel-companion-composer.css': `
html[data-theme='warm-day'] .panel-window--image4 .image4-composer__field .image4-attachment-pill,
html[data-theme='warm-day'] .panel-window--image4 .image4-composer__field .composer__actions .ghost-button {
  color: color-mix(in srgb, var(--image4-companion-muted) 88%, var(--image4-companion-text));
}

html[data-theme='warm-day'] .panel-window--image4 .image4-composer__field[data-send-state='ready'] .composer__actions .primary-button:not(:disabled) {
  color: color-mix(in srgb, var(--image4-companion-secondary) 82%, var(--image4-companion-text));
}

html[data-theme='warm-day'] .panel-window--image4 .image4-composer__field[data-has-attachment='true'] .image4-attachment-pill,
html[data-theme='warm-day'] .panel-window--image4 .image4-composer__field[data-voice-state='listening'] .composer__actions .ghost-button {
  color: color-mix(in srgb, var(--image4-companion-secondary) 76%, var(--image4-companion-text));
}

html[data-theme='warm-day'] .panel-window--image4 .image4-composer__field[data-voice-state='speaking'] .composer__actions .ghost-button {
  color: color-mix(in srgb, var(--image4-companion-primary) 76%, var(--image4-companion-text));
}

html[data-theme='warm-day'] .panel-window--image4 .image4-composer__field[data-send-state='disabled'] .composer__actions .primary-button:disabled {
  color: color-mix(in srgb, var(--image4-companion-muted) 36%, transparent);
}
`,
  'src/app/styles/panel-companion-layout.css': `
/* Xinghui companion palette: signal line and bars stay attached to the warm field. */
html[data-theme='warm-day'] .panel-window--image4 .companion-presence__signal::before,
html[data-theme='warm-day'] .panel-window--image4 .companion-presence__signal.is-idle::before {
  background: linear-gradient(
    90deg,
    transparent,
    color-mix(in srgb, var(--image4-companion-primary-soft) 18%, transparent) 18%,
    color-mix(in srgb, var(--image4-companion-secondary) 16%, transparent) 58%,
    transparent
  );
}

html[data-theme='warm-day'] .panel-window--image4 .companion-presence__signal.is-speaking::before {
  background: linear-gradient(
    90deg,
    transparent,
    color-mix(in srgb, var(--image4-companion-secondary) 28%, transparent) 16%,
    color-mix(in srgb, var(--image4-companion-primary) 30%, transparent) 58%,
    transparent
  );
}

html[data-theme='warm-day'] .panel-window--image4 .companion-presence__signal-bar {
  background: color-mix(in srgb, var(--image4-companion-muted) 42%, transparent);
}

html[data-theme='warm-day'] .panel-window--image4 .companion-presence__signal.is-speaking .companion-presence__signal-bar {
  background: color-mix(in srgb, var(--image4-companion-secondary) 68%, var(--image4-companion-primary));
}
`,
  'docs/IMAGE4_COMPANION_FIELD_REFERENCE_REVIEW.md': `
# Image4 Companion Field Reference Review

## Companion Color Research Basis

This color direction is grounded in color-emotion research and accessibility rules, not only visual taste. Light colors skew positive, while blue, green, blue-green, and white are associated with positive low-arousal emotions such as comfort and relaxation. Nexus should use peach/apricot as a restrained emotional accent instead of a broad high-energy theme.

For controls, the W3C non-text contrast guidance is the guardrail. In Image4 warm-day this means embedded plus, mic, send-ready, focus, and speaking cues should be legible through companion tokens before adding tiles, shadows, or larger button boxes.

## Companion Palette Time-Of-Day Model

The companion palette should change emotional temperature by time state, not collapse into one always-dark or always-bright skin. The model is a three-state review lens: morning warmth, daytime calm, and night low-light.

| Time state | Palette role | Must avoid |
| --- | --- | --- |
| Morning | Soft warm off-white, cream, and restrained apricot so a morning greeting reads bright and present. | Dark workbench defaults, cold blue-gray shells, or dramatic night imagery. |
| Daytime | Similar warm-day base with slightly quieter sage or mist-blue support for focus and trust. | High-saturation orange/red floods or decorative mood lighting detached from state. |
| Night | Intentional low-light mode with warm dark brown or charcoal, still keeping text and controls readable. | Treating night/dark as the default mood for morning or daytime companionship. |

Morning and normal daytime use the warm-day palette. Night/dark themes are intentional low-light states, not the default companion mood.
`,
}

function createFixture(overrides: Record<string, string | null> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'nexus-image4-companion-color-audit-'))
  for (const [relativePath, baseline] of Object.entries(BASELINE_FILES)) {
    if (overrides[relativePath] === null) continue
    const absolutePath = join(root, relativePath)
    mkdirSync(dirname(absolutePath), { recursive: true })
    writeFileSync(absolutePath, overrides[relativePath] ?? baseline)
  }
  return root
}

function withFixture<T>(overrides: Record<string, string | null>, callback: (root: string) => T): T {
  const root = createFixture(overrides)
  try {
    return callback(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function findCheck(report: ReturnType<typeof buildImage4CompanionColorReport>, id: string) {
  const check = report.contrastChecks.find((item) => item.id === id)
  assert.ok(check, `missing contrast check ${id}`)
  return check
}

test('Image4 companion color audit passes the warm companionship palette', () => {
  withFixture({}, (root) => {
    const report = buildImage4CompanionColorReport(root)

    assert.equal(report.summary.ok, true)
    assert.equal(report.summary.errors, 0)
    assert.equal(report.privacy.staticSourceOnly, true)
    assert.ok(findCheck(report, 'text-on-surface').ratio >= 7)
    assert.ok(findCheck(report, 'embedded-tool-icon-on-surface').ratio >= 3)
    assert.ok(findCheck(report, 'send-ready-on-surface').ratio >= 3)
  })
})

test('Image4 companion color audit rejects a too-light stabilizing accent', () => {
  withFixture({
    'src/app/styles/panel-companion-shell.css': BASELINE_FILES['src/app/styles/panel-companion-shell.css'].replace(
      '--image4-companion-secondary: #7fa99b;',
      '--image4-companion-secondary: #c9d8d1;',
    ),
  }, (root) => {
    const report = buildImage4CompanionColorReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.errors.contrastFailures.some((item) => item.id === 'send-ready-on-surface'))
  })
})

test('Image4 companion color audit rejects missing research basis', () => {
  withFixture({
    'docs/IMAGE4_COMPANION_FIELD_REFERENCE_REVIEW.md': BASELINE_FILES['docs/IMAGE4_COMPANION_FIELD_REFERENCE_REVIEW.md'].replace(
      'W3C non-text contrast guidance',
      'visual preference',
    ),
  }, (root) => {
    const report = buildImage4CompanionColorReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.errors.missingPatterns.some((item) => item.id === 'research-basis-recorded'))
  })
})

test('Image4 companion color audit rejects missing time-of-day palette model', () => {
  withFixture({
    'docs/IMAGE4_COMPANION_FIELD_REFERENCE_REVIEW.md': BASELINE_FILES['docs/IMAGE4_COMPANION_FIELD_REFERENCE_REVIEW.md'].replace(
      'The model is a three-state review lens: morning warmth, daytime calm, and night low-light.',
      'The palette can be tuned by visual preference.',
    ),
  }, (root) => {
    const report = buildImage4CompanionColorReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.errors.missingPatterns.some((item) => item.id === 'time-of-day-palette-model-recorded'))
  })
})

test('Image4 companion color audit rejects weak embedded tool formulas', () => {
  withFixture({
    'src/app/styles/panel-companion-composer.css': BASELINE_FILES['src/app/styles/panel-companion-composer.css'].replace(
      'color: color-mix(in srgb, var(--image4-companion-muted) 88%, var(--image4-companion-text));',
      'color: color-mix(in srgb, var(--image4-companion-muted) 78%, transparent);',
    ),
  }, (root) => {
    const report = buildImage4CompanionColorReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.errors.missingPatterns.some((item) => item.id === 'composer-uses-token-contrast-formulas'))
  })
})

test('Image4 companion color audit rejects detached presence signal colors', () => {
  withFixture({
    'src/app/styles/panel-companion-layout.css': BASELINE_FILES['src/app/styles/panel-companion-layout.css'].replace(
      'color-mix(in srgb, var(--image4-companion-primary-soft) 18%, transparent)',
      'rgba(83, 116, 143, 0.12)',
    ),
  }, (root) => {
    const report = buildImage4CompanionColorReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.errors.missingPatterns.some((item) => item.id === 'presence-signal-uses-companion-palette'))
  })
})

test('Image4 companion color audit rejects final warm-day being overwritten by a later neutral pass', () => {
  withFixture({
    'src/app/styles/panel-companion-shell.css': `${BASELINE_FILES['src/app/styles/panel-companion-shell.css']}
/* Codex-like neutral pass for Image 4. This intentionally overrides warm-day. */
html[data-theme='warm-day'] .desktop-pet-root--panel:has(.panel-window--image4) {
  background: #0d1117;
}
`,
  }, (root) => {
    const report = buildImage4CompanionColorReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.errors.themeSourceIssues.some((item) => item.id === 'palette-before-neutral-override'))
  })
})

test('Image4 companion color audit rejects the night scene inside the final warm-day palette', () => {
  withFixture({
    'src/app/styles/panel-companion-shell.css': BASELINE_FILES['src/app/styles/panel-companion-shell.css'].replace(
      'seaside.day.jpg',
      'seaside.night.jpg',
    ),
  }, (root) => {
    const report = buildImage4CompanionColorReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.errors.themeSourceIssues.some((item) => item.id === 'missing-day-scene'))
    assert.ok(report.errors.themeSourceIssues.some((item) => item.id === 'night-scene-after-final-palette'))
  })
})

test('Image4 companion color audit runs against the repository', () => {
  const report = buildImage4CompanionColorReport(ROOT)

  assert.equal(report.summary.ok, true)
  assert.equal(report.summary.errors, 0)
})
