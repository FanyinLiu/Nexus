import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { buildFocusManagementSurfaceReport } from '../scripts/focus-management-surface-audit.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const BASELINE_FILES: Record<string, string> = {
  'docs/FOCUS_MANAGEMENT_REFERENCE_REVIEW.md': `
# Focus Management Surface Reference Review

focus-management is an accessibility interaction contract layer.
keyboard users must always know where they are.
Drawer close restores focus to the opener.
Section changes programmatically focus the new section heading.
Focus-visible rules must not only remove the browser outline.

- Radix UI Primitives
- assistant-ui
- Cline
`,
  'src/components/SettingsDrawer.tsx': `
export function SettingsDrawer() {
  const settingsDialogRef = useRef(null)
  const settingsOpenerRef = useRef(null)
  const settingsHomeCardRefs = useRef({})
  const activeSectionHeadingRef = useRef(null)
  useModalFocusTrap(settingsDialogRef, open)
  function restoreSettingsOpenerFocus() {}
  function resetSettingsSectionScroll() {
    drawerBodyRef.current?.scrollTo({ top: 0, behavior: 'auto' })
  }
  useLayoutEffect(() => {
    resetSettingsSectionScroll()
  }, [activeSectionId])
  function handleLanguageMenuItemKeyDown(event) {
    if (event.key === 'Escape') languageButtonRef.current?.focus()
  }
  activeSectionHeadingRef.current?.focus({ preventScroll: true })
  return (
    <aside role="dialog" aria-modal="true" tabIndex={-1}>
      <button role="menuitemradio" aria-checked={isActive} />
      <h4 ref={activeSectionHeadingRef} tabIndex={-1}>Privacy</h4>
    </aside>
  )
}
`,
  'src/components/SettingsHomeView.tsx': `
export function SettingsHomeView() {
  settingsHomeCardRefs.current[card.sectionId] = node
  return <button className="settings-home-card" data-focus-return-section={card.sectionId} onClick={() => onOpenSettingsSection(card.sectionId)} />
}
`,
  'src/components/ConfirmDialog.tsx': `
export function ConfirmDialog() {
  cancelButtonRef.current?.focus()
  if (event.key === 'Escape') onCancel()
  return (
    <div role="alertdialog" aria-modal="true">
      <button data-focus-default="cancel">Cancel</button>
    </div>
  )
}
`,
  'src/components/useConfirm.ts': `
export function useConfirm() {
  const confirmOpenerRef = useRef(null)
  const activeElement = document.activeElement
  function restoreConfirmOpenerFocus() {
    window.requestAnimationFrame(() => {
      opener.focus()
    })
  }
}
`,
  'src/hooks/useModalFocusTrap.ts': `
const FOCUSABLE_SELECTOR = '[aria-hidden="true"]'
export function useModalFocusTrap() {
  if (event.key !== 'Tab') return
  container.focus()
  firstFocusable.focus()
  lastFocusable.focus()
}
`,
  'src/app/styles/settings.css': `
.settings-section-nav__button:focus-visible { outline: 2px solid rgba(91, 129, 226, 0.6); }
.settings-drawer .ghost-button:focus-visible { box-shadow: 0 0 0 3px rgba(91, 129, 226, 0.18); }
.settings-toggle input:focus-visible { border-color: rgba(91, 129, 226, 0.7); }
`,
  'src/app/styles/settings-home.css': `
.settings-home-card:focus-visible { box-shadow: 0 0 0 3px rgba(91, 129, 226, 0.18); }
.settings-appearance-switch__option:focus-visible { outline: 2px solid rgba(91, 129, 226, 0.6); }
`,
  'src/app/styles/settings-themes.css': '.settings-drawer--day .settings-toggle input:focus-visible { box-shadow: 0 0 0 3px rgba(91, 129, 226, 0.18); }',
}

function createFixture(overrides: Record<string, string | null> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'nexus-focus-management-surface-audit-'))
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

