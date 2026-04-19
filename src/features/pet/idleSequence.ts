/**
 * Idle animation sequence for the desktop pet.
 *
 * Previous implementation was a fixed 45-second loop (rest × 12, blink × 2,
 * fidget, shift, stretch) — predictable and boring after a few minutes of
 * watching. This version runs a weighted random draw from a per-model pool
 * on each tick, with a configurable trigger rate so most ticks stay silent.
 *
 * Models that don't ship a custom pool fall back to the legacy-shaped
 * DEFAULT_IDLE_FIDGET_POOL, which keeps the same four motion slots
 * (blink, happy, thinking, sleepy) the old sequence targeted.
 */

import type { PetPerformanceCue, PetPerformancePlan } from './performance'
import type { IdleFidgetDefinition } from './models'
import { createId } from '../../lib/storage'

export const IDLE_TICK_MS = 3_000
/** Per-tick probability that we actually emit a fidget. Keeps the pet quiet
 *  most of the time — too-frequent motion reads as "busy" instead of "idle".
 */
const DEFAULT_FIDGET_TRIGGER_RATE = 0.25

/**
 * Pool used when a model doesn't declare its own idle fidgets. The shapes
 * mirror the old IDLE_SEQUENCE actions so models that relied on the legacy
 * behaviour keep working without change.
 */
export const DEFAULT_IDLE_FIDGET_POOL: IdleFidgetDefinition[] = [
  // Short blink, no motion — low-impact and works on every model.
  { id: 'blink', expressionSlot: 'idle', durationMs: 600, stageDirection: '(眨眼)', weight: 5 },
  // Light "fidget" using the happy motion slot (Mao: exp_06 / TapBody).
  { id: 'fidget', expressionSlot: 'idle', motionSlot: 'happy', durationMs: 1000, stageDirection: '(小动作)', weight: 3 },
  // Slight head turn — thinking slot (Mao: exp_03).
  { id: 'shift', expressionSlot: 'idle', motionSlot: 'thinking', durationMs: 1200, stageDirection: '(转头)', weight: 2 },
  // Small stretch — sleepy slot (Mao: exp_04).
  { id: 'stretch', expressionSlot: 'idle', motionSlot: 'sleepy', durationMs: 1400, stageDirection: '(伸懒腰)', weight: 1 },
]

function fidgetToCue(fidget: IdleFidgetDefinition): PetPerformancePlan {
  return {
    expressionSlot: fidget.expressionSlot ?? 'idle',
    ...(fidget.motionSlot ? { motionSlot: fidget.motionSlot } : {}),
    durationMs: fidget.durationMs ?? 800,
    stageDirection: fidget.stageDirection ?? '',
  }
}

function pickWeightedFidget(pool: IdleFidgetDefinition[]): IdleFidgetDefinition | null {
  if (!pool.length) return null
  const totalWeight = pool.reduce((sum, item) => sum + Math.max(0, item.weight ?? 1), 0)
  if (totalWeight <= 0) return null
  let roll = Math.random() * totalWeight
  for (const item of pool) {
    const weight = Math.max(0, item.weight ?? 1)
    if (weight === 0) continue
    if (roll < weight) return item
    roll -= weight
  }
  return pool[pool.length - 1] ?? null
}

// ── Controller ──

export type IdleSequenceController = {
  start: () => void
  stop: () => void
  isRunning: () => boolean
}

export interface CreateIdleSequenceControllerOptions {
  /** Static override of the fidget pool — typically a per-model list. */
  pool?: IdleFidgetDefinition[]
  /**
   * Dynamic pool lookup re-read on every tick. Takes precedence over `pool`
   * when set. Use this when the user can swap models at runtime — returning
   * a fresh list from the latest settings is cheaper than tearing the
   * controller down and restarting the interval.
   */
  getPool?: () => IdleFidgetDefinition[] | undefined
  /** Probability per tick that we emit any fidget at all (0–1). */
  triggerRate?: number
}

export function createIdleSequenceController(
  onCue: (cue: PetPerformanceCue) => void,
  options: CreateIdleSequenceControllerOptions = {},
): IdleSequenceController {
  let timerId: number | null = null
  let running = false

  const staticPool = options.pool && options.pool.length > 0 ? options.pool : DEFAULT_IDLE_FIDGET_POOL
  const triggerRate = typeof options.triggerRate === 'number'
    ? Math.max(0, Math.min(1, options.triggerRate))
    : DEFAULT_FIDGET_TRIGGER_RATE

  function resolvePool(): IdleFidgetDefinition[] {
    if (options.getPool) {
      const dynamic = options.getPool()
      if (dynamic && dynamic.length > 0) return dynamic
    }
    return staticPool
  }

  function tick() {
    if (Math.random() >= triggerRate) return
    const choice = pickWeightedFidget(resolvePool())
    if (!choice) return
    onCue({
      ...fidgetToCue(choice),
      id: createId('idle'),
    })
  }

  return {
    start() {
      if (running) return
      running = true
      timerId = window.setInterval(tick, IDLE_TICK_MS)
    },
    stop() {
      if (!running) return
      running = false
      if (timerId !== null) {
        window.clearInterval(timerId)
        timerId = null
      }
    },
    isRunning() {
      return running
    },
  }
}
