#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const REQUIRED_FILES = [
  'src/app/views/LegacyPanelView.tsx',
  'src/app/views/image4ComposerState.ts',
  'src/app/App.css',
  'src/app/styles/panel-companion-chat.css',
  'src/app/styles/panel-companion-composer.css',
  'src/app/styles/panel-companion.css',
  'docs/COMPOSER_SURFACE_REFERENCE_REVIEW.md',
]

const REQUIRED_CONTRACTS = [
  {
    id: 'shared-composer-dom',
    file: 'src/app/views/LegacyPanelView.tsx',
    description: 'PanelView keeps one shared composer DOM with explicit companion and Image4 hooks.',
    patterns: [
      'className="composer composer--minimal companion-chat__composer image4-composer"',
      'className="image4-composer__field"',
      'data-composer-state={image4ComposerState.mode}',
      'data-send-state={image4ComposerState.sendState}',
      'data-has-attachment={image4ComposerState.hasAttachment ? \'true\' : \'false\'}',
      'data-voice-state={image4ComposerState.voiceMode}',
      '<textarea',
      'className="composer__file-input"',
      'className="image4-attachment-pill"',
      'PetControlIcon name="image"',
      'className="image4-attachment-pill__plus"',
      'className="companion-chat__composer-meta"',
      'className="composer__actions"',
      'PetControlIcon name="send"',
    ],
  },
  {
    id: 'composer-state-helper-boundary',
    file: 'src/app/views/image4ComposerState.ts',
    description: 'Image4 composer mode and send state stay in a small testable helper.',
    patterns: [
      "export type Image4ComposerMode = 'idle' | 'drafting' | 'streaming' | 'interrupted'",
      "export type Image4ComposerSendState = 'disabled' | 'ready' | 'busy'",
      "export type Image4ComposerVoiceMode = 'idle' | 'listening' | 'processing' | 'speaking'",
      'export function deriveImage4ComposerState',
      'hasPendingImage',
      'hasNotificationReply',
      'canSendNotificationReply',
      "mode: Image4ComposerMode",
      "sendState: Image4ComposerSendState",
      'voiceMode: Image4ComposerVoiceMode',
    ],
  },
  {
    id: 'panel-view-uses-composer-state-helper',
    file: 'src/app/views/LegacyPanelView.tsx',
    description: 'PanelView consumes Image4 composer state instead of inlining state rules.',
    patterns: [
      "import { deriveImage4ComposerState } from './image4ComposerState'",
      'const image4ComposerState = deriveImage4ComposerState({',
      'data-composer-state={image4ComposerState.mode}',
      'data-send-state={image4ComposerState.sendState}',
      "data-has-attachment={image4ComposerState.hasAttachment ? 'true' : 'false'}",
      'data-voice-state={image4ComposerState.voiceMode}',
      'disabled={image4ComposerState.sendDisabled}',
    ],
  },
  {
    id: 'composer-style-split-imported',
    file: 'src/app/styles/panel-companion.css',
    description: 'The Image4 composer final visual layer stays split from the chat surface stylesheet.',
    patterns: [
      "@import './panel-companion-chat.css';",
      "@import './panel-companion-composer.css';",
      "@import './panel-companion-rhythm.css';",
    ],
  },
  {
    id: 'companion-two-section-composer',
    file: 'src/app/App.css',
    description: 'The normal companion composer stays a two-section textarea plus action row.',
    patterns: [
      '.panel-window--companion .companion-chat__composer',
      'display: grid;',
      'gap: 8px;',
      '.panel-window--companion .composer textarea',
      'height: 64px;',
      '.panel-window--companion .composer__actions',
      'justify-content: flex-end;',
    ],
  },
  {
    id: 'image4-single-dock-composer',
    file: 'src/app/styles/panel-companion-chat.css',
    description: 'Image4 keeps the shared composer DOM rendered as a single dock while final controls stay in the dedicated composer stylesheet.',
    patterns: [
      '.panel-window--image4 .image4-composer',
      'grid-row: composer;',
      'grid-template-areas: "input";',
    ],
  },
  {
    id: 'image4-field-shell-owns-final-composer-layer',
    file: 'src/app/styles/panel-companion-composer.css',
    description: 'Image4 final composer polish lives in a dedicated field shell instead of the chat stylesheet.',
    patterns: [
      '.panel-window--image4 .image4-composer__field',
      'height: clamp(58px, 6.7vh, 76px);',
      '--image4-composer-control: 29px;',
      '--image4-composer-icon: 16px;',
      '--image4-composer-rail-gap: 2px;',
      '--image4-composer-side-inset: 12px;',
      '.panel-window--image4 .image4-composer__field:focus-within',
      "data-composer-state='drafting'",
      "data-composer-state='streaming'",
      "data-composer-state='interrupted'",
      '.panel-window--image4 .image4-composer__field textarea',
      '.panel-window--image4 .image4-composer__field .image4-attachment-pill',
      "data-send-state='ready'",
      "data-send-state='disabled'",
      "data-send-state='busy'",
    ],
  },
  {
    id: 'image4-action-rail-alignment',
    file: 'src/app/styles/panel-companion-composer.css',
    description: 'Image4 attachment and send controls share the compact field alignment.',
    patterns: [
      '.panel-window--image4 .image4-composer__field .image4-attachment-pill',
      '.panel-window--image4 .image4-composer__field .composer__actions',
      'position: absolute;',
      'top: 50%;',
      'bottom: auto;',
      'z-index: 2;',
      'transform: translateY(-50%);',
      'right: auto;',
      'display: inline-flex;',
      'display: inline-grid;',
      'grid-auto-flow: column;',
      'width: auto;',
      '.panel-window--image4 .image4-composer__field .composer__actions .primary-button',
      'display: grid;',
      'place-items: center;',
      'order: 3;',
      'display: none;',
      ':focus-visible',
      'box-shadow: var(--image4-state-focus-ring);',
    ],
  },
  {
    id: 'image4-warm-day-composer-specificity',
    file: 'src/app/styles/panel-companion-composer.css',
    description: 'Warm-day Image4 composer overrides stay scoped to the Image4 surface.',
    patterns: [
      "html[data-theme='warm-day'] .panel-window--image4 .image4-composer__field",
      "html[data-theme='warm-day'] .panel-window--image4 .image4-composer__field textarea",
      "html[data-theme='warm-day'] .panel-window--image4 .image4-composer__field textarea::placeholder",
      "html[data-theme='warm-day'] .panel-window--image4 .image4-composer__field textarea:focus",
      "html[data-theme='warm-day'] .panel-window--image4 .image4-composer__field .image4-attachment-pill",
      "html[data-theme='warm-day'] .panel-window--image4 .image4-composer__field .composer__actions .primary-button",
    ],
  },
  {
    id: 'composer-primary-focus-anchor',
    file: 'src/app/App.css',
    description: 'Textarea focus owns the primary composer anchor in the normal companion surface.',
    patterns: [
      '.panel-window--companion .composer textarea:focus',
      'border-color: rgba(255, 214, 150, 0.34);',
      'box-shadow: 0 0 0 2px rgba(255, 214, 150, 0.08);',
      '.composer textarea {',
      'resize: none;',
    ],
  },
  {
    id: 'image4-field-focus-anchor',
    file: 'src/app/styles/panel-companion-composer.css',
    description: 'The Image4 field shell owns focus while textarea chrome remains transparent.',
    patterns: [
      '.panel-window--image4 .image4-composer__field:focus-within',
      "html[data-theme='warm-day'] .panel-window--image4 .image4-composer__field:focus-within",
      'outline: 2px solid',
      '.panel-window--image4 .image4-composer__field textarea:focus',
      "html[data-theme='warm-day'] .panel-window--image4 .image4-composer__field textarea:focus",
      'border-color: transparent;',
      'box-shadow: none;',
    ],
  },
  {
    id: 'composer-actions-remain-secondary',
    file: 'src/app/App.css',
    description: 'Normal companion composer actions do not gain lift or elevation on hover.',
    patterns: [
      '.panel-window--companion .composer__actions .ghost-button:hover',
      '.panel-window--companion .composer__actions .primary-button:hover',
      'transform: none;',
      'box-shadow: none;',
    ],
  },
  {
    id: 'image4-actions-remain-secondary',
    file: 'src/app/styles/panel-companion-composer.css',
    description: 'Image4 composer actions do not gain lift or elevation on hover.',
    patterns: [
      '.panel-window--image4 .image4-composer__field .image4-attachment-pill:hover',
      '.panel-window--image4 .image4-composer__field .composer__actions .primary-button:hover',
      'transform: none;',
      'box-shadow: none;',
    ],
  },
  {
    id: 'send-disabled-tertiary-lock',
    file: 'src/app/styles/panel-companion-composer.css',
    description: 'Disabled Image4 send stays visually inert instead of reading as an action.',
    patterns: [
      ".panel-window--image4 .image4-composer__field[data-send-state='disabled'] .composer__actions .primary-button:disabled",
      "html[data-theme='warm-day'] .panel-window--image4 .image4-composer__field[data-send-state='disabled'] .composer__actions .primary-button:disabled",
      'background: transparent;',
      'color: rgba(76, 92, 108, 0.36);',
      'box-shadow: none;',
      'cursor: default;',
    ],
  },
  {
    id: 'image4-field-tools-stay-embedded',
    file: 'src/app/styles/panel-companion-composer.css',
    description: 'Image4 attachment and send default to embedded controls instead of persistent button tiles.',
    patterns: [
      'border-color: transparent;',
      'background: transparent;',
      'box-shadow: none;',
      ".panel-window--image4 .image4-composer__field[data-send-state='ready'] .composer__actions .primary-button:not(:disabled)",
      '.panel-window--image4 .image4-composer__field .image4-attachment-pill:hover',
      'transform: none;',
    ],
  },
  {
    id: 'image4-final-compact-control-rhythm',
    file: 'src/app/styles/panel-companion-composer.css',
    description: 'The final Image4 composer layer owns the compact control box and icon rhythm.',
    patterns: [
      '--image4-composer-control: 29px;',
      '--image4-composer-icon: 16px;',
      '--image4-composer-rail-gap: 2px;',
      '--image4-composer-side-inset: 12px;',
      '--image4-composer-left-text-gap: 11px;',
      '--image4-composer-right-text-gap: 10px;',
      'calc(var(--image4-composer-control) + var(--image4-composer-side-inset) + var(--image4-composer-right-text-gap))',
      'calc(var(--image4-composer-control) + var(--image4-composer-side-inset) + var(--image4-composer-left-text-gap))',
      'left: var(--image4-composer-side-inset);',
      'right: var(--image4-composer-side-inset);',
      'width: var(--image4-composer-control);',
      'height: var(--image4-composer-control);',
      'min-width: var(--image4-composer-control);',
      'min-height: var(--image4-composer-control);',
      'grid-auto-columns: var(--image4-composer-control);',
      'gap: var(--image4-composer-rail-gap);',
      'width: var(--image4-composer-icon);',
      'height: var(--image4-composer-icon);',
      'stroke-width: 1.85;',
    ],
  },
  {
    id: 'composer-rhythm-contract-recorded',
    file: 'docs/COMPOSER_SURFACE_REFERENCE_REVIEW.md',
    description: 'The composer review records the compact final control rhythm so future UI work does not resize controls to fix alignment.',
    patterns: [
      'Final Composer Rhythm',
      '29px control box',
      '16px icon box',
      '2px control gap',
      '17px 51px 13px 52px',
      '`panel-companion-composer.css` owns final attachment, send, textarea, focus, and state styling',
      '`panel-companion-chat.css` only owns the dock/container, empty state, action prompts, and hint text',
      'Do not use button resizing as an alignment fix.',
    ],
  },
  {
    id: 'composer-pro-contract-recorded',
    file: 'docs/COMPOSER_SURFACE_REFERENCE_REVIEW.md',
    description: 'The accepted Pro composer judgment is recorded as a bounded local contract.',
    patterns: [
      'single-surface intent gateway',
      'Send is primary only when submit is available.',
      'Attachment is an embedded secondary tool.',
      'Voice runtime controls stay in Settings and out of the main composer.',
      'Runtime/model/streaming hints are tertiary.',
      'Do not add provider, agent, preset, tool-market, or runtime-dashboard controls to the default composer layer.',
      'Do not change Image4 button dimensions to repair alignment.',
    ],
  },
]