test('focus management surface audit passes the protected focus contract', () => {
  withFixture({}, (root) => {
    const report = buildFocusManagementSurfaceReport(root)

    assert.equal(report.summary.ok, true)
    assert.equal(report.summary.errors, 0)
    assert.equal(report.privacy.staticSourceOnly, true)
    assert.ok(report.focusDom.focusVisibleOccurrences >= 3)
    assert.ok(report.focusDom.focusReturnOccurrences >= 1)
    assert.ok(report.focusDom.homeCardFocusReturnOccurrences >= 1)
    assert.ok(report.focusDom.confirmFocusReturnOccurrences >= 1)
    assert.ok(report.focusDom.safeConfirmFocusOccurrences >= 1)
  })
})

test('focus management surface audit rejects missing Pro contract phrases', () => {
  withFixture({
    'docs/FOCUS_MANAGEMENT_REFERENCE_REVIEW.md': BASELINE_FILES['docs/FOCUS_MANAGEMENT_REFERENCE_REVIEW.md'].replace(
      'accessibility interaction contract layer',
      'generic keyboard polish',
    ),
  }, (root) => {
    const report = buildFocusManagementSurfaceReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.missingContracts.some((item) => item.id === 'focus-pro-contract-recorded'))
  })
})

test('focus management surface audit rejects missing opener focus return', () => {
  withFixture({
    'src/components/SettingsDrawer.tsx': BASELINE_FILES['src/components/SettingsDrawer.tsx'].replace(
      '  const settingsOpenerRef = useRef(null)\n',
      '',
    ).replace(
      '  function restoreSettingsOpenerFocus() {}\n',
      '',
    ),
  }, (root) => {
    const report = buildFocusManagementSurfaceReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.missingContracts.some((item) => item.id === 'settings-drawer-focus-handoff'))
  })
})

test('focus management surface audit rejects missing settings home card focus return', () => {
  withFixture({
    'src/components/SettingsHomeView.tsx': BASELINE_FILES['src/components/SettingsHomeView.tsx'].replace(
      ' data-focus-return-section={card.sectionId}',
      '',
    ),
  }, (root) => {
    const report = buildFocusManagementSurfaceReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.missingContracts.some((item) => item.id === 'settings-home-card-focus-return-targets'))
  })
})

test('focus management surface audit rejects focus-visible motion tricks', () => {
  withFixture({
    'src/app/styles/settings.css': `${BASELINE_FILES['src/app/styles/settings.css']}
.settings-section-nav__button:focus-visible { transform: translateY(-2px); }
`,
  }, (root) => {
    const report = buildFocusManagementSurfaceReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.focusVisibleMotionRules.some((item) => item.id === 'focus-visible-motion-or-wrapper-lift'))
  })
})

test('focus management surface audit rejects weak focus-visible treatment', () => {
  withFixture({
    'src/app/styles/settings.css': BASELINE_FILES['src/app/styles/settings.css'].replace(
      '.settings-section-nav__button:focus-visible { outline: 2px solid rgba(91, 129, 226, 0.6); }',
      '.settings-section-nav__button:focus-visible { outline: none; }',
    ),
  }, (root) => {
    const report = buildFocusManagementSurfaceReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.weakFocusVisibleRules.some((item) => item.id === 'weak-focus-visible-treatment'))
  })
})

test('focus management surface audit rejects missing safe confirmation focus boundary', () => {
  withFixture({
    'src/components/ConfirmDialog.tsx': BASELINE_FILES['src/components/ConfirmDialog.tsx'].replace(
      ' data-focus-default="cancel"',
      '',
    ),
  }, (root) => {
    const report = buildFocusManagementSurfaceReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.missingContracts.some((item) => item.id === 'confirm-dialog-safe-focus-boundary'))
  })
})

test('focus management surface audit rejects missing confirmation opener return', () => {
  withFixture({
    'src/components/useConfirm.ts': BASELINE_FILES['src/components/useConfirm.ts'].replace(
      '  const confirmOpenerRef = useRef(null)\n',
      '',
    ).replace(
      '  function restoreConfirmOpenerFocus() {\n    window.requestAnimationFrame(() => {\n      opener.focus()\n    })\n  }\n',
      '',
    ),
  }, (root) => {
    const report = buildFocusManagementSurfaceReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.missingContracts.some((item) => item.id === 'confirm-dialog-opener-return'))
  })
})

test('focus management surface audit runs against the repository', () => {
  const report = buildFocusManagementSurfaceReport(ROOT)

  assert.equal(report.summary.ok, true)
  assert.equal(report.summary.errors, 0)
})
