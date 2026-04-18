import type {
  WakewordModelKind,
  WakewordRuntimeState,
} from '../../types'
import {
  checkWakewordAvailability,
  startWakewordListener,
  type WakewordListener,
  type WakewordListenerCallbacks,
  type WakewordListenerOptions,
} from './wakewordListener.ts'

type TimerHandle = ReturnType<typeof globalThis.setTimeout>

export type WakewordRuntimeConfig = {
  enabled: boolean
  wakeWord: string
  suspended?: boolean
  suspendReason?: string
}

export type WakewordAvailabilityStatus = Awaited<ReturnType<typeof checkWakewordAvailability>>

export type WakewordRuntimeController = {
  update: (config: WakewordRuntimeConfig) => Promise<void>
  getState: () => WakewordRuntimeState
  stop: () => void
  destroy: () => void
  // Subscribe to the mic audio frames the wakeword listener is capturing.
  // VAD sessions register here so they can run Silero on the exact same
  // samples KWS is decoding — a single mic stream, no getUserMedia race.
  subscribeMicFrames: (
    subscriber: (samples: Float32Array, sampleRate: number) => void,
  ) => () => void
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
// listening — no audio input device, permission permanently denied, etc.
// Short-circuit retries for these so we don't burn CPU on a known-dead path.
export function isPermanentWakewordError(message: string): boolean {
  const normalized = String(message ?? '').toLowerCase()
  if (!normalized) return false
  return (
    normalized.includes('device not found')
    || normalized.includes('notfounderror')
    || normalized.includes('requested device not found')
    || normalized.includes('permission denied')
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

function buildBaseStatePatch(config: Required<WakewordRuntimeConfig>) {
  return {
    enabled: config.enabled,
    wakeWord: config.wakeWord,
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
    cooldownUntil: '',
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

  let state = createInitialWakewordRuntimeState()
  let config = normalizeWakewordRuntimeConfig({
    enabled: false,
    wakeWord: '',
    suspended: false,
    suspendReason: '',
  })
  let listener: WakewordListener | null = null
  let retryTimer: TimerHandle | null = null
  let cooldownTimer: TimerHandle | null = null
  let disposed = false
  let generation = 0
  let activeListenerId = 0
  let currentActiveListenerId = 0
  let lastTriggeredAtMs = 0
  // When "mic-released" the listener stays alive but its mic stream is
  // released so a concurrent VAD getUserMedia call can grab the device.
  // Main-process KWS engine state is preserved, so on mic reacquire the
  // Zipformer hidden state is still hot — this avoids the "第一次能唤醒，
  // 之后就不行" warmup regression. Also acts as a mute so queued detections
  // during the transition window are swallowed.
  let micReleased = false

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

  function clearCooldownTimer() {
    if (cooldownTimer == null) return
    clearTimeoutFn(cooldownTimer)
    cooldownTimer = null
  }

  function stopListener() {
    const currentListener = listener
    listener = null
    currentActiveListenerId = 0
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
      reason: `唤醒词监听异常，将在 ${Math.round(delayMs / 100) / 10} 秒后重试`,
      retryCount: state.retryCount + 1,
    })
  }

  function scheduleCooldown(untilMs: number) {
    clearCooldownTimer()
    cooldownTimer = setTimeoutFn(() => {
      cooldownTimer = null
      void reconcile()
    }, Math.max(0, untilMs - now()))
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
          ? `唤醒词监听不可用：${message}`
          : `唤醒词监听重试 ${retryMaxAttempts} 次后仍失败：${message}`,
        error: message,
        retryCount: 0,
        cooldownUntil: '',
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
      reason: '唤醒词已命中，正在切入收音',
      error: '',
      retryCount: 0,
      lastKeyword: normalizedKeyword,
      lastTriggeredAt: toIso(nowMs),
      cooldownUntil: '',
    })

    options.onKeywordDetected?.(normalizedKeyword, state)
  }

  async function reconcile() {
    if (disposed) return

    const nextGeneration = generation + 1
    generation = nextGeneration
    const currentConfig = config
    const basePatch = buildBaseStatePatch(currentConfig)

    if (!currentConfig.enabled || !currentConfig.wakeWord) {
      clearRetryTimer()
      clearCooldownTimer()
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
        cooldownUntil: '',
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
      if (listener && state.wakeWord === currentConfig.wakeWord) {
        micReleased = true
        emitState({
          ...basePatch,
          phase: 'paused',
          active: false,
          reason: currentConfig.suspendReason || '唤醒词监听已暂停',
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
        reason: currentConfig.suspendReason || '唤醒词监听已暂停',
        error: '',
      })
      return
    }

    // Leaving suspend — just un-mute, no mic reacquire needed because we
    // never released it. Any stale detections queued during the voice turn
    // were already dropped by the handleKeywordDetected mute check.
    micReleased = false

    if (state.cooldownUntil) {
      const cooldownUntilMs = Date.parse(state.cooldownUntil)
      if (Number.isFinite(cooldownUntilMs) && cooldownUntilMs > now()) {
        stopListener()
        scheduleCooldown(cooldownUntilMs)
        emitState({
          ...basePatch,
          phase: 'cooldown',
          active: false,
          available: true,
          reason: '唤醒词命中冷却中',
          error: '',
        })
        return
      }
    }

    clearCooldownTimer()

    if (
      listener
      && (state.phase === 'listening' || state.phase === 'paused')
      && state.wakeWord === currentConfig.wakeWord
    ) {
      clearRetryTimer()
      emitState({
        ...basePatch,
        phase: 'listening',
        active: true,
        available: true,
        reason: '',
        error: '',
        cooldownUntil: '',
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
      reason: '正在检查唤醒词模型',
      error: '',
      modelKind: null,
      cooldownUntil: '',
    })

    let availability: WakewordAvailabilityStatus
    try {
      availability = await checkAvailability({ wakeWord: currentConfig.wakeWord })
    } catch (error) {
      if (disposed || nextGeneration !== generation) return
      handleRecoverableError(
        normalizeRuntimeError(error, '唤醒词状态检查失败'),
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
        reason: availability.reason?.trim() || '唤醒词模型当前不可用',
        error: '',
        retryCount: 0,
        cooldownUntil: '',
      })
      return
    }

    emitState({
      ...basePatch,
      phase: 'starting',
      active: false,
      available: true,
      modelKind: availability.modelKind ?? null,
      reason: '正在启动唤醒词监听',
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
        wakeWord: currentConfig.wakeWord,
      })

      if (disposed || nextGeneration !== generation) {
        nextListener.stop()
        return
      }

      listener = nextListener
      currentActiveListenerId = myListenerId
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
        normalizeRuntimeError(error, '唤醒词监听启动失败'),
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
      clearRetryTimer()
      clearCooldownTimer()
      micReleased = false
      stopListener()
      emitState({
        phase: 'disabled',
        active: false,
        available: false,
        reason: '',
        error: '',
        retryCount: 0,
        cooldownUntil: '',
      })
    },
    destroy() {
      if (disposed) return
      disposed = true
      generation += 1
      clearRetryTimer()
      clearCooldownTimer()
      micReleased = false
      stopListener()
    },
    subscribeMicFrames(subscriber) {
      if (!listener) return () => undefined
      return listener.subscribeFrames(subscriber)
    },
  }
}
