// Owns the ref bridge between useChat/useVoice and the autonomy controller:
// the getter/consumer refs plus the companion-signal slice of the useChat ctx.
// Also exposes `useInstallAutonomySignals`, the effect that installs autonomy's
// real getters into those refs. Extracted from useAppController without
// behavior change.

import { useEffect, useMemo, useRef } from 'react'
import type { RefObject } from 'react'
import {
  buildAffectGuidance,
  classifyAffectGuidance,
} from '../../features/autonomy/affectGuidance.ts'
import { computeAffectSnapshot } from '../../features/autonomy/affectDynamics.ts'
import type { EmotionState as AppEmotionState } from '../../features/autonomy/emotionModel.ts'
import { voiceEmotionToSignal } from '../../features/autonomy/emotionModel.ts'
import { recordGuidanceFired } from '../../features/autonomy/guidanceTelemetry.ts'
import { loadUserAffectWindow } from '../../features/autonomy/userAffectTimeline.ts'
import type { PersonaSpeechStyle } from '../../features/autonomy/v2/personaTypes.ts'
import type { AssistantReplyDeliveredPayload, ChatCompanionSignalDeps } from '../../hooks/chat/types.ts'
import type { AppSettings, MemoryItem, VoiceEmotionLabel } from '../../types'

export function useCompanionSignalBridge({ settingsRef }: { settingsRef: RefObject<AppSettings> }) {
  const voiceEmotionApplyRef = useRef<(label: VoiceEmotionLabel) => void>(() => {})
  const emotionVoiceSnapshotRef = useRef<() => AppEmotionState | undefined>(() => undefined)
  const personaSpeechStyleGetterRef = useRef<() => PersonaSpeechStyle | undefined>(() => undefined)

  // Ref bridge for emotion/relationship/rhythm prompt getters:
  // useChat must be created before useAutonomyController (autonomy depends on
  // chat), so we cannot pass autonomy.getEmotionPrompt / getRelationshipPrompt /
  // getRhythmPrompt directly into useChat. We create empty refs here first, then
  // after autonomy is created, a useEffect installs the real getters. The wrapper
  // function references seen by useChat ctx are stable, so ctx won't rebuild.
  const emotionPromptGetterRef = useRef<() => string>(() => '')
  const emotionAttitudeGetterRef = useRef<() => string>(() => '')
  const relationshipPromptGetterRef = useRef<() => string>(() => '')
  const rhythmPromptGetterRef = useRef<() => string>(() => '')
  const emotionSnapshotGetterRef = useRef<() => { energy: number; warmth: number; curiosity: number; concern: number } | undefined>(() => undefined)
  const milestoneConsumerRef = useRef<() => string>(() => '')
  const anniversaryConsumerRef = useRef<(uiLanguage: string) => string>(() => '')
  const onThisDayConsumerRef = useRef<(uiLanguage: string, memories: MemoryItem[]) => string>(() => '')
  const commitOnThisDayConsumerRef = useRef<() => void>(() => {})
  const messageFollowUpConsumerRef = useRef<() => string>(() => '')
  const assistantReplyFailedRef = useRef<(() => void) | null>(null)
  const emotionSignalApplyRef = useRef<((signal: import('../../features/autonomy/emotionModel.ts').EmotionSignal) => void) | null>(null)
  // Empathy cooldown: the affect classifier runs every turn; without a gate
  // a stuck-low week would ratchet concern on every single reply.
  const lastEmpathySignalAtRef = useRef(0)
  const lastMoodSignalAtRef = useRef(0)
  // Same ref-wrapper dance for the reverse direction: the messaging bridges
  // (created inside useAutonomyController) want to hear about completed
  // assistant replies so they can route them back to Telegram/Discord.
  const assistantReplyDeliveredRef = useRef<((payload: AssistantReplyDeliveredPayload) => void) | null>(null)

  const companionSignals = useMemo<ChatCompanionSignalDeps>(() => ({
    getEmotionPromptText: () => emotionPromptGetterRef.current(),
    getEmotionAttitudeText: () => emotionAttitudeGetterRef.current(),
    getRelationshipPromptText: () => relationshipPromptGetterRef.current(),
    getRhythmPromptText: () => rhythmPromptGetterRef.current(),
    // Affect guidance has no hook-ordering dependency on autonomy — the data
    // sources (userAffectTimeline + affectDynamics) are pure modules. Compute
    // on demand each turn: 14-day window establishes the trait-level baseline
    // (M1.4 stuck-low / volatile / steady-warm); 3-day window is the
    // state-level recent reading the classifier compares against to detect a
    // recent-drop (M1.5). Returns '' when nothing notable applies. Silent
    // telemetry: when a non-'none' state fires, record it for later threshold
    // analysis — never user-facing (see feedback_nexus_silent_emotion).
    getAffectGuidancePromptText: () => {
      const longSamples = loadUserAffectWindow(14)
      const recentSamples = loadUserAffectWindow(3)
      const snapshot = computeAffectSnapshot(longSamples)
      const recentSnapshot = computeAffectSnapshot(recentSamples)
      const state = classifyAffectGuidance({ snapshot, recentSnapshot })
      if (state !== 'none') {
        recordGuidanceFired({
          kind: `affect:${state}` as const,
          beforeValence: snapshot.baselineValence,
        })
        // Empathy loop: a low-mood read doesn't just instruct the reply —
        // it nudges her actual emotion (concern up, warmth up), so the
        // softness is felt, not performed. 6 h cooldown; positive states
        // deliberately excluded this iteration (restraint first).
        if (state === 'stuck-low' || state === 'recent-drop') {
          const now = Date.now()
          if (now - lastEmpathySignalAtRef.current > 6 * 60 * 60 * 1000) {
            lastEmpathySignalAtRef.current = now
            emotionSignalApplyRef.current?.('user_low_mood_observed')
          }
        }
      }
      return buildAffectGuidance({
        uiLanguage: settingsRef.current.uiLanguage,
        snapshot,
        recentSnapshot,
      })
    },
    getEmotionSnapshot: () => emotionSnapshotGetterRef.current(),
    onAssistantReplyDelivered: (payload) => assistantReplyDeliveredRef.current?.(payload),
    onAssistantReplyFailed: () => assistantReplyFailedRef.current?.(),
    onUserMoodSignal: (signal) => {
      // Per-message LLM mood reads during a long emotional conversation
      // would ratchet the same signal every turn; one nudge per 5 minutes
      // is enough for tone to follow.
      const now = Date.now()
      if (now - lastMoodSignalAtRef.current < 5 * 60 * 1000) return
      lastMoodSignalAtRef.current = now
      emotionSignalApplyRef.current?.(signal)
    },
    consumeMilestonePromptText: () => milestoneConsumerRef.current(),
    consumeAnniversaryPromptText: (uiLanguage: string) => anniversaryConsumerRef.current(uiLanguage),
    consumeOnThisDayPromptText: (uiLanguage: string, memories: MemoryItem[]) => onThisDayConsumerRef.current(uiLanguage, memories),
    commitOnThisDayPromptText: () => commitOnThisDayConsumerRef.current(),
    consumeMessageFollowUpPromptText: () => messageFollowUpConsumerRef.current(),
  }), [settingsRef])

  return {
    anniversaryConsumerRef,
    assistantReplyDeliveredRef,
    assistantReplyFailedRef,
    commitOnThisDayConsumerRef,
    companionSignals,
    emotionAttitudeGetterRef,
    emotionPromptGetterRef,
    emotionSignalApplyRef,
    emotionSnapshotGetterRef,
    emotionVoiceSnapshotRef,
    messageFollowUpConsumerRef,
    milestoneConsumerRef,
    onThisDayConsumerRef,
    personaSpeechStyleGetterRef,
    relationshipPromptGetterRef,
    rhythmPromptGetterRef,
    voiceEmotionApplyRef,
  }
}

