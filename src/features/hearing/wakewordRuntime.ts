import type {
  TranslationKey,
  TranslationParams,
  WakewordModelKind,
  WakewordRuntimeState,
} from '../../types'
import {
  checkWakewordAvailability,
  startWakewordListener,
  type WakewordFrameSubscriber,
  type WakewordListener,
  type WakewordListenerCallbacks,
  type WakewordListenerOptions,
} from './wakewordListener.ts'
import { getPrimaryWakeWord } from './core.ts'

type Translator = (key: TranslationKey, params?: TranslationParams) => string

type TimerHandle = ReturnType<typeof globalThis.setTimeout>

type WakewordRuntimeConfig = {
  enabled: boolean
  wakeWord: string
  suspended?: boolean
  suspendReason?: string
}

type WakewordAvailabilityStatus = Awaited<ReturnType<typeof checkWakewordAvailability>>

export type WakewordRuntimeController = {
  update: (config: WakewordRuntimeConfig) => Promise<void>
  getState: () => WakewordRuntimeState
  stop: () => void
  destroy: () => void
  // Subscribe to the mic audio frames the wakeword listener is capturing.
  // VAD sessions register here so they can run Silero on the exact same
  // samples KWS is decoding — a single mic stream, no getUserMedia race.
  // The registration lives on the runtime, not on a listener instance: if
  // the listener errors mid-session and the retry loop rebuilds it, the
  // subscriber is re-attached to the new listener automatically instead of
  // starving silently.
  subscribeMicFrames: (
    subscriber: (samples: Float32Array, sampleRate: number) => void,
  ) => () => void
  // True while a listener is actively capturing mic frames — i.e. a
  // subscribeMicFrames() registration receives audio right now. False when
  // no listener is live (error/retry backoff, or a paused window after the
  // listener was torn down); VAD sessions must treat that as "shared-frame
  // path unavailable" and fall back to their own mic capture instead of
  // subscribing into silence.
  hasActiveFrameSource: () => boolean
}

type WakewordRuntimeOptions = {
  checkAvailability?: (options?: WakewordListenerOptions) => Promise<WakewordAvailabilityStatus>
  startListener?: (
    callbacks: WakewordListenerCallbacks,
    options?: WakewordListenerOptions,
  ) => Promise<WakewordListener>
  onStateChange?: (nextState: WakewordRuntimeState, previousState: WakewordRuntimeState) => void
  onKeywordDetected?: (keyword: string, state: WakewordRuntimeState) => void
  now?: () => number
  setTimeoutFn?: (callback: () => void, delayMs: number) => TimerHandle
  clearTimeoutFn?: (timer: TimerHandle) => void
  triggerCooldownMs?: number
  retryBaseMs?: number
  retryMaxMs?: number
  retryMaxAttempts?: number
  ti?: Translator
}

// Lowered from 1500 ms: the 1.5 s cooldown was long enough that a user
// repeating the wake word after a missed session (noSpeechTimer tore down
// the VAD, user re-invokes) could still hit the cooldown guard on the
// second call. 500 ms is still well above the ~300 ms typical gap between
// two naturally-pronounced wake-word utterances, so it filters the real
// double-fire (engine re-hits on the tail audio of a single invocation)
// without blocking deliberate re-invocations.
const DEFAULT_TRIGGER_COOLDOWN_MS = 500
const DEFAULT_RETRY_BASE_MS = 1_200
const DEFAULT_RETRY_MAX_MS = 10_000
// Give up after N failed retries and mark the listener as unavailable.
// Infinite retries on machines with no mic hardware (e.g. a headless Mac
// mini) otherwise floods React with setState cascades from each cycle's
// state emit + pet-status toast + voiceBus event, eventually tripping
// "Maximum update depth exceeded".
const DEFAULT_RETRY_MAX_ATTEMPTS = 5

