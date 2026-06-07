import assert from 'node:assert/strict'
import { test } from 'node:test'

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
    setTimeout: (handler: TimerHandler, _timeout?: number, ...args: unknown[]) => (
      setTimeout(handler as () => void, 0, ...args) as unknown as number
    ),
    clearTimeout: (id?: number) => clearTimeout(id as unknown as NodeJS.Timeout),
    addEventListener: () => {},
  },
  configurable: true,
  writable: true,
})

Object.defineProperty(globalThis, 'BroadcastChannel', {
  value: undefined,
  configurable: true,
})

const {
  AGENT_TRACE_STORAGE_KEY,
  BACKGROUND_TASKS_STORAGE_KEY,
  ERRAND_STORE_STORAGE_KEY,
  OPEN_GOALS_STORAGE_KEY,
} = await import('../src/lib/storage/core.ts')

window.localStorage.setItem(AGENT_TRACE_STORAGE_KEY, JSON.stringify([
  {
    id: 'trace-running',
    goal: 'old run',
    startedAt: 1_000,
    steps: [
      {
        iteration: 1,
        type: 'tool_round',
        timestamp: 1_100,
        toolCallNames: ['weather_lookup', 123],
      },
      {
        iteration: 2,
        type: 'not-a-step',
        timestamp: 1_200,
      },
    ],
  },
  {
    id: 'bad-trace',
    goal: 'bad',
    startedAt: 'not-a-number',
    steps: [],
  },
]))
window.localStorage.setItem(BACKGROUND_TASKS_STORAGE_KEY, JSON.stringify([
  {
    id: 'running-task',
    label: 'survived restart',
    status: 'running',
    startedAt: 1_000,
  },
  {
    id: 'bad-status',
    label: 'bad',
    status: 'wat',
    startedAt: 2_000,
  },
  null,
]))
window.localStorage.setItem(OPEN_GOALS_STORAGE_KEY, JSON.stringify([
  {
    id: 'paused-goal',
    goal: 'resume this',
    status: 'paused',
    iterations: 2,
    createdAt: 1_000,
    updatedAt: 1_100,
    nudgeCount: 1.8,
  },
  {
    id: 'bad-goal',
    goal: 'bad',
    status: 'done',
    iterations: 1,
    createdAt: 2_000,
    updatedAt: 2_100,
    nudgeCount: 0,
  },
  { id: 'missing-fields' },
]))

const { backgroundTaskStore } = await import('../src/features/agent/backgroundTaskStore.ts')
const { agentTraceStore } = await import('../src/features/agent/agentTraceStore.ts')
const { openGoalsStore } = await import('../src/features/agent/openGoalsStore.ts')
const {
  __resetErrands,
  enqueueErrand,
  loadErrands,
  updateErrand,
} = await import('../src/features/agent/errandStore.ts')

function resetStores() {
  window.localStorage.clear()
  agentTraceStore.clear()
  backgroundTaskStore.clear()
  openGoalsStore.clear()
  __resetErrands()
}

test('agent stores hydrate only valid persisted records and normalize restart state', () => {
  const traces = agentTraceStore.list()
  assert.equal(traces.length, 1)
  assert.equal(traces[0].id, 'trace-running')
  assert.equal(traces[0].status, 'aborted')
  assert.equal(typeof traces[0].endedAt, 'number')
  assert.equal(traces[0].steps.length, 1)
  assert.deepEqual(traces[0].steps[0].toolCallNames, ['weather_lookup'])

  assert.deepEqual(backgroundTaskStore.list(), [{
    id: 'running-task',
    label: 'survived restart',
    status: 'orphaned',
    startedAt: 1_000,
  }])

  assert.deepEqual(openGoalsStore.list(), [{
    id: 'paused-goal',
    goal: 'resume this',
    status: 'paused',
    iterations: 2,
    createdAt: 1_000,
    updatedAt: 1_100,
    nudgeCount: 1,
  }])
})

test('agent trace store returns immutable snapshots and stores cloned steps', () => {
  resetStores()
  const snapshots: ReturnType<typeof agentTraceStore.list>[] = []
  const unsubscribe = agentTraceStore.subscribe((traces) => {
    snapshots.push(traces)
    if (traces[0]) {
      traces[0].goal = 'listener mutation'
      traces[0].steps.push({
        iteration: 99,
        type: 'abort',
        timestamp: 99,
      })
    }
  })

  const trace = agentTraceStore.start('trace goal')
  trace.goal = 'caller mutation'

  const step = {
    iteration: 1,
    type: 'tool_round' as const,
    timestamp: 1_000,
    toolCallNames: ['write_file'],
  }
  agentTraceStore.appendStep(trace.id, step)
  step.toolCallNames.push('mutated')

  const listed = agentTraceStore.list()
  listed[0].goal = 'list mutation'
  listed[0].steps[0].toolCallNames?.push('list mutation')

  const stored = agentTraceStore.get(trace.id)
  assert.equal(stored?.goal, 'trace goal')
  assert.equal(stored?.status, undefined)
  assert.deepEqual(stored?.steps.map((item) => item.iteration), [1])
  assert.deepEqual(stored?.steps[0].toolCallNames, ['write_file'])
  assert.ok(snapshots.length >= 2)
  unsubscribe()
})

