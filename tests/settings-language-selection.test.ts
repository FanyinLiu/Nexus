import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  createLanguageSelectionCoordinator,
  type LanguageSelectionOutcome,
} from '../src/components/settingsLanguageSelection.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

test('immediate loaded locale applies without awaiting ensureLocaleLoaded', async () => {
  const applied: string[] = []
  let ensureCalls = 0
  const coordinator = createLanguageSelectionCoordinator({
    isLocaleLoaded: () => true,
    ensureLocaleLoaded: async () => {
      ensureCalls += 1
    },
    applyLanguage: (locale) => {
      applied.push(locale)
    },
    isActive: () => true,
  })

  const outcome = await coordinator.selectLanguage('en-US')
  assert.equal(outcome, 'applied')
  assert.deepEqual(applied, ['en-US'])
  assert.equal(ensureCalls, 0)
})

test('delayed load applies once the locale module resolves', async () => {
  const applied: string[] = []
  const load = deferred<void>()
  const coordinator = createLanguageSelectionCoordinator({
    isLocaleLoaded: () => false,
    ensureLocaleLoaded: () => load.promise,
    applyLanguage: (locale) => {
      applied.push(locale)
    },
    isActive: () => true,
  })

  const pending = coordinator.selectLanguage('ja')
  assert.deepEqual(applied, [])
  load.resolve()
  const outcome = await pending
  assert.equal(outcome, 'applied')
  assert.deepEqual(applied, ['ja'])
})

test('out-of-order loads keep the latest selection', async () => {
  const applied: string[] = []
  const first = deferred<void>()
  const second = deferred<void>()
  const loads: Record<string, Promise<void>> = {
    'en-US': first.promise,
    ja: second.promise,
  }
  const coordinator = createLanguageSelectionCoordinator({
    isLocaleLoaded: () => false,
    ensureLocaleLoaded: (locale) => loads[locale] ?? Promise.resolve(),
    applyLanguage: (locale) => {
      applied.push(locale)
    },
    isActive: () => true,
  })

  const firstSelect = coordinator.selectLanguage('en-US')
  const secondSelect = coordinator.selectLanguage('ja')

  // Older request finishes last.
  second.resolve()
  first.resolve()

  const outcomes = await Promise.all([firstSelect, secondSelect])
  assert.deepEqual(outcomes, ['ignored-stale', 'applied'])
  assert.deepEqual(applied, ['ja'])
})

test('invalidate on close/unmount drops late applications', async () => {
  const applied: string[] = []
  const load = deferred<void>()
  let active = true
  const coordinator = createLanguageSelectionCoordinator({
    isLocaleLoaded: () => false,
    ensureLocaleLoaded: () => load.promise,
    applyLanguage: (locale) => {
      applied.push(locale)
    },
    isActive: () => active,
  })

  const pending = coordinator.selectLanguage('ko')
  coordinator.invalidate()
  active = false
  load.resolve()

  const outcome = await pending
  assert.equal(outcome, 'ignored-stale')
  assert.deepEqual(applied, [])
})

test('inactive drawer without generation bump is reported, not applied', async () => {
  const applied: string[] = []
  const coordinator = createLanguageSelectionCoordinator({
    isLocaleLoaded: () => true,
    ensureLocaleLoaded: async () => undefined,
    applyLanguage: (locale) => {
      applied.push(locale)
    },
    isActive: () => false,
  })

  const outcome = await coordinator.selectLanguage('zh-TW')
  assert.equal(outcome, 'ignored-inactive')
  assert.deepEqual(applied, [])
})

test('load failure falls back to applying the draft when still current', async () => {
  const applied: string[] = []
  const failures: Array<{ locale: string; error: unknown }> = []
  const coordinator = createLanguageSelectionCoordinator({
    isLocaleLoaded: () => false,
    ensureLocaleLoaded: async () => {
      throw new Error('chunk missing')
    },
    applyLanguage: (locale) => {
      applied.push(locale)
    },
    isActive: () => true,
    onLoadFailure: (locale, error) => {
      failures.push({ locale, error })
    },
  })

  const outcome = await coordinator.selectLanguage('en-US')
  assert.equal(outcome, 'failed-applied')
  assert.deepEqual(applied, ['en-US'])
  assert.equal(failures.length, 1)
  assert.equal(failures[0]?.locale, 'en-US')
})

