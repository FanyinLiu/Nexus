import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'

class MemoryStorage {
  private data = new Map<string, string>()

  getItem(key: string) {
    return this.data.has(key) ? this.data.get(key)! : null
  }

  setItem(key: string, value: string) {
    this.data.set(key, String(value))
  }

  removeItem(key: string) {
    this.data.delete(key)
  }

  clear() {
    this.data.clear()
  }
}

Object.defineProperty(globalThis, 'window', {
  value: {
    localStorage: new MemoryStorage(),
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    addEventListener: () => {},
  },
  configurable: true,
  writable: true,
})

// Node exposes BroadcastChannel globally; storage/core opens one when a window
// object exists, which keeps node:test alive. Renderer builds still get the
// real browser BroadcastChannel.
Object.defineProperty(globalThis, 'BroadcastChannel', {
  value: undefined,
  configurable: true,
})

const { planStore } = await import('../src/features/plan/planStore.ts')

beforeEach(() => {
  window.localStorage.clear()
  planStore.clear()
})

afterEach(async () => {
  planStore.clear()
  await new Promise((resolve) => setTimeout(resolve, 550))
})

test('PlanStore creates active plans and progresses steps to completion', () => {
  const plan = planStore.create('ship feature', ['inspect', 'fix'])
  assert.equal(plan.status, 'active')
  assert.equal(plan.steps.length, 2)

  const started = planStore.startStep(plan.id, plan.steps[0].id)
  assert.equal(started?.steps[0].status, 'in_progress')
  assert.equal(typeof started?.steps[0].startedAt, 'number')

  const firstDone = planStore.markStepDone(plan.id, plan.steps[0].id, 'done')
  assert.equal(firstDone?.status, 'active')
  assert.equal(firstDone?.steps[0].status, 'completed')
  assert.equal(firstDone?.steps[0].result, 'done')

  const finalDone = planStore.markStepDone(plan.id, plan.steps[1].id)
  assert.equal(finalDone?.status, 'completed')
})

test('PlanStore normalizes blank goals and filters blank steps', () => {
  const draft = planStore.create('   ', ['  ', '\n'])
  assert.equal(draft.goal, 'Untitled plan')
  assert.equal(draft.status, 'draft')
  assert.deepEqual(draft.steps, [])

  const plan = planStore.create('  ship feature  ', ['  inspect  ', '', ' fix\n'])
  assert.equal(plan.goal, 'ship feature')
  assert.equal(plan.status, 'active')
  assert.deepEqual(plan.steps.map((step) => step.text), ['inspect', 'fix'])
})

test('PlanStore returns immutable snapshots instead of live internal objects', () => {
  const created = planStore.create('avoid leaks', ['step'])
  const listed = planStore.list()[0]
  const fetched = planStore.get(created.id)

  listed.goal = 'mutated from list'
  listed.steps[0].status = 'completed'
  if (fetched) {
    fetched.goal = 'mutated from get'
    fetched.steps[0].text = 'changed text'
  }

  const current = planStore.get(created.id)
  assert.equal(current?.goal, 'avoid leaks')
  assert.equal(current?.steps[0].text, 'step')
  assert.equal(current?.steps[0].status, 'pending')
})

test('PlanStore subscribers receive snapshots that cannot mutate store state', () => {
  const snapshots: ReturnType<typeof planStore.list>[] = []
  const unsubscribe = planStore.subscribe((plans) => {
    snapshots.push(plans)
    if (plans[0]) {
      plans[0].goal = 'listener mutation'
      plans[0].steps[0].status = 'failed'
    }
  })

  const plan = planStore.create('subscriber isolation', ['step'])
  unsubscribe()

  const current = planStore.get(plan.id)
  assert.equal(current?.goal, 'subscriber isolation')
  assert.equal(current?.steps[0].status, 'pending')
  assert.ok(snapshots.length >= 2)
})

test('PlanStore missing step updates are no-ops and do not publish snapshots', () => {
  const snapshots: ReturnType<typeof planStore.list>[] = []
  const unsubscribe = planStore.subscribe((plans) => {
    snapshots.push(plans)
  })

  const plan = planStore.create('no noisy updates', ['step'])
  const beforeCount = snapshots.length
  const beforeUpdatedAt = planStore.get(plan.id)?.updatedAt

  assert.equal(planStore.startStep(plan.id, 'missing-step'), undefined)
  assert.equal(planStore.markStepDone(plan.id, 'missing-step'), undefined)
  assert.equal(planStore.markStepFailed(plan.id, 'missing-step', 'failed'), undefined)

  assert.equal(snapshots.length, beforeCount)
  assert.equal(planStore.get(plan.id)?.updatedAt, beforeUpdatedAt)
  unsubscribe()
})

test('PlanStore abort marks the in-progress step failed with the reason', () => {
  const plan = planStore.create('abort flow', ['running', 'pending'])
  planStore.startStep(plan.id, plan.steps[0].id)

  const aborted = planStore.abort(plan.id, 'stop now')

  assert.equal(aborted?.status, 'aborted')
  assert.equal(aborted?.steps[0].status, 'failed')
  assert.equal(aborted?.steps[0].result, 'stop now')
  assert.equal(aborted?.steps[1].status, 'pending')
})

test('PlanStore terminal plans ignore late updates and cannot be resurrected', () => {
  const completed = planStore.create('completed flow', ['finish'])
  planStore.markStepDone(completed.id, completed.steps[0].id)
  const afterCompleted = planStore.get(completed.id)

  assert.equal(planStore.startStep(completed.id, completed.steps[0].id), undefined)
  assert.equal(planStore.markStepFailed(completed.id, completed.steps[0].id, 'late failure'), undefined)
  assert.equal(planStore.setSteps(completed.id, ['new step']), undefined)
  assert.equal(planStore.abort(completed.id, 'late abort'), undefined)
  assert.deepEqual(planStore.get(completed.id), afterCompleted)

  const aborted = planStore.create('aborted flow', ['running'])
  planStore.startStep(aborted.id, aborted.steps[0].id)
  planStore.abort(aborted.id, 'stop now')
  const afterAborted = planStore.get(aborted.id)

  assert.equal(planStore.markStepDone(aborted.id, aborted.steps[0].id), undefined)
  assert.equal(planStore.setSteps(aborted.id, ['new step']), undefined)
  assert.deepEqual(planStore.get(aborted.id), afterAborted)
})

test('PlanStore clear and remove publish consistent snapshots', () => {
  const first = planStore.create('first', ['a'])
  planStore.create('second', ['b'])
  assert.equal(planStore.list().length, 2)

  planStore.remove(first.id)
  assert.equal(planStore.list().length, 1)
  assert.equal(planStore.list()[0].goal, 'second')

  planStore.clear()
  assert.deepEqual(planStore.list(), [])
})