test('background task store returns immutable snapshots to callers and subscribers', () => {
  resetStores()
  const snapshots: ReturnType<typeof backgroundTaskStore.list>[] = []
  const unsubscribe = backgroundTaskStore.subscribe((tasks) => {
    snapshots.push(tasks)
    if (tasks[0]) {
      tasks[0].label = 'listener mutation'
      tasks[0].status = 'failed'
    }
  })

  const { task } = backgroundTaskStore.start({ label: 'run report', traceId: 'trace-1' })
  task.label = 'caller mutation'
  task.status = 'completed'

  const listed = backgroundTaskStore.list()
  listed[0].summary = 'list mutation'

  const stored = backgroundTaskStore.get(task.id)
  assert.equal(stored?.label, 'run report')
  assert.equal(stored?.status, 'running')
  assert.equal(stored?.summary, undefined)
  assert.equal(stored?.traceId, 'trace-1')
  assert.ok(snapshots.length >= 2)
  unsubscribe()
})

test('background task cancellation is not overwritten by late terminal results', () => {
  resetStores()
  const { task, signal } = backgroundTaskStore.start({ label: 'cancel me' })

  backgroundTaskStore.cancel(task.id)
  assert.equal(signal.aborted, true)
  assert.equal(backgroundTaskStore.get(task.id)?.status, 'cancelled')

  backgroundTaskStore.markFinished(task.id, 'late success')
  assert.equal(backgroundTaskStore.get(task.id)?.status, 'cancelled')
  assert.equal(backgroundTaskStore.get(task.id)?.summary, undefined)

  backgroundTaskStore.markFailed(task.id, 'late failure')
  assert.equal(backgroundTaskStore.get(task.id)?.status, 'cancelled')
  assert.equal(backgroundTaskStore.get(task.id)?.summary, undefined)
})

test('open goals store returns immutable snapshots and eligible nudges as copies', () => {
  resetStores()
  const snapshots: ReturnType<typeof openGoalsStore.list>[] = []
  const unsubscribe = openGoalsStore.subscribe((goals) => {
    snapshots.push(goals)
    if (goals[0]) {
      goals[0].goal = 'listener mutation'
      goals[0].nudgeCount = 99
    }
  })

  const goal = openGoalsStore.add({
    goal: 'finish setup',
    iterations: 3,
    lastResponse: 'halfway',
  })
  goal.goal = 'caller mutation'
  goal.nudgeCount = 99

  const listed = openGoalsStore.list()
  listed[0].goal = 'list mutation'

  const eligible = openGoalsStore.pickEligibleForNudge()
  assert.ok(eligible)
  eligible.goal = 'eligible mutation'

  const stored = openGoalsStore.get(goal.id)
  assert.equal(stored?.goal, 'finish setup')
  assert.equal(stored?.iterations, 3)
  assert.equal(stored?.lastResponse, 'halfway')
  assert.equal(stored?.nudgeCount, 0)
  assert.ok(snapshots.length >= 2)
  unsubscribe()
})

test('open goals store records only unfinished agent results', () => {
  resetStores()

  assert.equal(openGoalsStore.recordFromAgentResult({
    goal: 'done goal',
    status: 'done',
    iterations: 1,
  }), undefined)
  assert.equal(openGoalsStore.recordFromAgentResult({
    goal: 'errored goal',
    status: 'error',
    iterations: 1,
  }), undefined)

  const paused = openGoalsStore.recordFromAgentResult({
    goal: 'hit max',
    status: 'max_iterations',
    reason: 'limit',
    iterations: 8,
  })
  const aborted = openGoalsStore.recordFromAgentResult({
    goal: 'user abort',
    status: 'aborted',
    reason: 'stop',
    iterations: 2,
  })

  assert.equal(paused?.status, 'paused')
  assert.equal(aborted?.status, 'aborted')
  assert.deepEqual(openGoalsStore.list().map((goal) => goal.goal), ['user abort', 'hit max'])
})

test('errand store filters invalid runtime patches before persisting', () => {
  resetStores()
  const errand = enqueueErrand('  check docs  ')
  assert.ok(errand)
  assert.equal(errand.prompt, 'check docs')

  const invalid = updateErrand(errand.id, {
    prompt: '   ',
    status: 'wat' as never,
    startedAt: 'not-a-date',
    completedAt: 'also-not-a-date',
    deliveredAt: 'bad',
    iterationsUsed: Number.NaN,
    result: 'kept result',
  })

  assert.equal(invalid?.prompt, 'check docs')
  assert.equal(invalid?.status, 'queued')
  assert.equal(invalid?.startedAt, undefined)
  assert.equal(invalid?.completedAt, undefined)
  assert.equal(invalid?.deliveredAt, undefined)
  assert.equal(invalid?.iterationsUsed, undefined)
  assert.equal(invalid?.result, 'kept result')

  const valid = updateErrand(errand.id, {
    prompt: '  trimmed update  ',
    status: 'running',
    startedAt: '2026-06-04T12:00:00.000Z',
    iterationsUsed: 2.7,
  })

  assert.equal(valid?.prompt, 'trimmed update')
  assert.equal(valid?.status, 'running')
  assert.equal(valid?.startedAt, '2026-06-04T12:00:00.000Z')
  assert.equal(valid?.iterationsUsed, 2)
  assert.deepEqual(JSON.parse(window.localStorage.getItem(ERRAND_STORE_STORAGE_KEY) ?? '[]'), loadErrands())
})