const FORBIDDEN_PATTERNS = [
  {
    id: 'base-composer-owns-surface-mode',
    file: 'src/app/App.css',
    description: 'The base .composer rules must not become an Image4/chat layout mode owner.',
    patterns: [
      '.composer { position: absolute;',
      '.composer { grid-template-areas:',
      '.composer--minimal { position: absolute;',
      '.composer--minimal { grid-template-areas:',
    ],
  },
  {
    id: 'companion-css-imports-image4-hooks',
    file: 'src/app/App.css',
    description: 'Normal companion CSS must not depend on Image4 hooks or rhythm variables.',
    patterns: [
      '.panel-window--companion .image4',
      '.panel-window--companion [class*="image4',
      '--image4-rhythm-',
    ],
  },
  {
    id: 'image4-css-targets-companion-mode',
    file: 'src/app/styles/panel-companion-chat.css',
    description: 'Image4 composer CSS must not target the normal companion surface.',
    patterns: [
      '.panel-window--companion',
      'html[data-theme=\'warm-day\'] .panel-window--companion',
    ],
  },
  {
    id: 'image4-attachment-stays-single-purpose',
    file: 'src/app/views/LegacyPanelView.tsx',
    description: 'The Image4 attachment affordance stays a single image-attachment icon without dropdown chrome.',
    patterns: [
      'image4-attachment-pill__image',
      'image4-attachment-pill__chevron',
      'PetControlIcon name="chevron-down"',
    ],
  },
  {
    id: 'composer-forbids-default-dashboard-controls',
    file: 'src/app/views/LegacyPanelView.tsx',
    description: 'Provider, agent, preset, tool-market, and runtime-dashboard controls must not enter the default composer layer.',
    patterns: [
      'className="composer__provider',
      'className="composer__runtime',
      'className="composer__preset',
      'className="composer__tool-market',
      'className="composer__toolbar',
      'className="runtime-dashboard',
      'className="provider-dashboard',
      'className="agent-preset',
    ],
  },
  {
    id: 'legacy-composer-forbids-mic-action',
    file: 'src/app/views/LegacyPanelView.tsx',
    description: 'Legacy Panel keeps runtime voice controls in Settings instead of the main composer.',
    patterns: [
      'PetControlIcon name="mic"',
    ],
  },
  {
    id: 'image4-css-forbids-removed-voice-controls',
    file: 'src/app/styles/panel-companion-composer.css',
    description: 'Image4 CSS contains no dead mic button or voice-state styling after voice controls moved to Settings.',
    patterns: [
      '.ghost-button',
      "[data-voice-state='listening']",
      "[data-voice-state='processing']",
      "[data-voice-state='speaking']",
    ],
  },
  {
    id: 'composer-css-forbids-toolbar-and-three-button-mode',
    file: 'src/app/styles/panel-companion-chat.css',
    description: 'Composer CSS must not revive toolbar chrome, runtime dashboards, or dead three-button Image4 sizing branches.',
    patterns: [
      'button:nth-child(3)',
      '.composer__toolbar',
      '.composer__provider',
      '.composer__runtime',
      '.composer__preset',
      '.composer__tool-market',
      '.runtime-dashboard',
      '.provider-dashboard',
      '.agent-preset',
    ],
  },
  {
    id: 'composer-chat-css-forbids-final-control-ownership',
    file: 'src/app/styles/panel-companion-chat.css',
    description: 'The chat stylesheet must not own Image4 textarea, attachment, or send final control styling.',
    patterns: [
      '.panel-window--image4 .composer textarea',
      "html[data-theme='warm-day'] .panel-window--image4 .composer textarea",
      '.panel-window--image4 .image4-attachment-pill',
      "html[data-theme='warm-day'] .panel-window--image4 .image4-attachment-pill",
      '.panel-window--image4 .composer__actions',
      "html[data-theme='warm-day'] .panel-window--image4 .composer__actions",
      'grid-auto-columns: clamp(30px, 5.2vw, 42px);',
      'grid-auto-columns: clamp(28px, 10cqw, 36px);',
    ],
  },
  {
    id: 'composer-final-css-forbids-toolbar-and-three-button-mode',
    file: 'src/app/styles/panel-companion-composer.css',
    description: 'The final Image4 composer stylesheet must stay a field polish layer, not a toolbar mode.',
    patterns: [
      'button:nth-child(3)',
      '.composer__toolbar',
      '.composer__provider',
      '.composer__runtime',
      '.composer__preset',
      '.composer__tool-market',
      '.runtime-dashboard',
      '.provider-dashboard',
      '.agent-preset',
    ],
  },
]

