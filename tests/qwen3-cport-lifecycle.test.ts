import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'

import { createVoiceSidecarSupervisor } from '../electron/services/voiceSidecarService.js'

type LaunchPlan =
  | { kind: 'python' }
  | { kind: 'skip', reason?: string }
  | { kind: 'external', engine: 'cport', port: number, baseUrl: string, pid?: number | null }
  | {
      kind: 'spawn'
      engine: 'cport'
      port: number
      baseUrl: string
      command: string
      args: string[]
      options: Record<string, unknown>
    }

const QWEN3_SETTINGS = {
  speechInputEnabled: false,
  speechInputProviderId: 'local-sensevoice',
  speechOutputEnabled: true,
  speechOutputProviderId: 'qwen3-tts-local',
}

type FakeChild = EventEmitter & {
  pid: number
  exitCode: number | null
  stderr: { resume: () => void }
  stdin: { on: () => void }
  unref: () => void
  kill: (signal?: string) => boolean
  crash: (code?: number) => void
}

function createHarness(options: {
  launch: LaunchPlan
  cportReady?: boolean
  pythonPortState?: 'ours' | 'foreign' | 'closed'
  qwen3RestartBaseMs?: number
  qwen3RestartMaxAttempts?: number
  qwen3StabilityMs?: number
  cportLoopback?: boolean
}) {
  const spawned: Array<{ command: string; args: string[]; port: number; options: Record<string, unknown> }> = []
  const children: FakeChild[] = []
  const runtimes: Array<{ engine: 'cport'; baseUrl: string } | null> = []
  const terminatedExternalPids: number[] = []
  const logs = { info: [] as string[], warn: [] as string[] }
  const livePorts = new Set<number>()
  let active = 0

  const supervisor = createVoiceSidecarSupervisor({
    spawnProcess: (command: string, args: string[], spawnOptions: Record<string, unknown>) => {
      const serveIndex = args.indexOf('--serve')
      const portIndex = args.indexOf('--port')
      const port = Number(serveIndex >= 0 ? args[serveIndex + 1] : args[portIndex + 1])
      const child = new EventEmitter() as FakeChild
      child.pid = 20_000 + spawned.length
      child.exitCode = null
      child.stderr = { resume: () => undefined }
      child.stdin = { on: () => undefined }
      child.unref = () => undefined
      child.kill = (signal = 'SIGTERM') => {
        if (child.exitCode != null) return true
        child.exitCode = 0
        livePorts.delete(port)
        active = Math.max(0, active - 1)
        child.emit('exit', 0, signal)
        return true
      }
      child.crash = (code = 1) => {
        if (child.exitCode != null) return
        child.exitCode = code
        livePorts.delete(port)
        active = Math.max(0, active - 1)
        child.emit('exit', code, null)
      }
      livePorts.add(port)
      active += 1
      children.push(child)
      spawned.push({ command, args, port, options: spawnOptions })
      return child
    },
    readFileSync: () => 'SIDECAR_VERSION = "1"\n',
    resolveScriptPath: (script: string) => `/repo/${script}`,
    resolvePythonCommand: () => 'python3',
    resolvePythonCommandFor: () => 'python3',
    isPortOpen: async (_host: string, port: number) => livePorts.has(port),
    resolveQwen3Launch: async () => options.launch,
    verifyQwen3CportLoopback: async () => options.cportLoopback !== false,
    classifyPort: async (state: { id: string, port: number }) => {
      if (state.id !== 'qwen3Tts') return livePorts.has(state.port) ? 'ours' : 'closed'
      if (options.pythonPortState) return options.pythonPortState
      return livePorts.has(state.port) ? 'ours' : 'closed'
    },
    isServiceReady: async (state: { id: string, port: number, engine: string }) => {
      if (state.id === 'qwen3Tts' && state.engine === 'cport') {
        return options.cportReady !== false && livePorts.has(state.port)
      }
      return livePorts.has(state.port)
    },
    onQwen3RuntimeChange: (runtime) => { runtimes.push(runtime) },
    ensureRuntimeReady: async () => true,
    terminateChild: (child: { pid?: number, kill?: (signal?: string) => boolean }, signal: string) => {
      if (typeof child.kill === 'function') {
        child.kill(signal)
        return
      }
      if (typeof child.pid === 'number') terminatedExternalPids.push(child.pid)
    },
    buildLaunch: (command: string, args: string[]) => ({ command, args, guarded: false }),
    logger: {
      info: (message: string) => { logs.info.push(message) },
      warn: (message: string) => { logs.warn.push(message) },
    },
    debounceMs: 0,
    pollIntervalMs: 1,
    stopTimeoutMs: 20,
    qwen3RestartBaseMs: options.qwen3RestartBaseMs ?? 1,
    qwen3RestartMaxAttempts: options.qwen3RestartMaxAttempts ?? 3,
    qwen3StabilityMs: options.qwen3StabilityMs,
    startTimeoutMs: { omniVoice: 100, glmAsr: 100, qwen3Tts: 80 },
  })

  return {
    supervisor,
    spawned,
    children,
    runtimes,
    terminatedExternalPids,
    logs,
    get active() { return active },
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const CPORT_SPAWN: LaunchPlan = {
  kind: 'spawn',
  engine: 'cport',
  port: 8003,
  baseUrl: 'http://127.0.0.1:8003/v1',
  command: '/c/qwen_tts',
  args: ['-d', '/models/qwen3', '--int4', '--backend', 'metal', '--serve', '8003', '--seed', '42'],
  options: { stdio: ['pipe', 'ignore', 'ignore'], detached: true },
}

test('Qwen3 selection starts the C server and publishes its runtime', async () => {
  const harness = createHarness({ launch: CPORT_SPAWN })

  harness.supervisor.applySettings(QWEN3_SETTINGS)
  await harness.supervisor.whenIdle()

  assert.equal(harness.spawned.length, 1)
  assert.equal(harness.spawned[0].command, '/c/qwen_tts')
  assert.equal(harness.spawned[0].port, 8003)
  assert.deepEqual(harness.spawned[0].options.stdio, ['pipe', 'ignore', 'ignore'])
  assert.equal(harness.supervisor.getState().qwen3Tts.phase, 'running')
  assert.equal(harness.supervisor.getState().qwen3Tts.engine, 'cport')
  assert.deepEqual(harness.runtimes.at(-1), {
    engine: 'cport',
    baseUrl: 'http://127.0.0.1:8003/v1',
  })
  assert.equal(harness.active, 1)

  await harness.supervisor.stopAll()
  assert.equal(harness.active, 0)
  assert.equal(harness.runtimes.at(-1), null)
})

test('a C server reachable off loopback is killed and falls back to Python', async () => {
  const harness = createHarness({ launch: CPORT_SPAWN, cportLoopback: false })

  harness.supervisor.applySettings(QWEN3_SETTINGS)
  await harness.supervisor.whenIdle()

  assert.equal(harness.children[0].exitCode, 0, 'the unsafe C server is stopped')
  assert.equal(harness.spawned.length, 2)
  assert.match(harness.spawned[1].args[0] ?? '', /qwen3_tts_server\.py$/u)
  assert.equal(harness.spawned[1].port, 8002)
  assert.equal(harness.supervisor.getState().qwen3Tts.engine, 'python')
  assert.equal(harness.supervisor.getState().qwen3Tts.phase, 'running')
  assert.equal(harness.runtimes.at(-1), null)
  assert.equal(harness.active, 1)

  await harness.supervisor.stopAll()
  assert.equal(harness.active, 0)
})

test('a C server that never becomes ready falls back to the Python sidecar', async () => {
  const harness = createHarness({ launch: CPORT_SPAWN, cportReady: false })

  harness.supervisor.applySettings(QWEN3_SETTINGS)
  await harness.supervisor.whenIdle()

  assert.equal(harness.spawned.length, 2)
  assert.equal(harness.spawned[0].command, '/c/qwen_tts')
  assert.match(harness.spawned[1].args[0] ?? '', /qwen3_tts_server\.py$/u)
  assert.equal(harness.spawned[1].port, 8002)
  assert.equal(harness.supervisor.getState().qwen3Tts.engine, 'python')
  assert.equal(harness.runtimes.at(-1), null)
  assert.equal(harness.active, 1)

  await harness.supervisor.stopAll()
  assert.equal(harness.active, 0)
})

test('a Python port held by another service is never adopted', async () => {
  const harness = createHarness({
    launch: { kind: 'python' },
    pythonPortState: 'foreign',
  })

  harness.supervisor.applySettings(QWEN3_SETTINGS)
  await harness.supervisor.whenIdle()

  assert.deepEqual(harness.spawned, [])
  assert.equal(harness.supervisor.getState().qwen3Tts.phase, 'idle')
  assert.equal(
    harness.logs.warn.some((line) => /held by another service/u.test(line)),
    true,
  )
})

test('an unexpected C-server exit resets the runtime and restarts it', async () => {
  const harness = createHarness({ launch: CPORT_SPAWN })

  harness.supervisor.applySettings(QWEN3_SETTINGS)
  await harness.supervisor.whenIdle()
  assert.equal(harness.spawned.length, 1)

  harness.children[0].crash()
  // The stale C runtime must be withdrawn immediately, before the restart.
  assert.equal(harness.runtimes.at(-1), null)
  assert.equal(harness.supervisor.getState().qwen3Tts.engine, 'python')

  await harness.supervisor.whenIdle()
  assert.equal(harness.spawned.length, 2)
  assert.equal(harness.supervisor.getState().qwen3Tts.phase, 'running')
  assert.equal(harness.supervisor.getState().qwen3Tts.engine, 'cport')
  assert.deepEqual(harness.runtimes.at(-1), {
    engine: 'cport',
    baseUrl: 'http://127.0.0.1:8003/v1',
  })
  assert.equal(harness.active, 1)

  await harness.supervisor.stopAll()
  assert.equal(harness.active, 0)
})

test('repeated C-server crashes fall back to the Python sidecar', async () => {
  const harness = createHarness({
    launch: CPORT_SPAWN,
    qwen3RestartMaxAttempts: 2,
  })

  harness.supervisor.applySettings(QWEN3_SETTINGS)
  await harness.supervisor.whenIdle()

  for (let crash = 0; crash < 3; crash += 1) {
    harness.children.at(-1)!.crash()
    await harness.supervisor.whenIdle()
  }

  assert.equal(harness.spawned.length, 4, 'three C attempts then one Python start')
  assert.match(harness.spawned.at(-1)!.args.join(' '), /qwen3_tts_server\.py --port 8002/u)
  assert.equal(harness.supervisor.getState().qwen3Tts.engine, 'python')
  assert.equal(harness.supervisor.getState().qwen3Tts.phase, 'running')
  assert.equal(harness.runtimes.at(-1), null)
  assert.equal(harness.active, 1)
  assert.equal(
    harness.logs.warn.some((line) => /falling back to the Python sidecar/u.test(line)),
    true,
  )

  await harness.supervisor.stopAll()
  assert.equal(harness.active, 0)
})

test('a stable C server earns a fresh crash budget instead of pinning Python', async () => {
  const harness = createHarness({
    launch: CPORT_SPAWN,
    qwen3RestartMaxAttempts: 1,
    qwen3StabilityMs: 10,
  })

  harness.supervisor.applySettings(QWEN3_SETTINGS)
  await harness.supervisor.whenIdle()
  assert.equal(harness.spawned.length, 1)

  // First crash consumes the only restart attempt.
  harness.children.at(-1)!.crash()
  await harness.supervisor.whenIdle()
  assert.equal(harness.spawned.length, 2)
  assert.equal(harness.supervisor.getState().qwen3Tts.engine, 'cport')

  // After a healthy window the budget is reset, so this later crash restarts
  // the C server again rather than falling back to the Python sidecar.
  await delay(30)
  harness.children.at(-1)!.crash()
  await harness.supervisor.whenIdle()
  assert.equal(harness.spawned.length, 3)
  assert.equal(harness.supervisor.getState().qwen3Tts.engine, 'cport')
  assert.equal(harness.supervisor.getState().qwen3Tts.phase, 'running')
  assert.equal(harness.runtimes.at(-1)?.engine, 'cport')

  await harness.supervisor.stopAll()
  assert.equal(harness.active, 0)
})

test('an already-running C server is adopted and stopped on teardown', async () => {
  const harness = createHarness({
    launch: {
      kind: 'external',
      engine: 'cport',
      port: 8003,
      baseUrl: 'http://127.0.0.1:8003/v1',
      pid: 4242,
    },
  })

  harness.supervisor.applySettings(QWEN3_SETTINGS)
  await harness.supervisor.whenIdle()

  assert.deepEqual(harness.spawned, [])
  assert.equal(harness.supervisor.getState().qwen3Tts.phase, 'running')
  assert.equal(harness.supervisor.getState().qwen3Tts.engine, 'cport')

  await harness.supervisor.stopAll()
  assert.deepEqual(harness.terminatedExternalPids, [4242])
  assert.equal(harness.runtimes.at(-1), null)
})
