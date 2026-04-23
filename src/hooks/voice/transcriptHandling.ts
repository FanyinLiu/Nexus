import type { MutableRefObject } from 'react'
import { normalizeRecognizedVoiceTranscript, resolveVoiceTranscriptDecision } from '../../features/hearing/core.ts'
import { applyVoiceHotwordCorrections } from '../../features/hearing/hotwordCorrection.ts'
import { formatTraceLabel, logVoiceEvent } from '../../features/voice/shared'
import type { VoiceSessionEvent } from '../../features/voice/sessionMachine'
import { shorten } from '../../lib/common'
import { createId } from '../../lib'
import type { HearingConfig } from '../../features/hearing/config'
import type { PetMood, TranslationKey, TranslationParams, VoicePipelineState, VoiceTraceEntry } from '../../types'
import type { VoiceConversationOptions } from './types'

type ShowPetStatus = (
  message: string,
  duration?: number,
  dedupeWindowMs?: number,
) => void

type Translator = (key: TranslationKey, params?: TranslationParams) => string

export type HandleRecognizedVoiceTranscriptRuntimeOptions = {
  rawTranscript: string
  traceId?: string
  hearingConfig: HearingConfig
  activeVoiceConversationOptionsRef: MutableRefObject<VoiceConversationOptions>
  dispatchVoiceSessionAndSync: (event: VoiceSessionEvent) => unknown
  setMood: (mood: PetMood) => void
  setError: (error: string | null) => void
  setLiveTranscript: (transcript: string) => void
  updateVoicePipeline: (
    step: VoicePipelineState['step'],
    detail: string,
    transcript?: string,
  ) => void
  appendVoiceTrace: (
    title: string,
    detail: string,
    tone?: VoiceTraceEntry['tone'],
  ) => void
  openChatPanelForVoice: () => void
  fillComposerWithVoiceTranscript: (transcript: string) => void
  showPetStatus: ShowPetStatus
  shouldAutoRestartVoice: () => boolean
  scheduleVoiceRestart: (statusText?: string, delay?: number, force?: boolean) => void
  shouldIgnoreRepeatedVoiceContent: (content: string) => boolean
  rememberSubmittedVoiceContent: (content: string) => void
  sendMessage: (
    content: string,
    options?: { source?: 'text' | 'voice' | 'telegram' | 'discord'; traceId?: string },
  ) => Promise<boolean>
  /**
   * Reset the no-speech restart counter. Called from the wake_word_only /
   * manual_confirm / hold_incomplete branches — STT succeeded (even if the
   * content is held or wake-only), so the counter should not climb toward
   * the give-up cap.
   */
  resetNoSpeechRestartCount: () => void
  ti: Translator
}

export type HandleVoiceListeningFailureRuntimeOptions = {
  message: string
  errorCode?: string
  activeVoiceConversationOptionsRef: MutableRefObject<VoiceConversationOptions>
  dispatchVoiceSessionAndSync: (event: VoiceSessionEvent) => unknown
  setLiveTranscript: (transcript: string) => void
  setSpeechLevelValue: (level: number) => void
  setMood: (mood: PetMood) => void
  updateVoicePipeline: (
    step: VoicePipelineState['step'],
    detail: string,
    transcript?: string,
  ) => void
  appendVoiceTrace: (
    title: string,
    detail: string,
    tone?: VoiceTraceEntry['tone'],
  ) => void
  setError: (error: string | null) => void
  shouldAutoRestartVoice: () => boolean
  noSpeechRestartCountRef: MutableRefObject<number>
  maxContinuousNoSpeechRestarts: number
  pauseContinuousVoice: (message: string, statusText?: string) => void
  showPetStatus: ShowPetStatus
  scheduleVoiceRestart: (statusText?: string, delay?: number, force?: boolean) => void
  getNoSpeechRestartDelay: () => number
  setContinuousVoiceSession: (active: boolean) => void
  resetNoSpeechRestartCount: () => void
  ti: Translator
}

