/**
 * Phase 1-2: auto-restart policy.
 *
 * Pure decision functions consolidating the "should we auto-restart the voice
 * listening loop, and when" logic that used to live scattered between
 * continuousVoice.ts, useVoice.ts bus effect executor, and various
 * *Conversation.ts emit sites. No React / DOM / ref touching — callers pass
 * the snapshot they observed and get back a structured decision they can
 * act on.
 *
 * The goal is to eliminate drift between the legacy scheduleVoiceRestart path
 * (which has retry + guard evaluation) and the VoiceBus `restart_voice` effect
 * path (which did not). Both now funnel through the same decisions.
 */

import type { AppSettings, VoiceState } from '../../types'

// ── Reasons ────────────────────────────────────────────────────────────────
//
// Distinct from VoiceReasonCodes (which classifies emitted events): these are
// *decision* codes returned to callers so they can log / show status text
// consistent with why the policy made a given call.

export const AutoRestartDecisionReasons = {
  CONTINUOUS_DISABLED: 'continuous_disabled',
  WAKE_WORD_MODE: 'wake_word_mode',
  WAKEWORD_ALWAYS_ON: 'wakeword_always_on',
  SESSION_INACTIVE: 'session_inactive',
  OK: 'ok',
} as const

type AutoRestartDecisionReason =
  (typeof AutoRestartDecisionReasons)[keyof typeof AutoRestartDecisionReasons]

export const RestartGuardBlockers = {
  ACTIVE_RECOGNITION: 'active_recognition',
  ACTIVE_VAD_SESSION: 'active_vad_session',
  CHAT_BUSY: 'chat_busy',
  VOICE_PROCESSING: 'voice_processing',
  VOICE_SPEAKING: 'voice_speaking',
} as const

type RestartGuardBlocker =
  (typeof RestartGuardBlockers)[keyof typeof RestartGuardBlockers]

// ── Inputs ─────────────────────────────────────────────────────────────────

export type ShouldAutoRestartInput = {
  /** Whether continuousVoiceActiveRef.current is true — the user-initiated session flag. */
  continuousActive: boolean
  /** Snapshot of the settings the caller is using. */
  settings: Pick<
    AppSettings,
    'continuousVoiceModeEnabled' | 'voiceTriggerMode' | 'wakewordAlwaysOn'
  >
}

export type ShouldKeepContinuousSessionInput = {
  settings: Pick<
    AppSettings,
    'continuousVoiceModeEnabled' | 'voiceTriggerMode' | 'wakewordAlwaysOn'
  >
}

export type RestartGuardInput = {
  hasActiveRecognition: boolean
  hasActiveVadSession: boolean
  chatBusy: boolean
  voiceState: VoiceState
}

// ── Decisions ──────────────────────────────────────────────────────────────

export type AutoRestartDecision =
  | { allowed: true; reason: typeof AutoRestartDecisionReasons.OK }
  | { allowed: false; reason: Exclude<AutoRestartDecisionReason, typeof AutoRestartDecisionReasons.OK> }

export type RestartGuardDecision =
  | { ok: true }
  | { ok: false; blocker: RestartGuardBlocker }

// ── Constants ──────────────────────────────────────────────────────────────

/** Max number of times the restart scheduler will reschedule when blocked. */
export const RESTART_RETRY_LIMIT = 8

/** Delay (ms) used for the first restart attempt by default. */
export const RESTART_DEFAULT_INITIAL_DELAY_MS = 150

/** Delay (ms) used when a retry has to re-schedule past a blocking guard. */
export const RESTART_RETRY_BACKOFF_DELAY_MS = 320

/** Delay (ms) used by the bus `restart_voice` effect — slightly tighter so the user feels it as a seamless resume. */
export const RESTART_BUS_EFFECT_DELAY_MS = 60

// No-speech retry tuning (used by the legacy noSpeechRestartCount flow —
// kept here so adjustments live with the rest of the restart policy).
export const NO_SPEECH_RESTART_MIN_DELAY_MS = 420
export const NO_SPEECH_RESTART_STEP_MS = 220
export const NO_SPEECH_RESTART_MAX_DELAY_MS = 1_680

// ── Decision functions ─────────────────────────────────────────────────────

