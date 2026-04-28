/**
 * Performance benchmarks for v0.3.1-beta.5 hot paths.
 *
 * Run: `node --experimental-strip-types tests/benchmarks.bench.ts`
 *
 * Targets the per-turn cost (everything that runs once per assistant
 * reply) and the once-a-year aggregations (yearbook export).
 */

import { Bench } from 'tinybench'

import { computeAffectSnapshot } from '../src/features/autonomy/affectDynamics.ts'
import {
  buildAffectGuidance,
  classifyAffectGuidance,
} from '../src/features/autonomy/affectGuidance.ts'
import { detectRupture } from '../src/features/autonomy/ruptureDetection.ts'
import {
  classifyCoRegulation,
  computeCoRegulationSnapshot,
} from '../src/features/autonomy/coregulation.ts'
import { binSamplesByDay } from '../src/features/autonomy/moodMapBinning.ts'
import { aggregateYearbook } from '../src/features/yearbook/yearbookAggregator.ts'
import { renderYearbookHtml } from '../src/features/yearbook/yearbookRender.ts'
import { analyzeGuidance } from '../src/features/autonomy/guidanceAnalysis.ts'
import { decideNextCheckIn } from '../src/features/arc/openArcPolicy.ts'

import type { UserAffectSample } from '../src/features/autonomy/userAffectTimeline.ts'
import type { EmotionSample } from '../src/features/autonomy/stateTimeline.ts'
import type { OpenArcRecord } from '../src/features/arc/openArcStore.ts'
import type { GuidanceTelemetryEntry } from '../src/features/autonomy/guidanceTelemetry.ts'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

// ── Sample-data factories ────────────────────────────────────────────────

function makeUserSamples(n: number, startMs = Date.now() - 14 * DAY_MS): UserAffectSample[] {
  const out: UserAffectSample[] = []
  for (let i = 0; i < n; i += 1) {
    out.push({
      ts: new Date(startMs + i * (DAY_MS / Math.max(1, n / 14))).toISOString(),
      valence: Math.sin(i / 5) * 0.6,
      arousal: 0.4 + Math.cos(i / 7) * 0.3,
      source: i % 2 === 0 ? 'voice_prosody' : 'text_signal',
      confidence: 0.5,
    })
  }
  return out
}

function makeCompanionSamples(n: number, startMs = Date.now() - 14 * DAY_MS): EmotionSample[] {
  const out: EmotionSample[] = []
  for (let i = 0; i < n; i += 1) {
    out.push({
      ts: new Date(startMs + i * (DAY_MS / Math.max(1, n / 14))).toISOString(),
      energy: 0.5 + Math.sin(i / 4) * 0.2,
      warmth: 0.6 + Math.cos(i / 6) * 0.3,
      curiosity: 0.5,
      concern: 0.3,
    })
  }
  return out
}

const userSamples_14d_typical = makeUserSamples(200)
const userSamples_14d_dense = makeUserSamples(2000)
const userSamples_3d_typical = makeUserSamples(40, Date.now() - 3 * DAY_MS)
const userSamples_year_dense = makeUserSamples(10_000, Date.now() - 365 * DAY_MS)
const companionSamples_year_dense = makeCompanionSamples(10_000, Date.now() - 365 * DAY_MS)

const sampleSnapshot = computeAffectSnapshot(userSamples_14d_typical)
const sampleRecentSnapshot = computeAffectSnapshot(userSamples_3d_typical)

const typicalChatMessage = "I'm not sure what to do about the meeting tomorrow. I keep going back and forth"
const longChatMessage = typicalChatMessage.repeat(10)
const adversarialWhitespace = 'haha ' + ' '.repeat(2000)

const arcs: OpenArcRecord[] = Array.from({ length: 10 }, (_, i) => ({
  id: `arc-${i}`,
  theme: `theme ${i}`,
  startedAt: new Date(Date.now() - (i + 1) * DAY_MS).toISOString(),
  checkInDays: [3, 5],
  status: 'open',
  checkInsFired: i > 5 ? [new Date(Date.now() - i * HOUR_MS).toISOString()] : [],
}))

const telemetry: GuidanceTelemetryEntry[] = Array.from({ length: 500 }, (_, i) => ({
  ts: new Date(Date.now() - i * HOUR_MS).toISOString(),
  kind: ((['affect:stuck-low', 'affect:volatile', 'affect:steady-warm', 'rupture:contempt'])[i % 4]) as GuidanceTelemetryEntry['kind'],
  beforeValence: i % 5 === 0 ? null : Math.sin(i / 10) * 0.5,
}))

