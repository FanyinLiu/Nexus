import type { AppSettings, AutonomyPhase, AutonomyTickState, FocusState } from '../../types'
import { shouldSuppressAutonomy } from './focusAwareness'

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
    dailyTickResetDate: todayDateString(),
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
 *   any    → awake    when user interacts (wakeOnInput)
 */
export function computeNextPhase(
  state: AutonomyTickState,
  focusState: FocusState,
  settings: Pick<AppSettings,
    | 'autonomySleepAfterIdleMinutes'
    | 'autonomyQuietHoursStart'
    | 'autonomyQuietHoursEnd'
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

  // User came back → wake up
  if (focusState === 'active' && state.phase !== 'awake') {
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
 * Returns true if the tick loop should fire this cycle.
 * Enforces cost limits (daily tick cap) and basic sanity.
 */
export function shouldTick(
  state: AutonomyTickState,
  settings: Pick<AppSettings, 'autonomyCostLimitDailyTicks'>,
): boolean {
  // Reset daily counter if date has changed
  const today = todayDateString()
  if (state.dailyTickResetDate !== today) {
    return true // Will reset in advanceTick
  }
  return state.dailyTickCount < settings.autonomyCostLimitDailyTicks
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
): AutonomyTickState {
  const now = new Date()
  const today = todayDateString()
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
    dailyTickCount: isNewDay ? 1 : state.dailyTickCount + 1,
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayDateString(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