export async function handleRecognizedVoiceTranscriptRuntime(
  options: HandleRecognizedVoiceTranscriptRuntimeOptions,
) {
  const traceId = options.traceId ?? createId('voice')
  const traceLabel = formatTraceLabel(traceId)
  const normalizedTranscript = normalizeRecognizedVoiceTranscript(options.rawTranscript)
  const hotwordCorrection = applyVoiceHotwordCorrections(normalizedTranscript, {
    settings: {
      toolWeatherDefaultLocation: options.hearingConfig.toolWeatherDefaultLocation,
      wakeWord: options.hearingConfig.wakeWord,
      companionName: options.hearingConfig.companionName,
    },
  })
  const transcript = hotwordCorrection.text
  if (!transcript) {
    return false
  }

  options.dispatchVoiceSessionAndSync({ type: 'stt_final', text: transcript })

  const triggerMode = options.hearingConfig.voiceTriggerMode
  const wakeWord = options.hearingConfig.wakeWord.trim()
  const wakeWordAlreadyTriggered = Boolean(options.activeVoiceConversationOptionsRef.current.wakewordTriggered)
  options.activeVoiceConversationOptionsRef.current = {}

  const transcriptDecision = resolveVoiceTranscriptDecision({
    transcript,
    triggerMode,
    wakeWord,
    wakeWordAlreadyTriggered,
  })
  if (!transcriptDecision) {
    return false
  }

  logVoiceEvent('recognized transcript', {
    traceId,
    rawTranscript: options.rawTranscript,
    normalizedTranscript,
    transcript,
    triggerMode,
    wakeWord: wakeWord || '(empty)',
    wakeWordAlreadyTriggered,
  })
  options.appendVoiceTrace('Recognition complete', `#${traceLabel} ${shorten(transcript, 30)}`)

  if (hotwordCorrection.changed && hotwordCorrection.replacements.length) {
    const replacementSummary = hotwordCorrection.replacements
      .slice(0, 3)
      .map((entry) => `${entry.from} -> ${entry.to}`)
      .join(' / ')
    options.appendVoiceTrace('Hotword correction applied', `#${traceLabel} ${replacementSummary}`, 'success')
  }

  options.setLiveTranscript(transcript)
  options.setError(null)
  options.updateVoicePipeline('recognized', options.ti('voice.pipeline.recognized'), transcript)

  if (transcriptDecision.kind === 'manual_confirm') {
    logVoiceEvent('stored transcript in composer for manual confirmation')
    // Any recognized speech (even one destined for the composer instead of
    // direct send) counts as successful STT. Without this the no-speech
    // restart counter climbs across wake-word-matched turns and eventually
    // forces the runtime into its "give up" state.
    options.resetNoSpeechRestartCount()
    options.dispatchVoiceSessionAndSync({ type: 'session_completed' })
    options.setMood('idle')
    options.openChatPanelForVoice()
    options.fillComposerWithVoiceTranscript(transcriptDecision.transcript)
    options.updateVoicePipeline(
      'manual_confirm',
      options.ti('voice.pipeline.placed_in_input'),
      transcriptDecision.transcript,
    )
    options.appendVoiceTrace('Waiting for manual send', `#${traceLabel} recognized text placed in composer`)
    options.showPetStatus(options.ti('voice.status.filled_composer'), 3_000, 3_200)

    if (options.shouldAutoRestartVoice()) {
      options.scheduleVoiceRestart(options.ti('voice.status.fill_composer_waiting'), 260)
    }

    return false
  }

  if (transcriptDecision.kind === 'hold_incomplete') {
    logVoiceEvent('held incomplete voice transcript before sending', {
      traceId,
      transcript: transcriptDecision.transcript,
      content: transcriptDecision.content,
      mode: transcriptDecision.mode,
    })
    // Transcript arrived even if we're holding it — counter should reset.
    options.resetNoSpeechRestartCount()
    options.dispatchVoiceSessionAndSync({ type: 'session_completed' })
    options.setMood('idle')
    options.setError(null)
    options.updateVoicePipeline(
      'recognized',
      options.ti('voice.pipeline.hold_incomplete'),
      transcriptDecision.content,
    )
    options.appendVoiceTrace(
      'Hold send',
      `#${traceLabel} looks unfinished, not sending yet: ${shorten(transcriptDecision.content, 24)}`,
      'info',
    )
    options.showPetStatus(options.ti('voice.status.hold_incomplete'), 3_000, 3_200)

    if (options.shouldAutoRestartVoice()) {
      options.scheduleVoiceRestart(options.ti('voice.status.hold_incomplete_resume'), 180)
    }

    return false
  }

  if (transcriptDecision.kind === 'blocked_missing_wake_word') {
    logVoiceEvent('wake word mode is enabled but wake word is empty')
    options.dispatchVoiceSessionAndSync({ type: 'aborted' })
    options.setMood('idle')
    options.updateVoicePipeline(
      'blocked_wake_word',
      options.ti('voice.pipeline.wake_word_not_set'),
      transcriptDecision.transcript,
    )
    options.appendVoiceTrace(
      'Send blocked',
      `#${traceLabel} wake word mode is on, but no wake word is configured`,
      'error',
    )
    options.setError(options.ti('voice.status.wake_word_required'))
    options.showPetStatus(options.ti('voice.status.wake_word_required'), 3_200, 4_000)

    if (options.shouldAutoRestartVoice()) {
      options.scheduleVoiceRestart(options.ti('voice.status.wake_word_set_hint'), 360)
    }

    return false
  }

  if (transcriptDecision.kind === 'blocked_unmatched_wake_word') {
    logVoiceEvent('wake word did not match, transcript was not forwarded', {
      transcript: transcriptDecision.transcript,
      wakeWord: transcriptDecision.wakeWord,
    })
    options.dispatchVoiceSessionAndSync({ type: 'aborted' })
    options.setMood('idle')
    options.updateVoicePipeline(
      'blocked_wake_word',
      options.ti('voice.pipeline.wake_word_missed', { wakeWord: transcriptDecision.wakeWord }),
      transcriptDecision.transcript,
    )
    options.appendVoiceTrace(
      'Wake word not matched',
      `#${traceLabel} did not match "${transcriptDecision.wakeWord}"`,
      'error',
    )
    options.setError(options.ti('voice.status.wake_word_miss', { wakeWord: transcriptDecision.wakeWord }))
    options.showPetStatus(
      options.ti('voice.status.wake_word_miss', { wakeWord: transcriptDecision.wakeWord }),
      3_200,
      4_000,
    )

    if (options.shouldAutoRestartVoice()) {
      options.scheduleVoiceRestart(
        options.ti('voice.status.wake_word_miss_resume', { wakeWord: transcriptDecision.wakeWord }),
        320,
      )
    }

    return false
  }

  if (transcriptDecision.kind === 'wake_word_only') {
    logVoiceEvent('wake word matched but no content remained after stripping')
    // Wake word was heard, which is a successful STT. Reset the counter so
    // repeated wake-word-only rounds don't accumulate toward the max-retry
    // cap and cause the runtime to pause mid-use.
    options.resetNoSpeechRestartCount()
    options.dispatchVoiceSessionAndSync({ type: 'session_completed' })
    options.setMood('happy')
    options.setError(null)
    options.updateVoicePipeline(
      'recognized',
      options.ti('voice.pipeline.wake_word_only'),
      transcriptDecision.transcript,
    )
    options.appendVoiceTrace('Only wake word recognized', `#${traceLabel} no actual content to send yet`)
    options.showPetStatus(options.ti('voice.status.wake_word_only'), 2_200, 2_600)

    if (options.shouldAutoRestartVoice()) {
      options.scheduleVoiceRestart(options.ti('voice.status.wake_word_only'), 180)
    }

    return false
  }

  if (options.shouldIgnoreRepeatedVoiceContent(transcriptDecision.content)) {
    logVoiceEvent('ignored repeated voice transcript', {
      traceId,
      content: transcriptDecision.content,
    })
    options.dispatchVoiceSessionAndSync({ type: 'session_completed' })
    options.setMood('idle')
    options.setError(null)
    options.updateVoicePipeline(
      'recognized',
      options.ti('voice.pipeline.duplicate_ignored'),
      transcriptDecision.content,
    )
    options.appendVoiceTrace(
      'Ignored duplicate recognition',
      `#${traceLabel} ${shorten(transcriptDecision.content, 30)}`,
      'info',
    )
    options.showPetStatus(options.ti('voice.status.duplicate_send'), 2_600, 3_000)

    if (options.shouldAutoRestartVoice()) {
      options.scheduleVoiceRestart(options.ti('voice.status.listen_new'), 260)
    }

    return false
  }

  if (transcriptDecision.mode === 'direct_send') {
    logVoiceEvent('forwarding transcript directly to assistant')
    options.appendVoiceTrace('Preparing to send', `#${traceLabel} forwarding recognized text directly to the model`)
    options.rememberSubmittedVoiceContent(transcriptDecision.content)
    const sent = await options.sendMessage(transcriptDecision.content, { source: 'voice', traceId })

    if (!sent) {
      // sendMessage was rejected (e.g. busy). Push the legacy machine
      // back to idle so voiceStateRef doesn't stay stuck at 'processing'.
      options.dispatchVoiceSessionAndSync({ type: 'session_completed' })
      if (options.shouldAutoRestartVoice()) {
        options.scheduleVoiceRestart(options.ti('voice.status.not_sent_resume'), 320)
      }
    }
    // On success: DON'T dispatch session_completed here. sendMessage
    // awaits the full turn including TTS. The VoiceBus handles the
    // speaking → idle transition via tts:completed. Dispatching
    // session_completed after a 12s TTS-wait timeout would force
    // voiceState to 'idle' while TTS is still playing, breaking
    // continuous voice and the restart loop.

    return sent
  }

  options.setLiveTranscript(transcriptDecision.content)
  options.updateVoicePipeline(
    'recognized',
    options.ti('voice.pipeline.wake_word_matched'),
    transcriptDecision.content,
  )
  options.appendVoiceTrace('Wake word matched', `#${traceLabel} stripped wake word and preparing to send`)
  logVoiceEvent('wake word matched, forwarding stripped transcript', {
    traceId,
    content: transcriptDecision.content,
  })
  options.rememberSubmittedVoiceContent(transcriptDecision.content)
  const sent = await options.sendMessage(transcriptDecision.content, { source: 'voice', traceId })

  if (!sent) {
    options.dispatchVoiceSessionAndSync({ type: 'session_completed' })
    if (options.shouldAutoRestartVoice()) {
      options.scheduleVoiceRestart(options.ti('voice.status.not_sent_resume'), 320)
    }
  }

  return sent
}

