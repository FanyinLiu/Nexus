import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createFirstUsePanelHandoff,
  resolveFirstUseGuideHost,
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
