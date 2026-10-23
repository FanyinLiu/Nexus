import type { AppSettings, AutonomyPhase, AutonomyTickState, FocusState } from '../../types'
import { localDayKey } from '../../lib/localDate.ts'
import { shouldSuppressAutonomy } from './focusAwareness.ts'

// ── Initial state factory ─────────────────────────────────────────────────────

export function createInitialTickState(): AutonomyTickState {
  const now = new Date().toISOString()
  return {
    phase: 'awake',
    focusState: 'active',
    lastTickAt: now,
    lastWakeAt: now,
    lastSleepAt: null,
    tickCount: 0,
    dailyTickCount: 0,
    dailyTickResetDate: localDayKey(Date.now()),
    idleSeconds: 0,
    consecutiveIdleTicks: 0,
  }
}

// ── Phase state machine ───────────────────────────────────────────────────────

/**
 * Compute the next autonomy phase based on current state, focus, and settings.
 *
 * Transitions:
 *   awake  → drowsy   when idle for > sleepAfterIdleMinutes / 2
 *   drowsy → sleeping when idle for > sleepAfterIdleMinutes
 *   sleeping → dreaming (triggered externally by dream module)
 *   any    → awake    when user interacts, if wake-on-input is on
 */
export function computeNextPhase(
  state: AutonomyTickState,
  focusState: FocusState,
  settings: Pick<AppSettings,
    | 'autonomySleepAfterIdleMinutes'
    | 'autonomyQuietHoursStart'
    | 'autonomyQuietHoursEnd'
    | 'autonomyWakeOnInput'
  >,
): AutonomyPhase {
  const currentHour = new Date().getHours()

  // Locked / quiet hours → go to sleep
  if (shouldSuppressAutonomy(focusState, currentHour, {
    start: settings.autonomyQuietHoursStart,
    end: settings.autonomyQuietHoursEnd,
  })) {
    return state.phase === 'dreaming' ? 'dreaming' : 'sleeping'
  }

  // User came back → wake up, unless they turned that off
  if (settings.autonomyWakeOnInput !== false && focusState === 'active' && state.phase !== 'awake') {
    return 'awake'
  }

  const sleepThresholdSeconds = settings.autonomySleepAfterIdleMinutes * 60
  const drowsyThresholdSeconds = sleepThresholdSeconds / 2

  if (state.phase === 'awake' && state.idleSeconds >= drowsyThresholdSeconds) {
    return 'drowsy'
  }
  if (state.phase === 'drowsy' && state.idleSeconds >= sleepThresholdSeconds) {
    return 'sleeping'
  }

  // Don't transition out of dreaming — dream module controls that
  return state.phase
}

// ── Tick eligibility ──────────────────────────────────────────────────────────

/**
 * Returns true if the scheduler should fire this cycle.
 * The daily cap counts model calls (`spendAutonomyLlmCall`), not ticks.
 * Idle ticks have to keep running so phase, emotion decay, and dreams
 * do not freeze after the cap is spent.
 */
export function shouldTick(
  state: AutonomyTickState,
  settings: Pick<AppSettings, 'autonomyCostLimitDailyTicks'>,
): boolean {
  void state
  void settings
  return true
}

/**
 * Spend one unit of the daily model budget.
 * Returns the next state when a call is allowed. Idle ticks must not call this.
 */
export function spendAutonomyLlmCall(
  state: AutonomyTickState,
  settings: Pick<AppSettings, 'autonomyCostLimitDailyTicks'>,
  now = Date.now(),
): { allowed: boolean; state: AutonomyTickState } {
  const today = localDayKey(now)
  const isNewDay = state.dailyTickResetDate !== today
  const spent = isNewDay ? 0 : state.dailyTickCount
  const limit = settings.autonomyCostLimitDailyTicks
  if (spent >= limit) {
    return {
      allowed: false,
      state: isNewDay
        ? { ...state, dailyTickCount: 0, dailyTickResetDate: today }
        : state,
    }
  }
  return {
    allowed: true,
    state: {
      ...state,
      dailyTickCount: spent + 1,
      dailyTickResetDate: today,
    },
  }
}

// ── Tick advance ──────────────────────────────────────────────────────────────

/**
 * Produces the next immutable tick state. Pure function.
 */
export function advanceTick(
  state: AutonomyTickState,
  phase: AutonomyPhase,
  focusState: FocusState,
  idleSeconds: number,
  nowMs = Date.now(),
): AutonomyTickState {
  const now = new Date(nowMs)
  const today = localDayKey(now.getTime())
  const isNewDay = state.dailyTickResetDate !== today
  const wasIdle = focusState !== 'active'

  return {
    phase,
    focusState,
    lastTickAt: now.toISOString(),
    lastWakeAt: phase === 'awake' && state.phase !== 'awake'
      ? now.toISOString()
      : state.lastWakeAt,
    lastSleepAt: (phase === 'sleeping' || phase === 'dreaming')
        && state.phase !== 'sleeping' && state.phase !== 'dreaming'
      ? now.toISOString()
      : state.lastSleepAt,
    tickCount: state.tickCount + 1,
    dailyTickCount: isNewDay ? 0 : state.dailyTickCount,
    dailyTickResetDate: today,
    idleSeconds,
    consecutiveIdleTicks: wasIdle ? state.consecutiveIdleTicks + 1 : 0,
  }
}

// ── Wake helper ───────────────────────────────────────────────────────────────

/**
 * Instantly wake up from any phase (called on user input).
 */
export function wakeUpState(state: AutonomyTickState): AutonomyTickState {
  return {
    ...state,
    phase: 'awake',
    focusState: 'active',
    lastWakeAt: new Date().toISOString(),
    idleSeconds: 0,
    consecutiveIdleTicks: 0,
  }
}


