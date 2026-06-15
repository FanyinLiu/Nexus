import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  executeWithProtection,
  getCircuitState,
  resetCircuit,
} from '../src/features/tools/circuitBreaker.ts'

test('executeWithProtection opens the circuit after consecutive runtime failures', async () => {
  const toolId = 'test-runtime-failures'
  resetCircuit(toolId)

  try {
    for (let index = 0; index < 3; index += 1) {
      await assert.rejects(
        executeWithProtection(toolId, async () => {
          throw new Error('network unavailable')
        }, { maxRetries: 0 }),
        /network unavailable/,
      )
    }

    assert.deepEqual(getCircuitState(toolId), { state: 'open', failures: 3 })

    await assert.rejects(
      executeWithProtection(toolId, async () => 'should not run', { maxRetries: 0 }),
      /temporarily unavailable|暂时不可用|暫時不可用|사용할 수 없어요|一時的に利用できません|连续没成功|hiccups in a row/,
    )
  } finally {
    resetCircuit(toolId)
  }
})

test('half-open circuits allow only one recovery probe at a time', async () => {
  const toolId = 'test-half-open-probe'
  resetCircuit(toolId)

  const originalNow = Date.now
  let now = 1_000
  Date.now = () => now

  try {
    for (let index = 0; index < 3; index += 1) {
      await assert.rejects(
        executeWithProtection(toolId, async () => {
          throw new Error('upstream failed')
        }, { maxRetries: 0 }),
        /upstream failed/,
      )
    }

    assert.deepEqual(getCircuitState(toolId), { state: 'open', failures: 3 })

    now += 30_000

    let releaseProbe: ((value: string) => void) | undefined
    const probe = executeWithProtection(toolId, () => new Promise<string>((resolve) => {
      releaseProbe = resolve
    }), { maxRetries: 0 })

    assert.equal(getCircuitState(toolId).state, 'half-open')

    await assert.rejects(
      executeWithProtection(toolId, async () => 'parallel probe', { maxRetries: 0 }),
      /temporarily unavailable|暂时不可用|暫時不可用|사용할 수 없어요|一時的に利用できません|连续没成功|hiccups in a row/,
    )

    assert.ok(releaseProbe)
    releaseProbe('recovered')

    assert.equal(await probe, 'recovered')
    assert.deepEqual(getCircuitState(toolId), { state: 'closed', failures: 0 })
  } finally {
    Date.now = originalNow
    resetCircuit(toolId)
  }
})

test('half-open caller errors release the recovery probe slot', async () => {
  const toolId = 'test-half-open-caller-error'
  resetCircuit(toolId)

  const originalNow = Date.now
  let now = 10_000
  Date.now = () => now

  try {
    for (let index = 0; index < 3; index += 1) {
      await assert.rejects(
        executeWithProtection(toolId, async () => {
          throw new Error('runtime failed')
        }, { maxRetries: 0 }),
        /runtime failed/,
      )
    }

    now += 30_000

    await assert.rejects(
      executeWithProtection(toolId, async () => {
        throw new Error('Invalid tool arguments')
      }, { maxRetries: 0 }),
      /Invalid tool arguments/,
    )

    assert.deepEqual(getCircuitState(toolId), { state: 'half-open', failures: 3 })

    const result = await executeWithProtection(toolId, async () => 'recovered', { maxRetries: 0 })
    assert.equal(result, 'recovered')
    assert.deepEqual(getCircuitState(toolId), { state: 'closed', failures: 0 })
  } finally {
    Date.now = originalNow
    resetCircuit(toolId)
  }
})
