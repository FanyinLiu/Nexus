import type { MutableRefObject, RefObject } from 'react'
import {
  createWakewordRuntime,
  type WakewordRuntimeController,
} from '../../features/hearing/wakewordRuntime.ts'
import type { VoiceBusEvent } from '../../features/voice/busEvents'
import { VoiceReasonCodes } from '../../features/voice/voiceReasonCodes'
import type {
  TranslationKey,
  TranslationParams,
  VoicePipelineState,
  VoiceState,
  VoiceTraceEntry,
  WakewordRuntimeState,
} from '../../types'

type Translator = (key: TranslationKey, params?: TranslationParams) => string
import type { BrowserSpeechRecognition } from '../../lib/voice'
import type { ParaformerStreamSession } from '../../features/hearing/localParaformer.ts'
import type { SenseVoiceStreamSession } from '../../features/hearing/localSenseVoice.ts'
import type { TencentAsrStreamSession } from '../../features/hearing/tencentAsr.ts'
import type { VadConversationSession, VoiceConversationOptions } from './types'

type BusEmit = (event: VoiceBusEvent) => void

type ShowPetStatus = (
  message: string,
  duration?: number,
  dedupeWindowMs?: number,
) => void

export type AcknowledgeWakewordAndStartListeningRuntimeOptions = {
  keyword: string
  wakewordAcknowledgingRef: MutableRefObject<boolean>
  wakewordAckTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>
  showPetStatus: ShowPetStatus
  updateVoicePipeline: (
    step: VoicePipelineState['step'],
    detail: string,
    transcript?: string,
  ) => void
  startVoiceConversation: (options?: VoiceConversationOptions) => void
  ti: Translator
}

export type HandleWakewordRuntimeStateChangeRuntimeOptions = {
  nextState: WakewordRuntimeState
  previousState: WakewordRuntimeState
  setWakewordState: (state: WakewordRuntimeState) => void
  appendVoiceTrace: (
    title: string,
    detail: string,
    tone?: VoiceTraceEntry['tone'],
  ) => void
  showPetStatus: ShowPetStatus
  busEmit?: BusEmit
  ti: Translator
}

export type HandleWakewordKeywordDetectedRuntimeOptions = {
  keyword: string
  voiceStateRef: MutableRefObject<VoiceState>
  busyRef: RefObject<boolean>
  wakewordAcknowledgingRef: MutableRefObject<boolean>
  // Concrete session refs — the guard checks these directly instead of
  // trusting voiceStateRef, which can drift between the old session
  // machine and the new voice bus (they both write it, and the old
  // machine never fires `session_completed` in the direct_send success
  // path, leaving the ref stuck at 'processing' after a turn).
  vadSessionRef: MutableRefObject<VadConversationSession | null>
  recognitionRef: MutableRefObject<BrowserSpeechRecognition | null>
  paraformerSessionRef: MutableRefObject<ParaformerStreamSession | null>
  sensevoiceSessionRef: MutableRefObject<SenseVoiceStreamSession | null>
  tencentAsrSessionRef: MutableRefObject<TencentAsrStreamSession | null>
  appendVoiceTrace: (
    title: string,
    detail: string,
    tone?: VoiceTraceEntry['tone'],
  ) => void
  acknowledgeWakewordAndStartListening: (keyword: string) => void
  busEmit?: BusEmit
}

export type CreateWakewordRuntimeBindingOptions = {
  wakewordRuntimeRef: MutableRefObject<WakewordRuntimeController | null>
  wakewordRuntimeStateChangeRef: MutableRefObject<(
    nextState: WakewordRuntimeState,
    previousState: WakewordRuntimeState,
  ) => void>
  wakewordKeywordDetectedRef: MutableRefObject<(keyword: string) => void>
  setWakewordState: (state: WakewordRuntimeState) => void
  ti: Translator
}

const WAKEWORD_ACK_STATUS_KEYS: TranslationKey[] = [
  'voice.wakeword.ack.1',
  'voice.wakeword.ack.2',
  'voice.wakeword.ack.3',
  'voice.wakeword.ack.4',
  'voice.wakeword.ack.5',
  'voice.wakeword.ack.6',
  'voice.wakeword.ack.7',
  'voice.wakeword.ack.8',
  'voice.wakeword.ack.9',
  'voice.wakeword.ack.10',
]