export function handleVoiceListeningFailureRuntime(
  options: HandleVoiceListeningFailureRuntimeOptions,
) {
  options.activeVoiceConversationOptionsRef.current = {}

  if (options.errorCode === 'aborted') {
    options.dispatchVoiceSessionAndSync({ type: 'aborted' })
  } else {
    options.dispatchVoiceSessionAndSync({
      type: 'error',
      message: options.message,
      code: options.errorCode,
    })
  }

  options.setLiveTranscript('')
  options.setSpeechLevelValue(0)
  options.setMood('idle')
  options.updateVoicePipeline('idle', options.message)
  options.appendVoiceTrace(
    'Voice turn interrupted',
    options.message,
    options.errorCode === 'aborted' ? 'info' : 'error',
  )

  if (options.errorCode === 'aborted') {
    options.setError(null)
    return
  }

  options.setError(options.message)

  if (options.errorCode === 'no-speech' && options.shouldAutoRestartVoice()) {
    options.noSpeechRestartCountRef.current += 1

    if (options.noSpeechRestartCountRef.current > options.maxContinuousNoSpeechRestarts) {
      options.pauseContinuousVoice(
        options.ti('voice.status.continuous_paused_no_speech_reason'),
        options.ti('voice.status.continuous_paused_no_speech_status'),
      )
      return
    }

    options.showPetStatus(options.ti('voice.status.retry_unheard'), 2_200, 4_000)
    options.scheduleVoiceRestart(
      options.ti('voice.status.retry_resume'),
      options.getNoSpeechRestartDelay(),
    )
    return
  }

  if (options.shouldAutoRestartVoice()) {
    options.setContinuousVoiceSession(false)
    options.resetNoSpeechRestartCount()
  }

  options.showPetStatus(options.message, 4_800, 3_600)
}
