import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveModalTabFocusDecision } from '../src/hooks/useModalFocusTrap.ts'

function decide(options: {
  focusableCount: number
  activeIndex: number
  shiftKey: boolean
  focusInsideContainer?: boolean
}) {
  return resolveModalTabFocusDecision({
    focusableCount: options.focusableCount,
    activeIndex: options.activeIndex,
    shiftKey: options.shiftKey,
    focusInsideContainer: options.focusInsideContainer ?? true,
  })
}

test('two-button confirm dialog: Cancel Tab stays native (no trap decision)', () => {
  // Cancel is index 0; forward Tab is interior and must not preventDefault.
  assert.equal(
    decide({ focusableCount: 2, activeIndex: 0, shiftKey: false }),
    null,
  )
})

test('two-button confirm dialog: Confirm Tab wraps to first (Cancel)', () => {
  assert.equal(
    decide({ focusableCount: 2, activeIndex: 1, shiftKey: false }),
    'first',
  )
})

test('two-button confirm dialog: Cancel Shift+Tab wraps to last (Confirm)', () => {
  assert.equal(
    decide({ focusableCount: 2, activeIndex: 0, shiftKey: true }),
    'last',
  )
})

test('two-button confirm dialog: Confirm Shift+Tab stays native (no trap decision)', () => {
  assert.equal(
    decide({ focusableCount: 2, activeIndex: 1, shiftKey: true }),
    null,
  )
})

test('empty focusable list focuses the container', () => {
  assert.equal(
    decide({ focusableCount: 0, activeIndex: -1, shiftKey: false }),
    'container',
  )
  assert.equal(
    decide({ focusableCount: 0, activeIndex: 0, shiftKey: true, focusInsideContainer: false }),
    'container',
  )
})

test('focus outside the modal is pulled to the first or last control', () => {
  assert.equal(
    decide({ focusableCount: 2, activeIndex: -1, shiftKey: false, focusInsideContainer: false }),
    'first',
  )
  assert.equal(
    decide({ focusableCount: 2, activeIndex: -1, shiftKey: true, focusInsideContainer: false }),
    'last',
  )
})

test('non-tabbable focus inside the modal stays native (section heading handoff)', () => {
  // Settings focuses a tabIndex={-1} heading; Tab must not jump to drawer chrome.
  assert.equal(
    decide({ focusableCount: 5, activeIndex: -1, shiftKey: false, focusInsideContainer: true }),
    null,
  )
  assert.equal(
    decide({ focusableCount: 5, activeIndex: -1, shiftKey: true, focusInsideContainer: true }),
    null,
  )
})

test('single focusable control wraps both Tab directions onto itself', () => {
  assert.equal(
    decide({ focusableCount: 1, activeIndex: 0, shiftKey: false }),
    'first',
  )
  assert.equal(
    decide({ focusableCount: 1, activeIndex: 0, shiftKey: true }),
    'last',
  )
})

test('three-control modal only traps the first/last edges', () => {
  const cases: Array<{
    activeIndex: number
    shiftKey: boolean
    expected: ReturnType<typeof resolveModalTabFocusDecision>
  }> = [
    { activeIndex: 0, shiftKey: false, expected: null },
    { activeIndex: 1, shiftKey: false, expected: null },
    { activeIndex: 2, shiftKey: false, expected: 'first' },
    { activeIndex: 0, shiftKey: true, expected: 'last' },
    { activeIndex: 1, shiftKey: true, expected: null },
    { activeIndex: 2, shiftKey: true, expected: null },
  ]

  for (const testCase of cases) {
    assert.equal(
      decide({
        focusableCount: 3,
        activeIndex: testCase.activeIndex,
        shiftKey: testCase.shiftKey,
      }),
      testCase.expected,
      `activeIndex=${testCase.activeIndex} shiftKey=${testCase.shiftKey}`,
    )
  }
})

test('ConfirmDialog source keeps trap ownership, safe cancel focus, and labelled name/description', async () => {
  const { readFile } = await import('node:fs/promises')
  const source = await readFile(new URL('../src/components/ConfirmDialog.tsx', import.meta.url), 'utf8')

  assert.match(source, /useModalFocusTrap\(dialogRef,\s*options\s*!==\s*null\)/)
  assert.match(source, /cancelButtonRef\.current\?\.focus\(\)/)
  assert.match(source, /data-focus-default="cancel"/)
  assert.match(source, /role="alertdialog"/)
  assert.match(source, /aria-labelledby=\{options\.title \? titleId : messageId\}/)
  assert.match(source, /aria-describedby=\{options\.title \? messageId : undefined\}/)
  assert.match(source, /event\.key === 'Escape'/)
  // Cancel is the first action button so initial focus + first tab stop stay safe.
  assert.match(
    source,
    /data-focus-default="cancel"[\s\S]*?<button[\s\S]*?onClick=\{onConfirm\}/,
  )
})

test('SettingsDrawer pauses its outer trap while ConfirmDialog is open', async () => {
  const { readFile } = await import('node:fs/promises')
  const source = await readFile(new URL('../src/components/SettingsDrawer.tsx', import.meta.url), 'utf8')

  assert.match(
    source,
    /useModalFocusTrap\(settingsDialogRef,\s*open\s*&&\s*confirmOptions\s*===\s*null\)/,
  )
  assert.match(source, /<ConfirmDialog\b/)
  assert.match(source, /options=\{confirmOptions\}/)
})

test('useModalFocusTrap wires containment + pure boundary helper', async () => {
  const { readFile } = await import('node:fs/promises')
  const source = await readFile(new URL('../src/hooks/useModalFocusTrap.ts', import.meta.url), 'utf8')

  assert.match(source, /export function resolveModalTabFocusDecision/)
  assert.match(source, /export function getFocusableElements/)
  assert.match(source, /resolveModalTabFocusDecision\(\{/)
  assert.match(source, /container\.contains\(activeElement\)/)
  assert.match(source, /focusInsideContainer/)
  assert.match(source, /if \(!target\) return/)
  assert.match(source, /event\.preventDefault\(\)/)
  assert.match(source, /target\.focus\(\)/)
  // Interior Tab remains native sequential focus — documented contract.
  assert.match(source, /Interior Tab[\s\S]*intentionally native/)
})
