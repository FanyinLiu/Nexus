/**
 * Host wiring for the dream diary.
 *
 * The controller calls this only while the autonomy phase is `sleeping`.
 * All gates live in features/dream: the night window, the idle threshold,
 * the one-per-night store check, and the memory-pause rule. This hook owns
 * the background LLM call, the retry cooldown, and the save. A failed call or
 * an unparseable answer returns before `saveDream`, so the night stays open.
 */

import { useCallback, useRef } from 'react'
import {
  decideDreamDiary,
  hasDreamMaterial,
  selectDreamFragments,
  summarizeDreamMood,
} from '../features/dream/dreamDiary.ts'
import { buildDreamPrompt, parseDreamResponse } from '../features/dream/dreamDiaryPrompt.ts'
import {
  createDreamDiaryEntry,
  getMostRecentDreamNight,
  saveDream,
} from '../features/dream/dreamDiaryStore.ts'
import { loadEmotionHistory } from '../features/autonomy/stateTimeline.ts'
import {
  acquireBackgroundChatLease,
  classifyBackgroundChatFailure,
  getBackgroundChatGate,
  recordBackgroundChatFailure,
  recordBackgroundChatSuccess,
  releaseBackgroundChatLease,
} from '../features/autonomy/backgroundChatPolicy.ts'
import { recordUsage } from '../features/metering/contextMeter.ts'
import { getDefaultCompanionName } from '../lib/uiLanguage.ts'
import { getRedactedLogErrorMessage } from '../lib/logRedaction.ts'
import type { AppSettings, MemoryItem } from '../types'

const RETRY_COOLDOWN_MS = 10 * 60_000
const DREAM_TEMPERATURE = 0.95
const DREAM_MAX_TOKENS = 400

export type UseDreamDiaryOptions = {
  settingsRef: React.RefObject<AppSettings>
  memoriesRef: React.RefObject<MemoryItem[]>
  idleSecondsRef: React.RefObject<number>
  /** Shared chat busy flag; a real conversation always wins. */
  busyRef?: React.RefObject<boolean>
  /** Only the background runtime owner may call an LLM. */
  enabled?: boolean
  appendDebugConsoleEvent: (event: { source: 'autonomy'; title: string; detail: string }) => void
}

export function useDreamDiary({
  settingsRef,
  memoriesRef,
  idleSecondsRef,
  busyRef,
  enabled = true,
  appendDebugConsoleEvent,
}: UseDreamDiaryOptions) {
  const runningRef = useRef(false)
  const lastAttemptAtRef = useRef(0)

  const runDreamDiary = useCallback(async () => {
    if (!enabled || runningRef.current) return
    if (busyRef?.current) return
    if (!window.desktopPet?.completeChat) return

    const nowMs = Date.now()
    if (nowMs - lastAttemptAtRef.current < RETRY_COOLDOWN_MS) return

    const settings = settingsRef.current
    if (!settings.dreamDiaryEnabled) return

    const memoryPaused = settings.memoryPaused === true
    // While memory is paused she does not dream from memories at all. The
    // alternative (a memory-free generic dream) is intentionally not taken:
    // pausing memory should make the diary go quiet, not invent around it.
    const fragments = memoryPaused ? [] : selectDreamFragments(memoriesRef.current, nowMs)
    const weekMood = memoryPaused ? null : summarizeDreamMood(loadEmotionHistory())

    const decision = decideDreamDiary({
      enabled: settings.dreamDiaryEnabled,
      autonomyEnabled: settings.autonomyEnabled,
      autonomyDreamEnabled: settings.autonomyDreamEnabled,
      nowMs,
      idleSeconds: idleSecondsRef.current,
      sleepAfterIdleMinutes: settings.autonomySleepAfterIdleMinutes,
      memoryPaused,
      lastDreamNight: getMostRecentDreamNight(),
      hasMaterial: hasDreamMaterial(fragments, weekMood),
    })
    if (!decision.shouldDream) return

    const policyInput = {
      providerId: settings.apiProviderId,
      baseUrl: settings.apiBaseUrl,
      model: settings.model,
      apiKey: settings.apiKey,
    }
    const gate = getBackgroundChatGate(policyInput)
    if (!gate.allowed) {
      if (gate.shouldNotify) {
        appendDebugConsoleEvent({
          source: 'autonomy',
          title: 'Dream diary skipped',
          detail: `background:dream-diary blocked: ${gate.reason}`,
        })
      }
      return
    }

    const lease = acquireBackgroundChatLease()
    if (!lease) return

    runningRef.current = true
    lastAttemptAtRef.current = nowMs
    try {
      const prompt = buildDreamPrompt({
        companionName: settings.companionName || getDefaultCompanionName(settings.uiLanguage),
        uiLanguage: settings.uiLanguage,
        fragments,
        weekMood,
      })

      appendDebugConsoleEvent({
        source: 'autonomy',
        title: 'Dreaming',
        detail: `night ${decision.night}, fragments ${fragments.length}${weekMood ? ', mood present' : ''}`,
      })

      let content: string | null = null
      try {
        const response = await window.desktopPet.completeChat({
          providerId: policyInput.providerId,
          baseUrl: policyInput.baseUrl,
          apiKey: policyInput.apiKey,
          model: policyInput.model,
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user },
          ],
          temperature: DREAM_TEMPERATURE,
          maxTokens: DREAM_MAX_TOKENS,
          traceId: 'background:dream-diary',
        })
        content = response?.content ?? null
        if (!content) throw new Error('Dream diary returned empty response')
        recordBackgroundChatSuccess(policyInput)
      } catch (error) {
        recordBackgroundChatFailure(policyInput, classifyBackgroundChatFailure(error))
        appendDebugConsoleEvent({
          source: 'autonomy',
          title: 'Dream diary failed',
          detail: getRedactedLogErrorMessage(error),
        })
        return
      }

      const text = parseDreamResponse(content, fragments.map((fragment) => fragment.text))
      if (!text) {
        appendDebugConsoleEvent({
          source: 'autonomy',
          title: 'Dream diary discarded',
          detail: 'response did not honour the dream contract; night stays open',
        })
        return
      }

      recordUsage('dream', `${prompt.system}\n${prompt.user}`, text, { modelId: settings.model })
      const entry = createDreamDiaryEntry({
        night: decision.night,
        text,
        sourceMemoryIds: fragments.map((fragment) => fragment.id),
      })
      if (!entry) return
      saveDream(entry)
      appendDebugConsoleEvent({
        source: 'autonomy',
        title: 'Dream diary written',
        detail: `night ${entry.night}, ${entry.text.length} chars`,
      })
    } finally {
      runningRef.current = false
      releaseBackgroundChatLease(lease)
    }
  }, [
    appendDebugConsoleEvent,
    busyRef,
    enabled,
    idleSecondsRef,
    memoriesRef,
    settingsRef,
  ])

  return { runDreamDiary }
}