type UseInstallAutonomySignalsOptions = {
  bridge: ReturnType<typeof useCompanionSignalBridge>
  autonomy: ReturnType<typeof import('./useAutonomyController').useAutonomyController>
}

export function useInstallAutonomySignals({ autonomy, bridge }: UseInstallAutonomySignalsOptions) {
  const {
    anniversaryConsumerRef,
    assistantReplyFailedRef,
    commitOnThisDayConsumerRef,
    emotionAttitudeGetterRef,
    emotionPromptGetterRef,
    emotionSignalApplyRef,
    emotionSnapshotGetterRef,
    emotionVoiceSnapshotRef,
    messageFollowUpConsumerRef,
    milestoneConsumerRef,
    onThisDayConsumerRef,
    personaSpeechStyleGetterRef,
    relationshipPromptGetterRef,
    rhythmPromptGetterRef,
    voiceEmotionApplyRef,
  } = bridge

  // Install autonomy's emotion/relationship/rhythm prompt getters into the refs
  // created at the top. This lets useChat (when assembling chat options) read
  // the latest emotion/relationship/rhythm state text into the system prompt.
  // The autonomy getters are now stable (useCallback with [] deps), so this
  // effect only runs once after mount.
  useEffect(() => {
    emotionPromptGetterRef.current = autonomy.getEmotionPrompt
    emotionAttitudeGetterRef.current = autonomy.getEmotionAttitudeText
    relationshipPromptGetterRef.current = autonomy.getRelationshipPrompt
    rhythmPromptGetterRef.current = autonomy.getRhythmPrompt
    emotionSnapshotGetterRef.current = () => autonomy.emotionStateRef.current
    milestoneConsumerRef.current = autonomy.consumePendingMilestoneText
    anniversaryConsumerRef.current = autonomy.consumeAnniversaryPromptText
    onThisDayConsumerRef.current = autonomy.consumeOnThisDayPromptText
    commitOnThisDayConsumerRef.current = autonomy.commitOnThisDayPromptText
    messageFollowUpConsumerRef.current = autonomy.consumeMessageFollowUpPromptText
    assistantReplyFailedRef.current = () => autonomy.applyEmotionSignal('error_occurred')
    emotionSignalApplyRef.current = autonomy.applyEmotionSignal
    // SenseVoice prosody → emotion model: voice ctx forwards labels here.
    voiceEmotionApplyRef.current = (label: VoiceEmotionLabel) => {
      autonomy.applyEmotionSignal(voiceEmotionToSignal(label))
    }
    // Her live emotion → her voice (style + pace, derived at the speak entry).
    emotionVoiceSnapshotRef.current = () => autonomy.emotionStateRef.current
    personaSpeechStyleGetterRef.current = () => autonomy.personaSpeechStyleRef.current
    // The deps list pulls each consumed property of `autonomy` rather than
    // the object itself — autonomy is rebuilt every render in
    // useAutonomyController, so depending on the parent re-runs this effect
    // unnecessarily.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autonomy.applyEmotionSignal, autonomy.consumePendingMilestoneText, autonomy.consumeAnniversaryPromptText, autonomy.consumeOnThisDayPromptText, autonomy.commitOnThisDayPromptText, autonomy.consumeMessageFollowUpPromptText, autonomy.emotionStateRef, autonomy.getEmotionAttitudeText, autonomy.getEmotionPrompt, autonomy.getRelationshipPrompt, autonomy.getRhythmPrompt, autonomy.personaSpeechStyleRef])
}
