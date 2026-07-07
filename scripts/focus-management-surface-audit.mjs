#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const REQUIRED_FILES = [
  'docs/FOCUS_MANAGEMENT_REFERENCE_REVIEW.md',
  'src/components/SettingsDrawer.tsx',
  'src/components/SettingsHomeView.tsx',
  'src/components/ConfirmDialog.tsx',
  'src/components/useConfirm.ts',
  'src/hooks/useModalFocusTrap.ts',
  'src/app/styles/settings.css',
  'src/app/styles/settings-home.css',
  'src/app/styles/settings-themes.css',
]

const REQUIRED_CONTRACTS = [
  {
    id: 'focus-pro-contract-recorded',
    file: 'docs/FOCUS_MANAGEMENT_REFERENCE_REVIEW.md',
    description: 'The accepted Pro focus-management judgment is recorded as a bounded local contract.',
    patterns: [
      'accessibility interaction contract layer',
      'keyboard users must always know where they are',
      'Drawer close restores focus to the opener',
      'Section changes programmatically focus the new section heading',
      'must not only remove the browser outline',
      'Radix UI Primitives',
      'assistant-ui',
      'Cline',
    ],
  },
  {
    id: 'settings-drawer-focus-handoff',
    file: 'src/components/SettingsDrawer.tsx',
    description: 'SettingsDrawer owns a local focus trap, opener return, and section heading handoff.',
    patterns: [
      'useModalFocusTrap(settingsDialogRef, open)',
      'settingsOpenerRef',
      'restoreSettingsOpenerFocus',
      'settingsHomeCardRefs',
      'activeSectionHeadingRef',
      'resetSettingsSectionScroll',
      'useLayoutEffect',
      "behavior: 'auto'",
      'preventScroll: true',
      'role="dialog"',
      'aria-modal="true"',
      'tabIndex={-1}',
    ],
  },
  {
    id: 'settings-home-card-focus-return-targets',
    file: 'src/components/SettingsHomeView.tsx',
    description: 'Settings home cards expose stable return targets for the drawer section back flow.',
    patterns: [
      'settingsHomeCardRefs.current[card.sectionId]',
      'data-focus-return-section',
      'onOpenSettingsSection(card.sectionId)',
      'className="settings-home-card"',
    ],
  },
  {
    id: 'settings-menu-keyboard-exit',
    file: 'src/components/SettingsDrawer.tsx',
    description: 'Menu-like controls keep keyboard exit and trigger focus return.',
    patterns: [
      'handleLanguageMenuItemKeyDown',
      "event.key === 'Escape'",
      'languageButtonRef.current?.focus()',
      'role="menuitemradio"',
      'aria-checked={isActive}',
    ],
  },
  {
    id: 'modal-focus-trap-boundary',
    file: 'src/hooks/useModalFocusTrap.ts',
    description: 'Modal focus trap keeps Tab traversal local and skips hidden keyboard targets.',
    patterns: [
      'FOCUSABLE_SELECTOR',
      "event.key !== 'Tab'",
      'container.focus()',
      'firstFocusable',
      'lastFocusable',
      '[aria-hidden="true"]',
    ],
  },
  {
    id: 'confirm-dialog-safe-focus-boundary',
    file: 'src/components/ConfirmDialog.tsx',
    description: 'ConfirmDialog focuses the safe cancel decision and lets Escape dismiss the prompt.',
    patterns: [
      'cancelButtonRef.current?.focus()',
      "event.key === 'Escape'",
      'data-focus-default="cancel"',
      'role="alertdialog"',
      'aria-modal="true"',
    ],
  },
  {
    id: 'confirm-dialog-opener-return',
    file: 'src/components/useConfirm.ts',
    description: 'useConfirm records the invoking control and restores focus after confirm or cancel settles.',
    patterns: [
      'confirmOpenerRef',
      'document.activeElement',
      'restoreConfirmOpenerFocus',
      'window.requestAnimationFrame',
      'opener.focus()',
    ],
  },
  {
    id: 'settings-focus-visible-css',
    file: 'src/app/styles/settings.css',
    description: 'Settings CSS keeps visible focus behavior on core drawer controls.',
    patterns: [
      ':focus-visible',
      '.settings-section-nav__button:focus-visible',
      '.settings-drawer .ghost-button:focus-visible',
      '.settings-toggle input:focus-visible',
    ],
  },
  {
    id: 'settings-home-focus-visible-css',
    file: 'src/app/styles/settings-home.css',
    description: 'Settings home cards and appearance controls remain keyboard-visible.',
    patterns: [
      '.settings-home-card:focus-visible',
      '.settings-appearance-switch__option:focus-visible',
    ],
  },
]