const TRANSFORM_SCOPE_FILES = [
  'src/app/App.css',
  'src/app/styles/panel-companion-chat.css',
  'src/app/styles/panel-companion-composer.css',
]

function readProjectFile(root, file) {
  const fullPath = join(root, file)
  if (!existsSync(fullPath)) return null
  return readFileSync(fullPath, 'utf8')
}

function readProjectFiles(root, files) {
  return new Map(files.map((file) => [file, readProjectFile(root, file)]))
}

function findMissingFiles(files) {
  return [...files.entries()]
    .filter(([, text]) => text == null)
    .map(([file]) => file)
}

function findMissingContracts(files) {
  const missing = []
  for (const contract of REQUIRED_CONTRACTS) {
    const text = files.get(contract.file)
    if (text == null) continue
    const missingPatterns = contract.patterns.filter((pattern) => !text.includes(pattern))
    if (missingPatterns.length) {
      missing.push({
        id: contract.id,
        file: contract.file,
        description: contract.description,
        missingPatterns,
      })
    }
  }
  return missing
}

function findForbiddenPatterns(files) {
  const matches = []
  for (const rule of FORBIDDEN_PATTERNS) {
    const text = files.get(rule.file)
    if (text == null) continue
    const foundPatterns = rule.patterns.filter((pattern) => text.includes(pattern))
    if (foundPatterns.length) {
      matches.push({
        id: rule.id,
        file: rule.file,
        description: rule.description,
        foundPatterns,
      })
    }
  }
  return matches
}