// Errors that indicate the environment genuinely can't support wakeword
// listening — permission permanently denied, runtime doesn't ship the
// wakeword model, etc. Short-circuit retries for these so we don't burn
// CPU on a known-dead path.
//
// Device-level errors (`NotFoundError` / "requested device not found") are
// *not* permanent even though they sound like it: Bluetooth headsets
// transiently report "no input device" while macOS switches them between
// A2DP (music) and HFP (call) profiles on startup. Under the old rule
// wakeword would die permanently on every Nexus launch if the user was
// wearing AirPods. The normal retry-with-backoff path (5 attempts over
// ~30 s) is exactly what that class of error wants — the `MAX_ATTEMPTS`
// cap still bounds CPU usage on a truly mic-less machine.
export function isPermanentWakewordError(message: string): boolean {
  const normalized = String(message ?? '').toLowerCase()
  if (!normalized) return false
  return (
    normalized.includes('permission denied')
    || normalized.includes('notallowederror')
    || normalized.includes('当前环境不支持唤醒词')
  )
}

function toIso(timestampMs: number) {
  return new Date(timestampMs).toISOString()
}

function normalizeWakewordRuntimeConfig(config: WakewordRuntimeConfig): Required<WakewordRuntimeConfig> {
  return {
    enabled: Boolean(config.enabled),
    wakeWord: String(config.wakeWord ?? '').trim(),
    suspended: Boolean(config.suspended),
    suspendReason: String(config.suspendReason ?? '').trim(),
  }
}

function normalizeWakewordListenerInput(value: string) {
  return String(value ?? '').trim()
}

function buildBaseStatePatch(config: Required<WakewordRuntimeConfig>) {
  const wakeWord = getPrimaryWakeWord(config.wakeWord)
  return {
    enabled: config.enabled,
    wakeWord,
    suspended: config.suspended,
    suspendReason: config.suspendReason,
  }
}

function normalizeRuntimeError(error: unknown, fallbackMessage: string) {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : ''

  return message.trim() || fallbackMessage
}

export function createInitialWakewordRuntimeState(): WakewordRuntimeState {
  return {
    phase: 'disabled',
    enabled: false,
    wakeWord: '',
    active: false,
    available: false,
    suspended: false,
    suspendReason: '',
    retryCount: 0,
    modelKind: null,
    reason: '',
    error: '',
    lastKeyword: '',
    lastTriggeredAt: '',
    lastStartedAt: '',
    updatedAt: toIso(Date.now()),
  }
}

export function getWakewordRetryDelayMs(
  attempt: number,
  baseMs = DEFAULT_RETRY_BASE_MS,
  maxMs = DEFAULT_RETRY_MAX_MS,
) {
  const normalizedAttempt = Math.max(0, Math.floor(attempt))
  return Math.min(maxMs, baseMs * (2 ** normalizedAttempt))
}

export function shouldIgnoreWakewordTrigger(options: {
  lastTriggeredAtMs: number
  nowMs: number
  cooldownMs: number
}) {
  const { lastTriggeredAtMs, nowMs, cooldownMs } = options
  return lastTriggeredAtMs > 0 && nowMs - lastTriggeredAtMs < cooldownMs
}