// Grace window between wake-word detection and VAD subscription start.
// The old 420 ms value was chosen to hide a short browser-TTS ack that's
// since been removed. With the new main-process VAD, any speech the user
// produces during this window is lost (VAD doesn't buffer pre-subscribe
// audio), so keep it as short as possible — just enough for the renderer
// to set up the subscription before the next ScriptProcessor frame.
// ScriptProcessor emits frames every ~64 ms (1024 samples @ 16 kHz); one
// macrotask turn (~4-8 ms typical) is plenty for the subscription to
// register before the next frame, so 30 ms leaves ~34 ms of headroom
// without swallowing a full audio frame of the user's follow-up command.
// Also shortens how long `wakewordAcknowledgingRef` stays true, which is
// what actually debounces a second wake hit if the user says the wake
// word twice quickly.
const WAKEWORD_ACK_DELAY_MS = 30

function pickAckStatus(ti: Translator) {
  const key = WAKEWORD_ACK_STATUS_KEYS[
    Math.floor(Math.random() * WAKEWORD_ACK_STATUS_KEYS.length)
  ]
  return ti(key)
}

export function acknowledgeWakewordAndStartListeningRuntime(
  options: AcknowledgeWakewordAndStartListeningRuntimeOptions,
) {
  if (options.wakewordAcknowledgingRef.current) {
    return
  }

  options.wakewordAcknowledgingRef.current = true

  options.showPetStatus(pickAckStatus(options.ti), 1_600, 1_000)
  options.updateVoicePipeline('recognized', options.ti('voice.pipeline.wake_word_detected', { keyword: options.keyword }))

  // Clear any previous pending ack (defensive — shouldn't happen given the
  // acknowledging ref guard above, but preserves the invariant that only one
  // pending ack can be in flight).
  if (options.wakewordAckTimerRef.current) {
    clearTimeout(options.wakewordAckTimerRef.current)
  }

  options.wakewordAckTimerRef.current = setTimeout(() => {
    options.wakewordAckTimerRef.current = null
    options.wakewordAcknowledgingRef.current = false
    options.startVoiceConversation({ wakewordTriggered: true })
  }, WAKEWORD_ACK_DELAY_MS)
}

/**
 * Cancel any in-flight wakeword-ack → start-conversation timer.
 *
 * Called when the wakeword runtime is torn down (user turns voice off,
 * component unmounts, etc.) — without this, the 30 ms delayed callback
 * fires against stale refs and may spawn a VAD session after teardown.
 */
export function cancelPendingWakewordAck(options: {
  wakewordAcknowledgingRef: MutableRefObject<boolean>
  wakewordAckTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>
}) {
  if (options.wakewordAckTimerRef.current) {
    clearTimeout(options.wakewordAckTimerRef.current)
    options.wakewordAckTimerRef.current = null
  }
  options.wakewordAcknowledgingRef.current = false
}

export function handleWakewordRuntimeStateChangeRuntime(
  options: HandleWakewordRuntimeStateChangeRuntimeOptions,
) {
  options.setWakewordState(options.nextState)

  const phaseChanged = options.nextState.phase !== options.previousState.phase
  const wakeWordChanged = options.nextState.wakeWord !== options.previousState.wakeWord
  const reasonChanged = options.nextState.reason !== options.previousState.reason
  const errorChanged = options.nextState.error !== options.previousState.error

  if (
    (phaseChanged || wakeWordChanged)
    && options.nextState.phase === 'listening'
    && options.nextState.wakeWord
  ) {
    options.appendVoiceTrace('Wake word listener started', `waiting for "${options.nextState.wakeWord}"`)
    options.busEmit?.({
      type: 'wake:armed',
      wakeWord: options.nextState.wakeWord,
      reason: VoiceReasonCodes.WAKE_ARMED,
    })
    return
  }

  if (
    (phaseChanged || wakeWordChanged) && options.nextState.phase === 'paused'
  ) {
    options.busEmit?.({
      type: 'wake:suspended',
      suspendReason: options.nextState.suspendReason || options.nextState.reason || '',
      reason: VoiceReasonCodes.WAKE_SUSPENDED,
    })
    return
  }

  if (
    (phaseChanged || wakeWordChanged) && options.nextState.phase === 'cooldown'
  ) {
    options.busEmit?.({
      type: 'wake:cooldown',
      cooldownUntil: options.nextState.cooldownUntil ?? '',
      reason: VoiceReasonCodes.WAKE_COOLDOWN,
    })
    return
  }

  if (
    options.nextState.phase === 'unavailable'
    && options.nextState.reason
    && (phaseChanged || wakeWordChanged || reasonChanged)
  ) {
    console.warn('[Voice] Wake word unavailable:', options.nextState.reason)
    options.appendVoiceTrace(
      'Wake word unavailable',
      `wake word "${options.nextState.wakeWord || '(unset)'}" unavailable: ${options.nextState.reason}`,
      'error',
    )
    options.showPetStatus(options.ti('voice.wakeword.unavailable_with_reason', { reason: options.nextState.reason }), 4_200, 4_500)
    options.busEmit?.({
      type: 'wake:error',
      message: options.nextState.reason,
      reason: VoiceReasonCodes.WAKE_UNAVAILABLE,
    })
    return
  }

  if (
    options.nextState.phase === 'error'
    && options.nextState.error
    && (phaseChanged || errorChanged)
  ) {
    console.warn('[Voice] Wake word listener error:', options.nextState.error)
    options.appendVoiceTrace('Wake word listener error', options.nextState.error, 'error')
    options.showPetStatus(options.ti('voice.wakeword.listener_error_with_reason', { error: options.nextState.error }), 4_200, 4_500)
    options.busEmit?.({
      type: 'wake:error',
      message: options.nextState.error,
      reason: VoiceReasonCodes.WAKE_RUNTIME_ERROR,
      meta: { retryCount: options.nextState.retryCount },
    })
  }
}