function lineNumberForIndex(text, index) {
  return text.slice(0, index).split('\n').length
}

function collectUnsafeComposerTransforms(files) {
  const unsafe = []
  for (const file of TRANSFORM_SCOPE_FILES) {
    const text = files.get(file)
    if (text == null) continue
    const rulePattern = /([^{}]*\b(?:composer|image4-attachment-pill)[^{}]*)\{([^{}]*)\}/g
    for (const match of text.matchAll(rulePattern)) {
      const selector = match[1].trim().replace(/\s+/g, ' ')
      const body = match[2]
      if (!/:(?:hover|focus-visible|focus)\b/.test(selector)) continue
      const transformMatch = body.match(/transform\s*:\s*([^;]+);/)
      if (!transformMatch) continue
      const value = transformMatch[1].trim()
      if (value === 'none') continue
      unsafe.push({
        file,
        selector,
        value,
        line: lineNumberForIndex(text, match.index ?? 0),
      })
    }
  }
  return unsafe
}

function collectUnsafeActionElevation(files) {
  const unsafe = []
  for (const file of TRANSFORM_SCOPE_FILES) {
    const text = files.get(file)
    if (text == null) continue
    const rulePattern = /([^{}]*\bcomposer__actions\b[^{}]*)\{([^{}]*)\}/g
    for (const match of text.matchAll(rulePattern)) {
      const selector = match[1].trim().replace(/\s+/g, ' ')
      if (!/:(?:hover|focus-visible|focus)\b/.test(selector)) continue
      const body = match[2]
      const issues = []
      const transformMatch = body.match(/transform\s*:\s*([^;]+);/)
      const shadowMatch = body.match(/box-shadow\s*:\s*([^;]+);/)
      const zIndexMatch = body.match(/z-index\s*:\s*([^;]+);/)

      if (transformMatch && transformMatch[1].trim() !== 'none') {
        issues.push({ property: 'transform', value: transformMatch[1].trim() })
      }
      if (/:hover\b/.test(selector) && shadowMatch && shadowMatch[1].trim() !== 'none') {
        issues.push({ property: 'box-shadow', value: shadowMatch[1].trim() })
      }
      if (zIndexMatch) {
        issues.push({ property: 'z-index', value: zIndexMatch[1].trim() })
      }

      if (issues.length) {
        unsafe.push({
          file,
          selector,
          issues,
          line: lineNumberForIndex(text, match.index ?? 0),
        })
      }
    }
  }
  return unsafe
}