test('load failure after invalidate does not apply', async () => {
  const applied: string[] = []
  const load = deferred<void>()
  const coordinator = createLanguageSelectionCoordinator({
    isLocaleLoaded: () => false,
    ensureLocaleLoaded: () => load.promise,
    applyLanguage: (locale) => {
      applied.push(locale)
    },
    isActive: () => true,
  })

  const pending = coordinator.selectLanguage('en-US')
  coordinator.invalidate()
  load.reject(new Error('aborted'))

  const outcome: LanguageSelectionOutcome = await pending
  assert.equal(outcome, 'failed-ignored-stale')
  assert.deepEqual(applied, [])
})

test('selection never silently no-ops when locale is already loaded and active', async () => {
  let applied = 0
  const coordinator = createLanguageSelectionCoordinator({
    isLocaleLoaded: (locale) => locale === 'zh-CN',
    ensureLocaleLoaded: async () => {
      throw new Error('should not load zh-CN')
    },
    applyLanguage: () => {
      applied += 1
    },
    isActive: () => true,
  })

  assert.equal(await coordinator.selectLanguage('zh-CN'), 'applied')
  assert.equal(applied, 1)
})

test('SettingsDrawer wires coordinator, open ref, focus return, and menu stacking elevation', () => {
  const drawer = readFileSync(join(ROOT, 'src/components/SettingsDrawer.tsx'), 'utf8')
  const hook = readFileSync(join(ROOT, 'src/components/settingsDrawerHooks/useSettingsLanguageControl.ts'), 'utf8')

  assert.match(drawer, /useSettingsLanguageControl/)
  assert.match(hook, /createLanguageSelectionCoordinator/)
  assert.match(hook, /settingsLanguageSelection/)
  assert.match(hook, /drawerOpenRef/)
  assert.match(hook, /useLayoutEffect\(\(\) => \{[\s\S]*?drawerOpenRef\.current = open/)
  assert.match(hook, /languageLoadGenerationRef/)
  assert.match(hook, /closeLanguageMenuAndRestoreFocus/)
  assert.match(hook, /languageButtonRef\.current\?\.focus\(\)/)
  assert.match(hook, /handleSelectLanguage/)
  assert.match(drawer, /languageMenuOpen \? \{ zIndex: 5 \}/)
  assert.match(drawer, /settings-home-presence/)
  assert.doesNotMatch(
    hook,
    /if \(open && languageLoadGenerationRef\.current === requestGeneration\)/,
  )
  assert.match(hook, /isActive: \(\) => drawerOpenRef\.current/)
  assert.match(hook, /languageSelectionRef\.current\?\.invalidate\(\)/)
})

test('focus audit baseline keeps language generation and menuitemradio contracts concrete', () => {
  const audit = readFileSync(join(ROOT, 'scripts/focus-management-surface-audit.mjs'), 'utf8')
  const drawer = readFileSync(join(ROOT, 'src/components/SettingsDrawer.tsx'), 'utf8')
  const hook = readFileSync(join(ROOT, 'src/components/settingsDrawerHooks/useSettingsLanguageControl.ts'), 'utf8')

  for (const token of [
    'languageLoadGenerationRef',
    'handleLanguageMenuItemKeyDown',
    'openLanguageMenuAt(selectedLanguageIndex)',
    "event.key === 'Escape'",
    'languageButtonRef.current?.focus()',
  ] as const) {
    assert.ok(audit.includes(token), `audit should require ${token}`)
    assert.ok(hook.includes(token), `language hook should implement ${token}`)
  }
  for (const token of ['role="menuitemradio"', 'aria-checked={isActive}', 'tabIndex={isActive ? 0 : -1}'] as const) {
    assert.ok(audit.includes(token), `audit should require ${token}`)
    assert.ok(drawer.includes(token), `drawer should implement ${token}`)
  }

  // Stronger than regex-only: behavior stays in the hook while DOM stays in the drawer.
  assert.ok(hook.includes('createLanguageSelectionCoordinator'))
  assert.ok(hook.includes('ensureLocaleLoaded'))
  assert.ok(drawer.includes('closeLanguageMenuAndRestoreFocus()'))
  assert.ok(drawer.includes('role="menuitemradio"'))
  assert.ok(drawer.includes('aria-checked={isActive}'))
})