const FORBIDDEN_SOURCE_PATTERNS = [
  {
    id: 'focus-dashboard-or-workbench-chrome',
    files: [
      'docs/FOCUS_MANAGEMENT_REFERENCE_REVIEW.md',
      'src/components/SettingsDrawer.tsx',
      'src/components/SettingsHomeView.tsx',
    ],
    description: 'Focus management must not become dashboard, IDE, terminal, or workbench chrome.',
    patterns: [
      'focus-dashboard',
      'terminal approval chrome',
      'file diff chrome',
      'multi-agent task board',
      'settings-workbench',
    ],
  },
  {
    id: 'global-focus-manager',
    files: ['src/components/SettingsDrawer.tsx', 'src/components/SettingsHomeView.tsx'],
    description: 'The focus contract should stay local to SettingsDrawer instead of becoming a global focus manager.',
    patterns: [
      'window.__nexusFocusManager',
      'globalFocusManager',
      'document.body.dataset.focusManager',
    ],
  },
]

function readProjectFile(root, file) {
  const fullPath = join(root, file)
  if (!existsSync(fullPath)) return null
  return readFileSync(fullPath, 'utf8')
}

function readProjectFiles(root, files) {
  return new Map(files.map((file) => [file, readProjectFile(root, file)]))
}

function findMissingFiles(root) {
  return REQUIRED_FILES.filter((file) => !existsSync(join(root, file)))
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
  for (const rule of FORBIDDEN_SOURCE_PATTERNS) {
    for (const file of rule.files) {
      const text = files.get(file)
      if (text == null) continue
      const foundPatterns = rule.patterns.filter((pattern) => text.includes(pattern))
      if (foundPatterns.length) {
        matches.push({
          id: rule.id,
          file,
          description: rule.description,
          foundPatterns,
        })
      }
    }
  }
  return matches
}

function findFocusVisibleMotionRules(cssByFile) {
  const matches = []
  const motionPattern = /\b(?:transform|translate|scale|z-index|filter)\s*:/
  for (const [file, css] of cssByFile.entries()) {
    if (css == null) continue
    const rulePattern = /([^{}]*:focus-visible[^{}]*)\{([^{}]*)\}/g
    let match
    while ((match = rulePattern.exec(css)) !== null) {
      const selector = match[1].trim().replace(/\s+/g, ' ')
      const body = match[2]
      if (!motionPattern.test(body)) continue
      matches.push({
        id: 'focus-visible-motion-or-wrapper-lift',
        file,
        selector,
        description: 'Focus-visible rules should not rely on transform, filter, z-index, or layout movement.',
      })
    }
  }
  return matches
}

function findWeakFocusVisibleRules(cssByFile) {
  const matches = []
  const visiblePaintPattern = /\b(?:outline|box-shadow|border(?:-color|-width)?|background(?:-color)?|color|text-decoration)\s*:/
  const outlineNoneOnlyPattern = /^\s*outline\s*:\s*none\s*;?\s*$/
  for (const [file, css] of cssByFile.entries()) {
    if (css == null) continue
    const rulePattern = /([^{}]*:focus-visible[^{}]*)\{([^{}]*)\}/g
    let match
    while ((match = rulePattern.exec(css)) !== null) {
      const selector = match[1].trim().replace(/\s+/g, ' ')
      const body = match[2].trim()
      if (!visiblePaintPattern.test(body) || outlineNoneOnlyPattern.test(body)) {
        matches.push({
          id: 'weak-focus-visible-treatment',
          file,
          selector,
          description: 'Focus-visible rules must draw a visible local cue, not only remove the default outline.',
        })
      }
    }
  }
  return matches
}

function countOccurrences(text, fragment) {
  return text.split(fragment).length - 1
}

function buildSummary({ missingFiles, missingContracts, forbiddenPatterns, focusVisibleMotionRules, weakFocusVisibleRules }) {
  const errors = (
    missingFiles.length
    + missingContracts.length
    + forbiddenPatterns.length
    + focusVisibleMotionRules.length
    + weakFocusVisibleRules.length
  )
  return {
    ok: errors === 0,
    errors,
  }
}