function countOccurrences(text, fragment) {
  return text.split(fragment).length - 1
}

function buildSummary({ missingFiles, missingContracts, forbiddenPatterns, unsafeTransforms, unsafeActionElevation }) {
  const errors = missingFiles.length
    + missingContracts.length
    + forbiddenPatterns.length
    + unsafeTransforms.length
    + unsafeActionElevation.length
  return {
    ok: errors === 0,
    errors,
  }
}

export function buildComposerCrossSurfaceReport(root = ROOT) {
  const files = readProjectFiles(root, REQUIRED_FILES)
  const panelView = files.get('src/app/views/LegacyPanelView.tsx') ?? ''
  const missingFiles = findMissingFiles(files)
  const missingContracts = findMissingContracts(files)
  const forbiddenPatterns = findForbiddenPatterns(files)
  const unsafeTransforms = collectUnsafeComposerTransforms(files)
  const unsafeActionElevation = collectUnsafeActionElevation(files)

  const report = {
    audit: 'composer-cross-surface',
    privacy: {
      staticSourceOnly: true,
      readsRuntimeUserData: false,
    },
    checkedFiles: REQUIRED_FILES,
    checkedContracts: REQUIRED_CONTRACTS.map((contract) => contract.id),
    composerDom: {
      sharedHookOccurrences: countOccurrences(panelView, 'companion-chat__composer image4-composer'),
      hasTextarea: panelView.includes('<textarea'),
      hasMicAction: panelView.includes('PetControlIcon name="mic"'),
      hasSendAction: panelView.includes('PetControlIcon name="send"'),
      hasImage4AttachmentPill: panelView.includes('className="image4-attachment-pill"'),
    },
    missingFiles,
    missingContracts,
    forbiddenPatterns,
    unsafeTransforms,
    unsafeActionElevation,
  }

  return {
    ...report,
    summary: buildSummary(report),
  }
}

