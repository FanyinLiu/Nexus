import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'

import {
  VOICE_SIDECAR_VERSION,
  createVoiceSidecarSupervisor,
  parseSidecarVersion,
  resolveVoiceSidecarPlan,
} from '../electron/services/voiceSidecarService.js'

type SidecarSettings = {
  speechInputEnabled?: boolean
  speechInputProviderId?: string
  speechOutputEnabled?: boolean
  speechOutputProviderId?: string
}

const BASE_SETTINGS: Required<SidecarSettings> = {
  speechInputEnabled: false,
  speechInputProviderId: 'local-sensevoice',
  speechOutputEnabled: false,
  speechOutputProviderId: 'edge-tts',
}

const GLM_ASR_SETTINGS: SidecarSettings = {
  ...BASE_SETTINGS,
  speechInputEnabled: true,
  speechInputProviderId: 'glm-asr-local',
}

const OMNIVOICE_SETTINGS: SidecarSettings = {
  ...BASE_SETTINGS,
  speechOutputEnabled: true,
  speechOutputProviderId: 'omnivoice-tts',
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function createFakeChild(pid: number, onSpawn: () => void, onExit: () => void) {
  const child = new EventEmitter() as EventEmitter & {
    pid: number
    exitCode: number | null
    killed: boolean
    stderr: { resume: () => void }
    unref: () => void
    kill: (signal?: string) => boolean
  }
  child.pid = pid
  child.exitCode = null
  child.killed = false
  child.stderr = { resume: () => undefined }
  child.unref = () => undefined
  child.kill = (signal = 'SIGTERM') => {
    if (child.exitCode != null) return true
    child.killed = true
    child.exitCode = 0
    onExit()
    child.emit('exit', 0, signal)
    return true
  }
  onSpawn()
  return child
}

function createHarness(options: {
  version?: string
  runtimeDelayMs?: number
  runtimeReady?: Partial<Record<'omniVoice' | 'glmAsr', boolean>>
} = {}) {
  const spawned: Array<{
    command: string
    args: string[]
    port: number
    options: Record<string, unknown>
  }> = []
  const runtimeChecks: string[] = []
  const readPaths: string[] = []
  const logs = { info: [] as string[], warn: [] as string[] }
  // Ports only count as open while a fake process is alive: the supervisor
  // probes the port to decide between "already running" and "spawn one".
  const livePorts = new Set<number>()
  let active = 0
  let maxActive = 0

  const supervisor = createVoiceSidecarSupervisor({
    spawnProcess: (command: string, args: string[], spawnOptions: Record<string, unknown>) => {
      const port = Number(args[args.indexOf('--port') + 1])
      const child = createFakeChild(
        10_000 + spawned.length,
        () => {
          livePorts.add(port)
          active += 1
          maxActive = Math.max(maxActive, active)
        },
        () => {
          livePorts.delete(port)
          active = Math.max(0, active - 1)
        },
      )
      spawned.push({ command, args, port, options: spawnOptions })
      return child
    },
    readFileSync: (filePath: string) => {
      readPaths.push(filePath)
      return `SIDECAR_VERSION = "${options.version ?? VOICE_SIDECAR_VERSION}"\n`
    },
    resolveScriptPath: (script: string) => `/repo/${script}`,
    resolvePythonCommand: () => 'python3',
    isPortOpen: async (_host: string, port: number) => livePorts.has(port),
    ensureRuntimeReady: async (serviceId: 'omniVoice' | 'glmAsr') => {
      runtimeChecks.push(serviceId)
      if (options.runtimeDelayMs) await delay(options.runtimeDelayMs)
      return options.runtimeReady?.[serviceId] ?? true
    },
    terminateChild: (child: { kill: (signal?: string) => boolean }, signal: string) => {
      child.kill(signal)
    },
    logger: {
      info: (message: string) => { logs.info.push(message) },
      warn: (message: string) => { logs.warn.push(message) },
    },
    debounceMs: 0,
    pollIntervalMs: 1,
    stopTimeoutMs: 20,
    startTimeoutMs: { omniVoice: 100, glmAsr: 100 },
  })

  return {
    supervisor,
    spawned,
    runtimeChecks,
    readPaths,
    logs,
    get active() { return active },
    get maxActive() { return maxActive },
  }
}

test('voice sidecar plan requires both the engine id and its voice switch', () => {
  assert.deepEqual(resolveVoiceSidecarPlan(null), {
    readable: false,
    omniVoice: false,
    glmAsr: false,
  })
  assert.deepEqual(resolveVoiceSidecarPlan({}), {
    readable: true,
    omniVoice: false,
    glmAsr: false,
  })
  assert.deepEqual(resolveVoiceSidecarPlan({
    speechInputEnabled: false,
    speechInputProviderId: 'glm-asr-local',
    speechOutputEnabled: false,
    speechOutputProviderId: 'omnivoice-tts',
  }), {
    readable: true,
    omniVoice: false,
    glmAsr: false,
  })
  assert.deepEqual(resolveVoiceSidecarPlan({
    speechInputEnabled: true,
    speechInputProviderId: 'glm-asr-local',
    speechOutputEnabled: true,
    speechOutputProviderId: 'omnivoice-tts',
  }), {
    readable: true,
    omniVoice: true,
    glmAsr: true,
  })
})

test('sidecar version parser reads the Python declaration', () => {
  assert.equal(parseSidecarVersion('SIDECAR_VERSION = "1"\n'), '1')
  assert.equal(parseSidecarVersion("SIDECAR_VERSION = '7'\n"), '7')
  assert.equal(parseSidecarVersion('print("no version")\n'), null)
})

test('launch with non-local engines runs no Python probe and spawns nothing', async () => {
  const harness = createHarness()

  harness.supervisor.applySettings({
    ...BASE_SETTINGS,
    speechInputEnabled: true,
    speechInputProviderId: 'openai-stt',
    speechOutputEnabled: true,
    speechOutputProviderId: 'edge-tts',
  })
  await harness.supervisor.whenIdle()

  assert.deepEqual(harness.spawned, [])
  assert.deepEqual(harness.runtimeChecks, [])
  assert.deepEqual(harness.readPaths, [])
})

test('GLM-ASR + voice on starts exactly one GLM sidecar', async () => {
  const harness = createHarness()

  harness.supervisor.applySettings(GLM_ASR_SETTINGS)
  await harness.supervisor.whenIdle()

  assert.equal(harness.spawned.length, 1)
  assert.match(harness.spawned[0].args[0], /glm_asr_server\.py$/)
  assert.equal(harness.spawned[0].port, 8001)
  assert.deepEqual(harness.runtimeChecks, ['glmAsr'])
  assert.equal(harness.supervisor.getState().glmAsr.phase, 'running')
  assert.equal(harness.supervisor.getState().omniVoice.phase, 'idle')
  assert.equal(harness.active, 1)

  await harness.supervisor.stopAll()
  assert.equal(harness.active, 0)
})

test('OmniVoice + speech output on starts exactly one OmniVoice sidecar', async () => {
  const harness = createHarness()

  harness.supervisor.applySettings(OMNIVOICE_SETTINGS)
  await harness.supervisor.whenIdle()

  assert.equal(harness.spawned.length, 1)
  assert.match(harness.spawned[0].args[0], /omnivoice_server\.py$/)
  assert.equal(harness.spawned[0].port, 8000)
  assert.deepEqual(harness.runtimeChecks, ['omniVoice'])
  assert.equal(harness.supervisor.getState().omniVoice.phase, 'running')
  assert.equal(harness.supervisor.getState().glmAsr.phase, 'idle')
  assert.equal(harness.active, 1)

  await harness.supervisor.stopAll()
  assert.equal(harness.active, 0)
})

test('switching engine or turning voice off stops the process cleanly', async () => {
  const harness = createHarness()

  harness.supervisor.applySettings(GLM_ASR_SETTINGS)
  await harness.supervisor.whenIdle()
  assert.equal(harness.active, 1)

  // Engine switch: GLM no longer selected.
  harness.supervisor.applySettings(OMNIVOICE_SETTINGS)
  await harness.supervisor.whenIdle()
  assert.equal(harness.spawned.length, 2)
  assert.equal(harness.spawned[0].port, 8001)
  assert.equal(harness.spawned[1].port, 8000)
  assert.equal(harness.supervisor.getState().glmAsr.phase, 'idle')
  assert.equal(harness.supervisor.getState().omniVoice.phase, 'running')
  assert.equal(harness.active, 1)

  // Voice off for the remaining engine.
  harness.supervisor.applySettings(BASE_SETTINGS)
  await harness.supervisor.whenIdle()
  assert.equal(harness.active, 0)
  assert.equal(harness.supervisor.getState().omniVoice.phase, 'idle')

  // Selecting the engine again starts a fresh process.
  harness.supervisor.applySettings(GLM_ASR_SETTINGS)
  await harness.supervisor.whenIdle()
  assert.equal(harness.spawned.length, 3)
  assert.equal(harness.active, 1)

  await harness.supervisor.stopAll()
  assert.equal(harness.active, 0)
})

test('rapid toggling never runs two sidecar instances at once', async () => {
  const harness = createHarness({ runtimeDelayMs: 15 })

  harness.supervisor.applySettings(GLM_ASR_SETTINGS)
  await delay(5)
  harness.supervisor.applySettings(BASE_SETTINGS)
  await delay(5)
  harness.supervisor.applySettings(GLM_ASR_SETTINGS)
  await delay(5)
  harness.supervisor.applySettings(BASE_SETTINGS)
  harness.supervisor.applySettings(GLM_ASR_SETTINGS)

  await harness.supervisor.whenIdle()

  assert.ok(harness.maxActive <= 1, `expected at most one active process, saw ${harness.maxActive}`)
  assert.ok(harness.spawned.length <= 1, `rapid toggling spawned ${harness.spawned.length} processes`)
  assert.equal(harness.active, 1)

  await harness.supervisor.stopAll()
  assert.equal(harness.active, 0)
})

test('GLM-ASR version mismatch logs once and never spawns', async () => {
  const harness = createHarness({ version: '999' })

  for (let i = 0; i < 3; i += 1) {
    harness.supervisor.applySettings(GLM_ASR_SETTINGS)
    await harness.supervisor.whenIdle()
  }

  assert.deepEqual(harness.spawned, [])
  assert.deepEqual(harness.runtimeChecks, [])
  const mismatchLogs = harness.logs.warn.filter((line) => /version 999 does not match expected/u.test(line))
  assert.equal(mismatchLogs.length, 1)
  assert.equal(harness.supervisor.getState().glmAsr.phase, 'idle')
})

test('OmniVoice version mismatch logs once and never spawns', async () => {
  const harness = createHarness({ version: '999' })

  for (let i = 0; i < 3; i += 1) {
    harness.supervisor.applySettings(OMNIVOICE_SETTINGS)
    await harness.supervisor.whenIdle()
  }

  assert.deepEqual(harness.spawned, [])
  assert.deepEqual(harness.runtimeChecks, [])
  const mismatchLogs = harness.logs.warn.filter((line) => /version 999 does not match expected/u.test(line))
  assert.equal(mismatchLogs.length, 1)
  assert.equal(harness.supervisor.getState().omniVoice.phase, 'idle')
})

test('unreadable settings fail closed without probing or spawning', async () => {
  for (const value of [null, undefined, 'broken', 42, []]) {
    const harness = createHarness()
    harness.supervisor.applySettings(value)
    await harness.supervisor.whenIdle()

    assert.deepEqual(harness.spawned, [], `spawned for ${String(value)}`)
    assert.deepEqual(harness.runtimeChecks, [], `probed for ${String(value)}`)
  }
})
