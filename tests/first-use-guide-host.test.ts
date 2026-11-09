import assert from 'node:assert/strict'
import test from 'node:test'
import {
  FIRST_USE_PANEL_TRANSIENT_SURFACE_SELECTORS,
  createFirstUsePanelHandoff,
  hasOpenFirstUsePanelTransientSurface,
  resolveFirstUseGuideHost,
  shouldRetireFirstUsePanel,
} from '../src/features/onboarding/firstUseGuideHost.ts'

test('first-use Electron pet delegates before showing a credential form', () => {
  assert.equal(resolveFirstUseGuideHost({ pending: true, view: 'pet', canOpenPanel: true }), 'panel')
})

test('first-use panel and browser preview keep the shared local guide', () => {
  assert.equal(resolveFirstUseGuideHost({ pending: true, view: 'panel', canOpenPanel: true }), 'local')
  assert.equal(resolveFirstUseGuideHost({ pending: true, view: 'pet', canOpenPanel: false }), 'local')
  assert.equal(resolveFirstUseGuideHost({ pending: true, view: 'panel', canOpenPanel: false }), 'local')
})

test('completed setup never requests an initial guide or panel', () => {
  for (const view of ['pet', 'panel'] as const) {
    for (const canOpenPanel of [false, true]) {
      assert.equal(resolveFirstUseGuideHost({ pending: false, view, canOpenPanel }), 'none')
    }
  }
})

test('only a pristine completed first-use panel may be retired', () => {
  const pristine = {
    firstUsePanel: true,
    onboardingPending: false,
    onboardingOpen: false,
    settingsOpen: false,
    busy: false,
    hasDraft: false,
    hasPendingImage: false,
    hasUserMessage: false,
    voiceActive: false,
    petRuntimeOnline: true,
  }
  assert.equal(shouldRetireFirstUsePanel(pristine), true)
  assert.equal(shouldRetireFirstUsePanel({ ...pristine, firstUsePanel: false }), false)
  assert.equal(shouldRetireFirstUsePanel({ ...pristine, onboardingPending: true }), false)
  assert.equal(shouldRetireFirstUsePanel({ ...pristine, onboardingOpen: true }), false)
  assert.equal(shouldRetireFirstUsePanel({ ...pristine, settingsOpen: true }), false)
  assert.equal(shouldRetireFirstUsePanel({ ...pristine, busy: true }), false)
  assert.equal(shouldRetireFirstUsePanel({ ...pristine, hasDraft: true }), false)
  assert.equal(shouldRetireFirstUsePanel({ ...pristine, hasPendingImage: true }), false)
  assert.equal(shouldRetireFirstUsePanel({ ...pristine, hasUserMessage: true }), false)
  assert.equal(shouldRetireFirstUsePanel({ ...pristine, voiceActive: true }), false)
  assert.equal(shouldRetireFirstUsePanel({ ...pristine, petRuntimeOnline: false }), false)
})

test('the transient-surface whitelist is exact and blocks a visible overlay', () => {
  assert.deepEqual([...FIRST_USE_PANEL_TRANSIENT_SURFACE_SELECTORS], [
    '.chat-sheet-v2',
    '.settings-v2',
    '.sd',
    '.onboarding-card',
    '.sunday-letter-reader',
    '[role="dialog"]',
  ])
  const selectors: string[] = []
  const root = {
    querySelector: (selector: string) => {
      selectors.push(selector)
      return selector.includes('.onboarding-card') ? {} : null
    },
  }
  assert.equal(hasOpenFirstUsePanelTransientSurface(root), true)
  assert.equal(selectors.length, 1)
  assert.equal(hasOpenFirstUsePanelTransientSurface(null), false)
})

test('repeated effect subscriptions share one panel launch and its completion', async () => {
  let calls = 0
  let finish!: () => void
  const launched = new Promise<void>((resolve) => { finish = resolve })
  const handoff = createFirstUsePanelHandoff({ openPanel: () => { calls += 1; return launched } })
  const first = handoff()
  const second = handoff()
  assert.equal(first, second)
  await Promise.resolve()
  assert.equal(calls, 1)
  finish()
  await first
  assert.equal(handoff(), first)
  assert.equal(calls, 1)
})

test('handoff failures remain rejected without an automatic relaunch loop', async () => {
  const failure = new Error('Synthetic panel launch failure')
  let calls = 0
  const handoff = createFirstUsePanelHandoff({ openPanel: async () => { calls += 1; throw failure } })
  await assert.rejects(handoff(), (error) => error === failure)
  await assert.rejects(handoff(), (error) => error === failure)
  assert.equal(calls, 1)
})

test('a synchronous bridge failure follows the same recoverable rejection path', async () => {
  const failure = new Error('Synthetic disconnected bridge')
  const handoff = createFirstUsePanelHandoff({ openPanel: () => { throw failure } })
  await assert.rejects(handoff(), (error) => error === failure)
})
