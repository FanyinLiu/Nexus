/**
 * One start-voice click may open the microphone only while its window is
 * still showing. Saving the switches does not open it. Settings stays open
 * through the system permission prompt and closes only once the stream is
 * live; closing earlier drops a grant that arrives seconds later. A denial
 * leaves Settings open, puts the switches back, and never asks again. If the
 * window hides before the stream is live, that click is finished: showing
 * the window, opening chat, or waiting must not ask for the microphone
 * again. A stream that is already live is left running. A later click may
 * try again.
 */

export type VoiceCaptureOutcome = 'open' | 'cancelled' | 'released' | 'denied'

type VoiceCapturePhase = 'idle' | 'pending' | 'open' | 'cancelled'

type Attempt = {
  id: number
  phase: Exclude<VoiceCapturePhase, 'idle'>
  outcome: VoiceCaptureOutcome | null
  resolve: (outcome: VoiceCaptureOutcome) => void
  onCancel: Array<() => void>
}

let sequence = 0
let current: Attempt | null = null
let boundAttemptId: number | null = null

function finish(attempt: Attempt, outcome: VoiceCaptureOutcome) {
  if (attempt.phase !== 'pending') return
  attempt.phase = outcome === 'open' ? 'open' : 'cancelled'
  attempt.outcome = outcome
  const listeners = attempt.onCancel
  attempt.onCancel = []
  // A live stream is already in use. Every other finish wakes a prompt that
  // is still waiting so its grant cannot land later. The microphone opener
  // handles that wake-up after the prompt itself has already failed.
  if (outcome !== 'open') {
    for (const listener of listeners) listener()
  }
  attempt.resolve(outcome)
}

/** The click that may still open the microphone, or null when none is pending. */
export function pendingVoiceCaptureAttempt(): number | null {
  return current?.phase === 'pending' ? current.id : null
}

/** Phase of the latest click. Idle when the user has not clicked in this page. */
export function voiceCapturePhase(): VoiceCapturePhase {
  return current?.phase ?? 'idle'
}

/**
 * Attempt id closed over by an in-flight start. Wake word does not read this.
 * A cancelled id stays bound until the start that captured it finishes, so a
 * late microphone call still belongs to the click that was cancelled.
 */
export function boundVoiceCaptureAttempt(): number | null {
  return boundAttemptId
}

/** Begin the open that belongs to this click. A previous pending click is cancelled. */
export function beginVoiceCaptureAttempt(): number {
  if (current?.phase === 'pending') finish(current, 'cancelled')
  sequence += 1
  current = {
    id: sequence,
    phase: 'pending',
    outcome: null,
    resolve: () => {},
    onCancel: [],
  }
  return current.id
}

/** Resolves when this click's microphone opens, is cancelled, or is given up. */
export function voiceCaptureSettled(id: number): Promise<VoiceCaptureOutcome> {
  if (!current || current.id !== id) return Promise.resolve('cancelled')
  if (current.outcome) return Promise.resolve(current.outcome)
  const attempt = current
  return new Promise((done) => {
    const previous = attempt.resolve
    attempt.resolve = (outcome) => {
      previous(outcome)
      done(outcome)
    }
  })
}

/**
 * Hide or close before the stream is live. An open stream stays open.
 * Returns true when a pending open was cancelled.
 */
export function cancelVoiceCaptureIfUnopened(): boolean {
  if (!current || current.phase !== 'pending') return false
  finish(current, 'cancelled')
  return true
}

/**
 * The user refused the permission prompt. The click is finished, Settings
 * stays open, and a later show or timer must not call getUserMedia again.
 */
export function denyVoiceCapture(id: number): void {
  if (!current || current.id !== id || current.phase !== 'pending') return
  finish(current, 'denied')
}

/**
 * The start path is not going to open a microphone (missing model, refused
 * for a reason other than the permission prompt). The click stays finished.
 * Settings stays open until a stream is actually live.
 */
export function releaseVoiceCaptureWithoutMicrophone(id: number | null): void {
  if (id === null || !current || current.id !== id || current.phase !== 'pending') return
  finish(current, 'released')
}

/** Whether this click may call getUserMedia. Hidden cancels the click. */
export function voiceCaptureMayRequestMicrophone(id: number, visible: boolean): boolean {
  if (!current || current.id !== id || current.phase !== 'pending') return false
  if (!visible) {
    finish(current, 'cancelled')
    return false
  }
  return true
}

/** Resolves when this click is cancelled. Stays pending once the stream is live. */
export function whenVoiceCaptureCancelled(id: number): Promise<void> {
  if (!current || current.id !== id || current.phase === 'cancelled') return Promise.resolve()
  if (current.phase !== 'pending') return new Promise(() => {})
  return new Promise((resolve) => {
    current?.onCancel.push(resolve)
  })
}