// ── Benches ──────────────────────────────────────────────────────────────

const bench = new Bench({ time: 800 })

// Per-turn (chat-reply) hot path: everything that runs once per assistant
// turn from useAppController + assistantReply.

bench
  .add('per-turn: computeAffectSnapshot(14d, n=200)', () => {
    computeAffectSnapshot(userSamples_14d_typical)
  })
  .add('per-turn: computeAffectSnapshot(14d, n=2000)', () => {
    computeAffectSnapshot(userSamples_14d_dense)
  })
  .add('per-turn: classifyAffectGuidance + buildAffectGuidance', () => {
    const state = classifyAffectGuidance({ snapshot: sampleSnapshot, recentSnapshot: sampleRecentSnapshot })
    void state
    buildAffectGuidance({ uiLanguage: 'en-US', snapshot: sampleSnapshot, recentSnapshot: sampleRecentSnapshot })
  })
  .add('per-turn: detectRupture(typical message, no priors)', () => {
    detectRupture(typicalChatMessage, 'en-US')
  })
  .add('per-turn: detectRupture(typical message, zh-CN)', () => {
    detectRupture(typicalChatMessage, 'zh-CN')
  })
  .add('per-turn: detectRupture(long message ×10, en-US)', () => {
    detectRupture(longChatMessage, 'en-US')
  })
  .add('adversarial: detectRupture(2000 spaces after "haha")', () => {
    detectRupture(adversarialWhitespace, 'en-US')
  })

// Mood-map panel work (every 30s while panel active).
bench
  .add('mood-map: binSamplesByDay(30d, n=200)', () => {
    binSamplesByDay(userSamples_14d_typical)
  })
  .add('mood-map: computeCoRegulationSnapshot(30d, n=400)', () => {
    computeCoRegulationSnapshot(userSamples_14d_typical, makeCompanionSamples(200))
  })
  .add('mood-map: classifyCoRegulation', () => {
    classifyCoRegulation(computeCoRegulationSnapshot(userSamples_14d_typical, makeCompanionSamples(200)))
  })

// Open-arc scheduler tick.
bench.add('arc: decideNextCheckIn(10 arcs)', () => {
  decideNextCheckIn(arcs, new Date(), { quietHoursStart: 22, quietHoursEnd: 7 })
})

// Yearbook export (one-shot user action; budget is generous).
bench
  .add('yearbook: aggregateYearbook(year×n=10k)', () => {
    aggregateYearbook(userSamples_year_dense, companionSamples_year_dense, [], [], [], new Date())
  })
  .add('yearbook: renderYearbookHtml(empty)', () => {
    const snap = aggregateYearbook([], [], [], [], [], new Date())
    renderYearbookHtml(snap, 'en-US')
  })
  .add('yearbook: renderYearbookHtml(year×n=10k)', () => {
    const snap = aggregateYearbook(userSamples_year_dense, companionSamples_year_dense, [], [], [], new Date())
    renderYearbookHtml(snap, 'en-US')
  })

// Silent self-summarisation (weekly).
bench.add('analysis: analyzeGuidance(500 fires, 10k affect samples)', () => {
  analyzeGuidance(telemetry, userSamples_year_dense, new Date())
})

await bench.run()

// Report
const sortedTasks = [...bench.tasks].sort((a, b) => (b.result?.throughput?.mean ?? 0) - (a.result?.throughput?.mean ?? 0))

console.log('\n┌─ Nexus v0.3.1-beta.5 perf benchmark ─────────────────────────────────────')
console.log('│ Each task ran for ~800ms; numbers are ops/sec (higher = faster).')
console.log('├──────────────────────────────────────────────────────────────────────────')
const nameWidth = Math.max(...bench.tasks.map((t) => t.name.length)) + 2
for (const task of sortedTasks) {
  const r = task.result
  if (!r) continue
  const opsPerSec = r.throughput.mean.toFixed(0)
  const meanUs = (r.latency.mean * 1000).toFixed(2)
  const p99Us = (r.latency.p99 * 1000).toFixed(2)
  console.log(
    `│ ${task.name.padEnd(nameWidth)} ${opsPerSec.padStart(10)} ops/s    mean ${meanUs.padStart(8)} µs    p99 ${p99Us.padStart(8)} µs`,
  )
}
console.log('└──────────────────────────────────────────────────────────────────────────\n')