export function createWakewordRuntime(
  options: WakewordRuntimeOptions = {},
): WakewordRuntimeController {
  const now = options.now ?? (() => Date.now())
  const setTimeoutFn = options.setTimeoutFn ?? ((callback, delayMs) => globalThis.setTimeout(callback, delayMs))
  const clearTimeoutFn = options.clearTimeoutFn ?? ((timer) => globalThis.clearTimeout(timer))
  const checkAvailability = options.checkAvailability ?? checkWakewordAvailability
  const startListener = options.startListener ?? startWakewordListener
  const triggerCooldownMs = options.triggerCooldownMs ?? DEFAULT_TRIGGER_COOLDOWN_MS
  const retryBaseMs = options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS
  const retryMaxMs = options.retryMaxMs ?? DEFAULT_RETRY_MAX_MS
  const retryMaxAttempts = options.retryMaxAttempts ?? DEFAULT_RETRY_MAX_ATTEMPTS
  const ti: Translator = options.ti ?? ((key) => String(key))

  let state = createInitialWakewordRuntimeState()
  let config = normalizeWakewordRuntimeConfig({
    enabled: false,
    wakeWord: '',
    suspended: false,
    suspendReason: '',
  })
  let listener: WakewordListener | null = null
  let retryTimer: TimerHandle | null = null
  let disposed = false
  let generation = 0
  let activeListenerId = 0
  let currentActiveListenerId = 0
  let lastTriggeredAtMs = 0
  let activeListenerWakeWord = ''
  // When "mic-released" the listener stays alive but its mic stream is
  // released so a concurrent VAD getUserMedia call can grab the device.
  // Main-process KWS engine state is preserved, so on mic reacquire the
  // Zipformer hidden state is still hot — this avoids the "第一次能唤醒，
  // 之后就不行" warmup regression. Also acts as a mute so queued detections
  // during the transition window are swallowed.
  let micReleased = false
  // Frame subscribers are registered on the runtime, not on a listener
  // instance. Previously subscribeMicFrames() forwarded to the *current*
  // listener, so when that listener errored mid-VAD-session and stopListener()
  // tore it down, the mainVAD subscription died with it and nothing re-
  // subscribed after the retry loop rebuilt the listener — mainVAD starved
  // and the 3s noSpeechTimer silently dropped the voice turn. The bridge
  // below is detached on every teardown and re-attached to every rebuilt
  // listener, so a subscription lives as long as its caller wants it to.
  const frameSubscribers = new Set<WakewordFrameSubscriber>()
  let frameBridgeUnsubscribe: (() => void) | null = null

  function detachFrameBridge() {
    frameBridgeUnsubscribe?.()
    frameBridgeUnsubscribe = null
  }

  function attachFrameBridge(nextListener: WakewordListener) {
    detachFrameBridge()
    if (frameSubscribers.size === 0) return
    frameBridgeUnsubscribe = nextListener.subscribeFrames((samples, sampleRate) => {
      for (const subscriber of frameSubscribers) {
        try {
          subscriber(samples, sampleRate)
        } catch (error) {
          console.warn('[Wake] frame subscriber error:', error)
        }
      }
    })
  }

  function emitState(patch: Partial<WakewordRuntimeState>) {
    const previousState = state
    state = {
      ...state,
      ...patch,
      updatedAt: toIso(now()),
    }
    options.onStateChange?.(state, previousState)
  }

  function clearRetryTimer() {
    if (retryTimer == null) return
    clearTimeoutFn(retryTimer)
    retryTimer = null
  }

  function stopListener() {
    const currentListener = listener
    listener = null
    detachFrameBridge()
    currentActiveListenerId = 0
    activeListenerWakeWord = ''
    currentListener?.stop()
  }

  function scheduleRetry() {
    clearRetryTimer()
    const delayMs = getWakewordRetryDelayMs(state.retryCount, retryBaseMs, retryMaxMs)
    retryTimer = setTimeoutFn(() => {
      retryTimer = null
      void reconcile()
    }, delayMs)

    emitState({
      phase: 'error',
      active: false,
      available: true,
      reason: ti('voice.wakeword.retry_in_seconds', { seconds: Math.round(delayMs / 100) / 10 }),
      retryCount: state.retryCount + 1,
    })
  }

  function handleRecoverableError(message: string, modelKind: WakewordModelKind) {
    stopListener()

    const giveUp = isPermanentWakewordError(message) || state.retryCount >= retryMaxAttempts
    if (giveUp) {
      clearRetryTimer()
      emitState({
        ...buildBaseStatePatch(config),
        phase: 'unavailable',
        active: false,
        available: false,
        modelKind,
        reason: isPermanentWakewordError(message)
          ? ti('voice.wakeword.unavailable_with_detail', { message })
          : ti('voice.wakeword.retry_max_attempts_failed', { max: retryMaxAttempts, message }),
        error: message,
        retryCount: 0,
      })
      return
    }

    scheduleRetry()
    emitState({
      ...buildBaseStatePatch(config),
      phase: 'error',
      active: false,
      available: true,
      modelKind,
      error: message,
    })
  }

  function handleKeywordDetected(keyword: string) {
    if (micReleased) {
      // Mic is released during voice session — any stale detection queued
      // before the release gets dropped so TTS playback doesn't self-trigger.
      return
    }

    const normalizedKeyword = String(keyword ?? '').trim()
    const nowMs = now()

    if (shouldIgnoreWakewordTrigger({
      lastTriggeredAtMs,
      nowMs,
      cooldownMs: triggerCooldownMs,
    })) {
      return
    }

    lastTriggeredAtMs = nowMs
    clearRetryTimer()
    // Keep the listener running — feed() already called spotter.reset() to
    // clear the decoder state, and shouldIgnoreWakewordTrigger debounces
    // duplicate hits for triggerCooldownMs. Tearing down the listener here
    // would force a full checkAvailability → startListener → new stream
    // cycle on the next reconcile, which empties the Zipformer hidden state
    // and makes the next utterance need ~1 "warmup" call before it fires.
    // The actual mic hand-off to voice recording is handled by the
    // suspended={voiceState !== 'idle'} path in useVoice.ts, not here.

    emitState({
      ...buildBaseStatePatch(config),
      phase: 'listening',
      active: true,
      available: true,
      reason: ti('voice.wakeword.hit_triggered'),
      error: '',
      retryCount: 0,
      lastKeyword: normalizedKeyword,
      lastTriggeredAt: toIso(nowMs),
    })

    options.onKeywordDetected?.(normalizedKeyword, state)
  }

  async function reconcile() {
    if (disposed) return

    const nextGeneration = generation + 1
    generation = nextGeneration
    const currentConfig = config
    const basePatch = buildBaseStatePatch(currentConfig)
    const primaryWakeWord = basePatch.wakeWord
    const activeKeywords = normalizeWakewordListenerInput(currentConfig.wakeWord)

    if (state.wakeWord !== primaryWakeWord) {
      activeListenerWakeWord = ''
    }

    if (!currentConfig.enabled || !primaryWakeWord) {
      clearRetryTimer()
      micReleased = false
      stopListener()
      emitState({
        ...basePatch,
        phase: 'disabled',
        active: false,
        available: false,
        modelKind: null,
        reason: '',
        error: '',
        retryCount: 0,
      })
      return
    }

    if (currentConfig.suspended) {
      clearRetryTimer()
      // VAD and KWS now share the same underlying mic stream (the VAD
      // starter clones the wakeword listener's MediaStream instead of
      // calling getUserMedia a second time), so we don't tear anything
      // down during suspend — just flip the mute flag so queued KWS hits
      // are dropped while the user's in a voice turn. Keeps the KWS
      // Zipformer hidden state hot for instant wake-word matching when
      // the voice session ends. Wake word config changes still need a
      // full rebuild, hence the listener+wakeword equality check.
      if (
        listener
        && state.wakeWord === primaryWakeWord
        && activeListenerWakeWord === activeKeywords
      ) {
        micReleased = true
        emitState({
          ...basePatch,
          phase: 'paused',
          active: false,
          reason: currentConfig.suspendReason || ti('voice.wakeword.paused_default'),
          error: '',
        })
        return
      }
      micReleased = false
      stopListener()
      emitState({
        ...basePatch,
        phase: 'paused',
        active: false,
        reason: currentConfig.suspendReason || ti('voice.wakeword.paused_default'),
        error: '',
      })
      return
    }

    // Leaving suspend — just un-mute, no mic reacquire needed because we
    // never released it. Any stale detections queued during the voice turn
    // were already dropped by the handleKeywordDetected mute check.
    micReleased = false

    if (
      listener
      && (state.phase === 'listening' || state.phase === 'paused')
      && state.wakeWord === primaryWakeWord
      && activeListenerWakeWord === activeKeywords
    ) {
      clearRetryTimer()
      emitState({
        ...basePatch,
        phase: 'listening',
        active: true,
        available: true,
        reason: '',
        error: '',
        retryCount: 0,
      })
      return
    }

    clearRetryTimer()
    stopListener()
    emitState({
      ...basePatch,
      phase: 'checking',
      active: false,
      available: false,
      reason: ti('voice.wakeword.checking_model'),
      error: '',
      modelKind: null,
    })

    let availability: WakewordAvailabilityStatus
    try {
      availability = await checkAvailability({ wakeWord: activeKeywords || primaryWakeWord })
    } catch (error) {
      if (disposed || nextGeneration !== generation) return
      handleRecoverableError(
        normalizeRuntimeError(error, ti('voice.wakeword.status_check_failed')),
        null,
      )
      return
    }

    if (disposed || nextGeneration !== generation) return

    if (!availability.installed || !availability.modelFound) {
      clearRetryTimer()
      emitState({
        ...basePatch,
        phase: 'unavailable',
        active: false,
        available: false,
        modelKind: availability.modelKind ?? null,
        reason: availability.reason?.trim() || ti('voice.wakeword.model_unavailable'),
        error: '',
        retryCount: 0,
      })
      return
    }

    emitState({
      ...basePatch,
      phase: 'starting',
      active: false,
      available: true,
      modelKind: availability.modelKind ?? null,
      reason: ti('voice.wakeword.starting'),
      error: '',
    })

    const myListenerId = ++activeListenerId

    try {
      const nextListener = await startListener({
        onKeywordDetected: (keyword) => {
          if (disposed || currentActiveListenerId !== myListenerId) return
          handleKeywordDetected(keyword)
        },
        onError: (message) => {
          if (disposed || currentActiveListenerId !== myListenerId) return
          handleRecoverableError(message, availability.modelKind ?? null)
        },
      }, {
        wakeWord: activeKeywords || primaryWakeWord,
        ti: options.ti,
      })

      if (disposed || nextGeneration !== generation) {
        nextListener.stop()
        return
      }

      listener = nextListener
      attachFrameBridge(nextListener)
      currentActiveListenerId = myListenerId
      activeListenerWakeWord = activeKeywords || primaryWakeWord
      clearRetryTimer()
      emitState({
        ...basePatch,
        phase: 'listening',
        active: true,
        available: true,
        modelKind: availability.modelKind ?? null,
        reason: '',
        error: '',
        retryCount: 0,
        lastStartedAt: toIso(now()),
      })
    } catch (error) {
      if (disposed || nextGeneration !== generation) return
      handleRecoverableError(
        normalizeRuntimeError(error, ti('voice.wakeword.listener_start_failed')),
        availability.modelKind ?? null,
      )
    }
  }

  return {
    async update(nextConfig) {
      config = normalizeWakewordRuntimeConfig(nextConfig)
      await reconcile()
    },
    getState() {
      return state
    },
    stop() {
      generation += 1
      config = normalizeWakewordRuntimeConfig({
        enabled: false,
        wakeWord: '',
        suspended: false,
        suspendReason: '',
      })
      clearRetryTimer()
      micReleased = false
      activeListenerWakeWord = ''
      stopListener()
      emitState({
        ...buildBaseStatePatch(config),
        phase: 'disabled',
        active: false,
        available: false,
        modelKind: null,
        reason: '',
        error: '',
        retryCount: 0,
      })
    },
    destroy() {
      if (disposed) return
      disposed = true
      generation += 1
      clearRetryTimer()
      micReleased = false
      activeListenerWakeWord = ''
      stopListener()
    },
    subscribeMicFrames(subscriber) {
      frameSubscribers.add(subscriber)
      if (listener && !frameBridgeUnsubscribe) {
        attachFrameBridge(listener)
      }
      return () => {
        frameSubscribers.delete(subscriber)
        if (frameSubscribers.size === 0) {
          detachFrameBridge()
        }
      }
    },
    hasActiveFrameSource() {
      return listener != null
    },
  }
}