export function handleWakewordKeywordDetectedRuntime(
  options: HandleWakewordKeywordDetectedRuntimeOptions,
) {
  // Guard against re-triggering *while an actual session is running*.
  // We intentionally do NOT check `voiceStateRef` — both the legacy
  // `reduceVoiceSessionState` and the new VoiceBus state machine write
  // it, and the legacy machine never dispatches `session_completed` in
  // the direct_send success path, so voiceStateRef can stay at
  // 'processing' after a fully-completed turn and permanently debounce
  // every subsequent wakeword hit.
  //
  // Instead, inspect the concrete session refs — if they're all null,
  // there is no in-flight VAD/STT session and the wake is safe to fire
  // regardless of what the legacy state machine thinks. busy + ack are
  // kept as short-window guards (chat turn in flight, ack delay pending).
  const hasActiveSession = Boolean(
    options.vadSessionRef.current
    || options.recognitionRef.current
    || options.paraformerSessionRef.current
    || options.sensevoiceSessionRef.current
    || options.tencentAsrSessionRef.current,
  )
  const debouncedBusy = options.busyRef.current
  const debouncedAck = options.wakewordAcknowledgingRef.current

  // `speaking` is the one voiceState where we really do want to debounce —
  // mid-TTS wake-word hits are usually self-triggers from the playback
  // bleeding into the mic. Any other voiceState value (idle / listening /
  // processing) is allowed through so long as no session is actually live.
  const isSpeaking = options.voiceStateRef.current === 'speaking'

  if (hasActiveSession || debouncedBusy || debouncedAck || isSpeaking) {
    console.warn('[Wake] keyword debounced — guards:', {
      hasActiveSession,
      busy: debouncedBusy,
      acknowledging: debouncedAck,
      speaking: isSpeaking,
      voiceState: options.voiceStateRef.current,
      keyword: options.keyword,
    })
    options.busEmit?.({
      type: 'wake:debounced',
      wakeWord: options.keyword,
      keyword: options.keyword,
      reason: VoiceReasonCodes.WAKE_DEBOUNCED,
      meta: {
        voiceState: options.voiceStateRef.current,
        busy: debouncedBusy,
        acknowledging: debouncedAck,
      },
    })
    return
  }

  console.info('[Voice] Wake word detected:', options.keyword)
  options.appendVoiceTrace('Wake word triggered', `detected "${options.keyword}", opening voice session`)
  options.busEmit?.({
    type: 'wake:detected',
    wakeWord: options.keyword,
    keyword: options.keyword,
    reason: VoiceReasonCodes.WAKE_MATCH,
  })
  options.acknowledgeWakewordAndStartListening(options.keyword)
}

export function createWakewordRuntimeBinding(
  options: CreateWakewordRuntimeBindingOptions,
) {
  const runtime = createWakewordRuntime({
    onStateChange: (nextState, previousState) => {
      options.wakewordRuntimeStateChangeRef.current(nextState, previousState)
    },
    onKeywordDetected: (keyword) => {
      options.wakewordKeywordDetectedRef.current(keyword)
    },
    ti: options.ti,
  })

  options.wakewordRuntimeRef.current = runtime
  options.setWakewordState(runtime.getState())

  return () => {
    runtime.destroy()
    options.wakewordRuntimeRef.current = null
  }
}