export function shouldAutoRestart(input: ShouldAutoRestartInput): AutoRestartDecision {
  if (!input.continuousActive) {
    return { allowed: false, reason: AutoRestartDecisionReasons.SESSION_INACTIVE }
  }
  if (!input.settings.continuousVoiceModeEnabled) {
    return { allowed: false, reason: AutoRestartDecisionReasons.CONTINUOUS_DISABLED }
  }
  if (input.settings.voiceTriggerMode === 'wake_word') {
    return { allowed: false, reason: AutoRestartDecisionReasons.WAKE_WORD_MODE }
  }
  // Always-on KWS and continuous STT can't both hold the mic. When KWS is
  // always-on, voiceState flips idle ↔ listening on every STT restart, and
  // the wakeword runtime's suspended={voiceState!=='idle'} gate tears down
  // and re-creates the KWS listener on every flip — so KWS never actually
  // stabilizes and the wake word stops firing. Make KWS the single wake
  // path when always-on is set: KWS listens during idle, fires a session,
  // STT handles that one turn, voiceState returns to idle, KWS resumes.
  if (input.settings.wakewordAlwaysOn) {
    return { allowed: false, reason: AutoRestartDecisionReasons.WAKEWORD_ALWAYS_ON }
  }
  return { allowed: true, reason: AutoRestartDecisionReasons.OK }
}

export function shouldKeepContinuousSession(
  input: ShouldKeepContinuousSessionInput,
): boolean {
  return (
    input.settings.continuousVoiceModeEnabled
    && input.settings.voiceTriggerMode !== 'wake_word'
    && !input.settings.wakewordAlwaysOn
  )
}

export function canInterruptSpeech(
  settings: Pick<AppSettings, 'voiceInterruptionEnabled'>,
): boolean {
  return settings.voiceInterruptionEnabled
}

/**
 * Inspect the current runtime snapshot and decide whether starting a voice
 * conversation right now is safe. Returns the first blocker found (the
 * scheduler uses this to decide whether to retry later). Order of checks
 * matches the historical order in continuousVoice.ts so retry behavior is
 * preserved bit-for-bit.
 */
export function evaluateRestartGuards(
  input: RestartGuardInput,
): RestartGuardDecision {
  if (input.hasActiveRecognition) {
    return { ok: false, blocker: RestartGuardBlockers.ACTIVE_RECOGNITION }
  }
  if (input.hasActiveVadSession) {
    return { ok: false, blocker: RestartGuardBlockers.ACTIVE_VAD_SESSION }
  }
  if (input.chatBusy) {
    return { ok: false, blocker: RestartGuardBlockers.CHAT_BUSY }
  }
  if (input.voiceState === 'processing') {
    return { ok: false, blocker: RestartGuardBlockers.VOICE_PROCESSING }
  }
  if (input.voiceState === 'speaking') {
    return { ok: false, blocker: RestartGuardBlockers.VOICE_SPEAKING }
  }
  return { ok: true }
}

/**
 * Backoff curve for no-speech retries. Mirrors the legacy getNoSpeechRestartDelay
 * but lives here so retry tuning is centralized.
 */
export function getNoSpeechRestartDelay(retryCount: number): number {
  const raw = NO_SPEECH_RESTART_MIN_DELAY_MS + retryCount * NO_SPEECH_RESTART_STEP_MS
  return Math.min(NO_SPEECH_RESTART_MAX_DELAY_MS, raw)
}

/**
 * Pick the delay for the next restart attempt.
 *
 * - `initial`: scheduler's first attempt — uses caller-provided delay or the
 *   default initial delay.
 * - `retry`: scheduler rescheduling past a blocking guard — uses the backoff
 *   delay regardless of caller input.
 * - `bus_effect`: invoked from the VoiceBus `restart_voice` effect executor
 *   where the caller already decided to restart — uses the tight default.
 */
export function getRestartDelay(
  scenario: 'initial' | 'retry' | 'bus_effect',
  options: { requested?: number; retryCount?: number } = {},
): number {
  switch (scenario) {
    case 'initial':
      return options.requested ?? RESTART_DEFAULT_INITIAL_DELAY_MS
    case 'retry':
      return RESTART_RETRY_BACKOFF_DELAY_MS
    case 'bus_effect':
      return options.requested ?? RESTART_BUS_EFFECT_DELAY_MS
    default:
      return RESTART_DEFAULT_INITIAL_DELAY_MS
  }
}