export function formatComposerCrossSurfaceReport(report) {
  const lines = ['Composer cross-surface audit']
  lines.push(`- checked files: ${report.checkedFiles.length}`)
  lines.push(`- checked contracts: ${report.checkedContracts.length}`)
  lines.push(`- shared composer hook occurrences: ${report.composerDom.sharedHookOccurrences}`)
  lines.push('')
  lines.push(`ERROR missingFiles: ${report.missingFiles.length}`)
  lines.push(`ERROR missingContracts: ${report.missingContracts.length}`)
  lines.push(`ERROR forbiddenPatterns: ${report.forbiddenPatterns.length}`)
  lines.push(`ERROR unsafeTransforms: ${report.unsafeTransforms.length}`)
  lines.push(`ERROR unsafeActionElevation: ${report.unsafeActionElevation.length}`)

  if (report.missingContracts.length) {
    lines.push('')
    for (const item of report.missingContracts) {
      lines.push(`missing contract ${item.id} in ${item.file}`)
      for (const pattern of item.missingPatterns) {
        lines.push(`  - ${pattern}`)
      }
    }
  }

  if (report.forbiddenPatterns.length) {
    lines.push('')
    for (const item of report.forbiddenPatterns) {
      lines.push(`forbidden pattern ${item.id} in ${item.file}`)
      for (const pattern of item.foundPatterns) {
        lines.push(`  - ${pattern}`)
      }
    }
  }

  if (report.unsafeTransforms.length) {
    lines.push('')
    for (const item of report.unsafeTransforms) {
      lines.push(`unsafe transform in ${item.file}:${item.line}`)
      lines.push(`  selector: ${item.selector}`)
      lines.push(`  value: ${item.value}`)
    }
  }

  if (report.unsafeActionElevation.length) {
    lines.push('')
    for (const item of report.unsafeActionElevation) {
      lines.push(`unsafe action elevation in ${item.file}:${item.line}`)
      lines.push(`  selector: ${item.selector}`)
      for (const issue of item.issues) {
        lines.push(`  ${issue.property}: ${issue.value}`)
      }
    }
  }

  lines.push('')
  lines.push(`Summary: ok=${report.summary.ok} errors=${report.summary.errors}`)
  return lines.join('\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = buildComposerCrossSurfaceReport(ROOT)
  console.log(formatComposerCrossSurfaceReport(report))
  process.exitCode = report.summary.ok ? 0 : 1
}
