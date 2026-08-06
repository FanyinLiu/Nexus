#!/usr/bin/env node

import {
  buildSummary,
  countOccurrences,
  findForbiddenPatterns,
  findMissingContracts,
  findMissingFilesOnDisk,
  readProjectFiles,
  resolveProjectRoot,
  runAuditCli,
} from './lib/audit-framework.mjs'

const ROOT = resolveProjectRoot(import.meta.url)

const REQUIRED_FILES = [
  'docs/FOCUS_MANAGEMENT_REFERENCE_REVIEW.md',
  'src/components/SettingsDrawer.tsx',
  'src/components/SettingsDrawerV2.tsx',
  'src/components/settingsDrawerHooks/useSettingsLanguageControl.ts',
  'src/components/SettingsHomeView.tsx',
  'src/features/uiV2/SettingsShellV2.tsx',
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
      'useModalFocusTrap(settingsDialogRef, open && confirmOptions === null)',
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
    id: 'settings-v2-home-card-focus-return-targets',
    file: 'src/features/uiV2/SettingsShellV2.tsx',
    description: 'Settings V2 returns keyboard and assistive Back activation to the matching V2 group card without suppressing scroll.',
    patterns: [
      'pendingHomeFocusGroupRef.current = !isHome && intent.moveFocus ? activeDestination : null',
      'homeCardRefs.current[returnGroupId]?.focus()',
      'homeCardRefs.current[group.id] = node',
      'data-focus-return-group={group.id}',
      'handleReturnToHome(event.detail)',
    ],
  },
  {
    id: 'settings-v2-focus-handoff-isolated',
    file: 'src/components/SettingsDrawerV2.tsx',
    description: 'Settings V2 owns its Home focus target instead of allowing the legacy Settings home ref to steal focus.',
    patterns: [
      'onReturnToSettingsHome(false)',
    ],
  },
  {
    id: 'settings-menu-keyboard-exit',
    file: 'src/components/settingsDrawerHooks/useSettingsLanguageControl.ts',
    description: 'The language controller keeps latest-wins loading, keyboard exit, and trigger focus return.',
    patterns: [
      'handleLanguageMenuItemKeyDown',
      'openLanguageMenuAt(selectedLanguageIndex)',
      'languageLoadGenerationRef',
      "event.key === 'Escape'",
      'languageButtonRef.current?.focus()',
    ],
  },
  {
    id: 'settings-menu-dom-contract',
    file: 'src/components/SettingsDrawer.tsx',
    description: 'The SettingsDrawer preserves the language menu DOM and radio semantics.',
    patterns: [
      'role="menuitemradio"',
      'aria-checked={isActive}',
      'tabIndex={isActive ? 0 : -1}',
    ],
  },
  {
    id: 'modal-focus-trap-boundary',
    file: 'src/hooks/useModalFocusTrap.ts',
    description: 'Modal focus trap keeps Tab traversal local via a pure boundary decision helper and skips hidden keyboard targets.',
    patterns: [
      'FOCUSABLE_SELECTOR',
      "event.key !== 'Tab'",
      'export function resolveModalTabFocusDecision',
      'export function getFocusableElements',
      'container.contains(activeElement)',
      'focusInsideContainer',
      "decision === 'first'",
      "decision === 'last'",
      '[aria-hidden="true"]',
      'event.preventDefault()',
      'target.focus()',
    ],
  },
  {
    id: 'confirm-dialog-safe-focus-boundary',
    file: 'src/components/ConfirmDialog.tsx',
    description: 'ConfirmDialog owns the topmost modal trap, names itself from visible title/body ids, focuses the safe cancel decision, and lets Escape dismiss the prompt.',
    patterns: [
      'useId()',
      'useModalFocusTrap(dialogRef, options !== null)',
      'ref={dialogRef}',
      'const titleId = useId()',
      'const messageId = useId()',
      'cancelButtonRef.current?.focus()',
      "event.key === 'Escape'",
      'data-focus-default="cancel"',
      'role="alertdialog"',
      'aria-modal="true"',
      'aria-labelledby={options.title ? titleId : messageId}',
      'aria-describedby={options.title ? messageId : undefined}',
      'id={titleId}',
      'id={messageId}',
      'type="button"',
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
      '.sd .ghost-button:focus-visible',
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
  const settingsShellV2 = files.get('src/features/uiV2/SettingsShellV2.tsx') ?? ''
  const confirmDialog = files.get('src/components/ConfirmDialog.tsx') ?? ''
  const useConfirm = files.get('src/components/useConfirm.ts') ?? ''
  const missingFiles = findMissingFilesOnDisk(root, REQUIRED_FILES)
  const missingContracts = findMissingContracts(files, REQUIRED_CONTRACTS)
  const forbiddenPatterns = findForbiddenPatterns(files, FORBIDDEN_SOURCE_PATTERNS)
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
        + countOccurrences(settingsHomeView, 'data-focus-return-section')
        + countOccurrences(settingsShellV2, 'data-focus-return-group'),
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
    summary: buildSummary({ missingFiles, missingContracts, forbiddenPatterns, focusVisibleMotionRules, weakFocusVisibleRules }),
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

runAuditCli({
  importMetaUrl: import.meta.url,
  root: ROOT,
  buildReport: buildFocusManagementSurfaceReport,
  formatReport: formatFocusManagementSurfaceReport,
})