/**
 * A grant may be kept only while this click is still pending and the window
 * is visible. Hidden cancels the click. This does not mark the stream live;
 * the caller does that after it has a track it will actually use.
 */
export function voiceCaptureGrantIsUsable(id: number, visible: boolean): boolean {
  if (!current || current.id !== id || current.phase !== 'pending') return false
  if (!visible) {
    finish(current, 'cancelled')
    return false
  }
  return true
}

/**
 * The grant is usable only while this click is still the pending one and the
 * window is visible. A late grant after hide must be discarded by the caller.
 */
export function markVoiceCaptureOpened(id: number, visible: boolean): boolean {
  if (!current || current.id !== id || current.phase !== 'pending') return false
  if (!visible) {
    finish(current, 'cancelled')
    return false
  }
  finish(current, 'open')
  return true
}

/**
 * Keep `boundAttemptId` set for the whole start, including across the await
 * that reaches getUserMedia. A null id is a start that did not come from the
 * click (wake word, restart) and is not gated.
 */
export async function withVoiceCaptureAttempt<T>(
  id: number | null,
  run: () => Promise<T>,
): Promise<T> {
  if (id === null) return run()
  const previous = boundAttemptId
  boundAttemptId = id
  try {
    return await run()
  } finally {
    if (boundAttemptId === id) boundAttemptId = previous
    releaseVoiceCaptureWithoutMicrophone(id)
  }
}

export class VoiceCaptureCancelledError extends Error {
  constructor() {
    super('voice_capture_cancelled')
    this.name = 'VoiceCaptureCancelledError'
  }
}

/** True when the microphone open was dropped because the window closed first. */
export function isVoiceCaptureCancelled(error: unknown): boolean {
  return error instanceof VoiceCaptureCancelledError
}

type VoiceSwitchPatch = {
  speechInputEnabled: boolean
  speechOutputEnabled: boolean
}

/**
 * The permission prompt was refused, so the click must not leave listening
 * and speaking on. Those switches are what the screen uses to say voice works.
 */
export function voiceSwitchesAfterMicrophoneDenied<T extends {
  speechInputEnabled: boolean
  speechOutputEnabled: boolean
}>(draft: T): T {
  return {
    ...draft,
    speechInputEnabled: false,
    speechOutputEnabled: false,
  }
}

/**
 * Persist the click's switch change before anything may open the microphone.
 * A speaking switch left off while listening is already on is not rewritten:
 * that click has no patch. A failed save must reject so the click does not start.
 */
export async function saveVoiceStartSwitches<T extends {
  speechInputEnabled: boolean
  speechOutputEnabled: boolean
}>(input: {
  patch?: VoiceSwitchPatch
  dirty: boolean
  draft: T
  commitDraft: (draft: T) => Promise<void>
}): Promise<void> {
  if (!input.patch && !input.dirty) return
  const nextDraft = input.patch ? { ...input.draft, ...input.patch } : input.draft
  await input.commitDraft(nextDraft)
}

export type StartVoiceClickActions = {
  visible: () => boolean
  subscribeHidden: (onHidden: () => void) => () => void
  saveSwitches: () => Promise<void>
  start: () => void
  /** Persist the switches off after a permission denial. Settings stays open. */
  revertSwitches?: () => Promise<void>
  closeSurface: () => void
}

/**
 * Save, then open the microphone only if the window is still visible.
 * Settings closes only after the stream is live, so a permission prompt
 * that takes several seconds still belongs to this click. A denial reverts
 * the switches and leaves the surface open. Hiding before the stream is
 * live cancels the click and does not close again.
 */
export async function runStartVoiceClick(actions: StartVoiceClickActions): Promise<VoiceCaptureOutcome> {
  await actions.saveSwitches()
  if (!actions.visible()) {
    cancelVoiceCaptureIfUnopened()
    return 'cancelled'
  }
  const id = beginVoiceCaptureAttempt()
  const unsubscribe = actions.subscribeHidden(() => {
    cancelVoiceCaptureIfUnopened()
  })
  // Subscribe before start. A click that hides inside the start call settles
  // synchronously, and the waiter has to be in place to see that outcome.
  const settled = voiceCaptureSettled(id)
  try {
    actions.start()
    const outcome = await settled
    if (outcome === 'denied') await actions.revertSwitches?.()
    if (outcome === 'open') actions.closeSurface()
    return outcome
  } finally {
    unsubscribe()
  }
}

/** Drop attempt state. Tests only. */
export function resetVoiceCaptureAttemptForTests(): void {
  current = null
  boundAttemptId = null
  sequence = 0
}