export function buildFocusManagementSurfaceReport(root = ROOT) {
  const files = readProjectFiles(root, REQUIRED_FILES)
  const cssByFile = new Map([
    ['src/app/styles/settings.css', files.get('src/app/styles/settings.css')],
    ['src/app/styles/settings-home.css', files.get('src/app/styles/settings-home.css')],
    ['src/app/styles/settings-themes.css', files.get('src/app/styles/settings-themes.css')],
  ])
  const combinedCss = [...cssByFile.values()].filter(Boolean).join('\n')
  const settingsDrawer = files.get('src/components/SettingsDrawer.tsx') ?? ''
  const settingsHomeView = files.get('src/components/SettingsHomeView.tsx') ?? ''
  const confirmDialog = files.get('src/components/ConfirmDialog.tsx') ?? ''
  const useConfirm = files.get('src/components/useConfirm.ts') ?? ''
  const missingFiles = findMissingFiles(root)
  const missingContracts = findMissingContracts(files)
  const forbiddenPatterns = findForbiddenPatterns(files)
  const focusVisibleMotionRules = findFocusVisibleMotionRules(cssByFile)
  const weakFocusVisibleRules = findWeakFocusVisibleRules(cssByFile)

  const report = {
    audit: 'focus-management-surface',
    privacy: {
      staticSourceOnly: true,
      readsRuntimeUserData: false,
    },
    checkedFiles: REQUIRED_FILES,
    checkedContracts: REQUIRED_CONTRACTS.map((contract) => contract.id),
    focusDom: {
      focusVisibleOccurrences: countOccurrences(combinedCss, ':focus-visible'),
      outlineNoneOccurrences: countOccurrences(combinedCss, 'outline: none'),
      dialogOccurrences: countOccurrences(settingsDrawer, 'role="dialog"'),
      alertDialogOccurrences: countOccurrences(confirmDialog, 'role="alertdialog"'),
      focusReturnOccurrences: countOccurrences(settingsDrawer, 'restoreSettingsOpenerFocus'),
      homeCardFocusReturnOccurrences:
        countOccurrences(settingsDrawer, 'data-focus-return-section')
        + countOccurrences(settingsHomeView, 'data-focus-return-section'),
      confirmFocusReturnOccurrences: countOccurrences(useConfirm, 'restoreConfirmOpenerFocus'),
      safeConfirmFocusOccurrences: countOccurrences(confirmDialog, 'data-focus-default="cancel"'),
      sectionHeadingFocusOccurrences: countOccurrences(settingsDrawer, 'activeSectionHeadingRef'),
    },
    missingFiles,
    missingContracts,
    forbiddenPatterns,
    focusVisibleMotionRules,
    weakFocusVisibleRules,
  }

  return {
    ...report,
    summary: buildSummary(report),
  }
}

export function formatFocusManagementSurfaceReport(report) {
  const lines = ['Focus management surface audit']
  lines.push(`- checked files: ${report.checkedFiles.length}`)
  lines.push(`- checked contracts: ${report.checkedContracts.length}`)
  lines.push(`- focus-visible selectors: ${report.focusDom.focusVisibleOccurrences}`)
  lines.push(`- outline none occurrences: ${report.focusDom.outlineNoneOccurrences}`)
  lines.push(`- focus return markers: ${report.focusDom.focusReturnOccurrences}`)
  lines.push(`- home card focus return markers: ${report.focusDom.homeCardFocusReturnOccurrences}`)
  lines.push(`- confirm focus return markers: ${report.focusDom.confirmFocusReturnOccurrences}`)
  lines.push(`- safe confirm focus markers: ${report.focusDom.safeConfirmFocusOccurrences}`)
  lines.push(`- section heading focus markers: ${report.focusDom.sectionHeadingFocusOccurrences}`)
  lines.push('')
  lines.push(`ERROR missingFiles: ${report.missingFiles.length}`)
  lines.push(`ERROR missingContracts: ${report.missingContracts.length}`)
  lines.push(`ERROR forbiddenPatterns: ${report.forbiddenPatterns.length}`)
  lines.push(`ERROR focusVisibleMotionRules: ${report.focusVisibleMotionRules.length}`)
  lines.push(`ERROR weakFocusVisibleRules: ${report.weakFocusVisibleRules.length}`)

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

  if (report.focusVisibleMotionRules.length) {
    lines.push('')
    for (const item of report.focusVisibleMotionRules) {
      lines.push(`focus-visible motion ${item.id} in ${item.file}`)
      lines.push(`  - ${item.selector}`)
    }
  }

  if (report.weakFocusVisibleRules.length) {
    lines.push('')
    for (const item of report.weakFocusVisibleRules) {
      lines.push(`weak focus-visible treatment ${item.id} in ${item.file}`)
      lines.push(`  - ${item.selector}`)
    }
  }

  lines.push('')
  lines.push(`Summary: ok=${report.summary.ok} errors=${report.summary.errors}`)
  return lines.join('\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = buildFocusManagementSurfaceReport(ROOT)
  console.log(formatFocusManagementSurfaceReport(report))
  process.exitCode = report.summary.ok ? 0 : 1
}
