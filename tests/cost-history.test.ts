import assert from 'node:assert/strict'
import { beforeEach, describe, test } from 'node:test'

// Install a minimal localStorage shim so contextMeter (which reads/writes
// localStorage at module scope and inside recordUsage) can run under
// node:test without a browser.
class MemoryStorage {
  private data = new Map<string, string>()
  get length() { return this.data.size }
  key(i: number) { return Array.from(this.data.keys())[i] ?? null }
  getItem(k: string) { return this.data.has(k) ? this.data.get(k)! : null }
  setItem(k: string, v: string) { this.data.set(k, String(v)) }
  removeItem(k: string) { this.data.delete(k) }
  clear() { this.data.clear() }
}

;(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage()

// Dynamic import after the shim is installed — contextMeter's module-scope
// code paths touch localStorage immediately.
const meter = await import('../src/features/metering/contextMeter.ts')

function clearMeter(): void {
  ;(globalThis as unknown as { localStorage: MemoryStorage }).localStorage.clear()
  meter.resetSession()
  meter.__resetDailyCache()
}

describe('loadDailyRange', () => {
  beforeEach(clearMeter)

  test('returns empty array when no days are recorded', () => {
    assert.deepEqual(meter.loadDailyRange(30), [])
  })

  test('returns most-recent-first ordering', () => {
    meter.recordUsage('chat', 'hi', 'yo', { modelId: 'gpt-4o-mini' })

    // Simulate a previous day's record by writing directly.
    const yesterday = new Date()
    yesterday.setUTCDate(yesterday.getUTCDate() - 1)
    const yesterdayKey = `nexus:metering:day:${yesterday.toISOString().slice(0, 10)}`
    localStorage.setItem(yesterdayKey, JSON.stringify({
      date: yesterday.toISOString().slice(0, 10),
      totalInputTokens: 100,
      totalOutputTokens: 50,
      totalCostUsd: 0.001,
      callCount: 3,
      bySource: { chat: { input: 100, output: 50, calls: 3, costUsd: 0.001 } },
    }))

    const range = meter.loadDailyRange(7)
    assert.ok(range.length >= 2, `expected ≥2 days, got ${range.length}`)
    // Index 0 is today; index 1 should be yesterday.
    assert.equal(range[0].date, new Date().toISOString().slice(0, 10))
    assert.equal(range[1].date, yesterday.toISOString().slice(0, 10))
  })

  test('normalises legacy records missing byModel', () => {
    const today = new Date().toISOString().slice(0, 10)
    // Legacy shape: no byModel field.
    localStorage.setItem(`nexus:metering:day:${today}`, JSON.stringify({
      date: today,
      totalInputTokens: 50,
      totalOutputTokens: 25,
      totalCostUsd: 0.0005,
      callCount: 1,
      bySource: { chat: { input: 50, output: 25, calls: 1, costUsd: 0.0005 } },
    }))

    const range = meter.loadDailyRange(1)
    assert.equal(range.length, 1)
    // byModel coerced to empty object rather than undefined — UI can iterate safely.
    assert.deepEqual(range[0].byModel, {})
  })

  test('returns empty for invalid/non-positive days', () => {
    assert.deepEqual(meter.loadDailyRange(0), [])
    assert.deepEqual(meter.loadDailyRange(-5), [])
  })

  test('skips corrupt entries silently', () => {
    const today = new Date().toISOString().slice(0, 10)
    localStorage.setItem(`nexus:metering:day:${today}`, '{not valid json')
    assert.deepEqual(meter.loadDailyRange(1), [])
  })
})

describe('byModel accumulation', () => {
  beforeEach(clearMeter)

  test('records per-model tokens + cost when modelId supplied', () => {
    meter.recordUsage('chat', 'hello world', 'reply', { modelId: 'gpt-4o-mini' })
    meter.recordUsage('chat', 'second prompt', 'second reply', { modelId: 'gpt-4o-mini' })
    meter.recordUsage('dream', 'consolidate memories', 'summary', { modelId: 'claude-sonnet-4-6' })

    const snapshot = meter.getMeterSnapshot()
    const byModel = snapshot.daily.byModel ?? {}
    assert.ok(byModel['gpt-4o-mini'], 'gpt-4o-mini bucket missing')
    assert.equal(byModel['gpt-4o-mini'].calls, 2)
    assert.ok(byModel['gpt-4o-mini'].costUsd > 0)

    assert.ok(byModel['claude-sonnet-4-6'], 'claude bucket missing')
    assert.equal(byModel['claude-sonnet-4-6'].calls, 1)
  })

  test('does not create byModel entry when modelId omitted', () => {
    meter.recordUsage('tool', 'input', 'output')
    const snapshot = meter.getMeterSnapshot()
    assert.deepEqual(snapshot.daily.byModel, {})
  })
})
