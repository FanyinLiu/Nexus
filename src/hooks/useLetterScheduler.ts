import { useEffect, useRef } from 'react'
import { decideLetter } from '../features/letter/letterScheduler.ts'
import { hasDueAgendaItem } from '../features/autonomy/proactiveAgenda.ts'
import {
  aggregateSundayLetter,
  type SundayLetterDataReady,
} from '../features/letter/aggregator.ts'
import {
  compareAffectSnapshots,
  computeAffectSnapshot,
} from '../features/autonomy/affectDynamics.ts'
import { loadUserAffectWindow } from '../features/autonomy/userAffectTimeline.ts'
import {
  buildLetterPrompt,
  parseLetterResponse,
} from '../features/letter/letterPromptBuilder.ts'
import {
  createSavedLetter,
  getMostRecentLetterDate,
  saveLetter,
} from '../features/letter/letterStore.ts'
import {
  DEFAULT_PERSONA_PROFILE_ID,
  type LoadedPersona,
} from '../features/autonomy/v2/personaTypes.ts'
import { localDayKey } from '../lib/localDate.ts'
import { getRedactedLogErrorMessage } from '../lib/logRedaction.ts'
import { admitProactiveMessage } from '../features/autonomy/proactiveEtiquette.ts'
import { isUserTypingAnywhere } from '../features/autonomy/userTyping.ts'
import {
  acquireBackgroundChatLease,
  classifyBackgroundChatFailure,
  getBackgroundChatGate,
  isBackgroundChatLeaseAvailable,
  recordBackgroundChatFailure,
  recordBackgroundChatSuccess,
  releaseBackgroundChatLease,
} from '../features/autonomy/backgroundChatPolicy.ts'
import type {
  AppSettings,
  ChatMessage,
  DailyMemoryEntry,
  DailyMemoryStore,
  FocusState,
  MemoryItem,
} from '../types'

const POLL_INTERVAL_MS = 30 * 60_000
const WEEK_MS = 7 * 24 * 60 * 60_000
const LETTER_TEMPERATURE = 0.85
const LETTER_MAX_TOKENS = 1200

type UseLetterSchedulerOptions = {
  settings: AppSettings
  messages: ChatMessage[]
  memories: MemoryItem[]
  dailyMemories?: DailyMemoryStore
  focusState?: FocusState
  /** Only the background runtime owner may create timers or call IPC. */
  enabled?: boolean
  onEvent?: (event: {
    title: string
    detail: string
    tone: 'info' | 'warn'
  }) => void
}

function userMessagesIn(
  messages: ChatMessage[],
  windowStartMs: number,
  windowEndMs: number,
): ChatMessage[] {
  return messages.filter((message) => {
    if (message.role !== 'user') return false
    const time = Date.parse(message.createdAt)
    return Number.isFinite(time) && time >= windowStartMs && time <= windowEndMs
  })
}

function activeDayKeysFromMessages(messages: readonly ChatMessage[]): string[] {
  return [...new Set(messages.map((message) => localDayKey(Date.parse(message.createdAt))))]
}

function recentMemoriesIn(
  memories: MemoryItem[],
  windowStartMs: number,
  windowEndMs: number,
): MemoryItem[] {
  return memories.filter((memory) => {
    const time = Date.parse(memory.createdAt)
    return Number.isFinite(time) && time >= windowStartMs && time <= windowEndMs
  })
}

function recentDiaryEntriesIn(
  dailyMemories: DailyMemoryStore,
  windowStartMs: number,
  windowEndMs: number,
): DailyMemoryEntry[] {
  const out: DailyMemoryEntry[] = []
  for (const entries of Object.values(dailyMemories)) {
    for (const entry of entries) {
      const time = Date.parse(entry.createdAt)
      if (Number.isFinite(time) && time >= windowStartMs && time <= windowEndMs) {
        out.push(entry)
      }
    }
  }
  return out
}

async function loadActivePersona(settings: AppSettings): Promise<LoadedPersona | null> {
  try {
    const desktopPet = window.desktopPet
    if (!desktopPet?.personaLoadProfile) return null
    // Honour the user's active character profile (a Character-Card import sets
    // activeCharacterProfileId to the card's persona id). Empty -> default;
    // fall back to the default if the active profile has no persona files.
    const activeId = settings.activeCharacterProfileId?.trim()
    const profileId = activeId || DEFAULT_PERSONA_PROFILE_ID
    const loaded = await desktopPet.personaLoadProfile(profileId)
    if (!loaded?.present && profileId !== DEFAULT_PERSONA_PROFILE_ID) {
      return await desktopPet.personaLoadProfile(DEFAULT_PERSONA_PROFILE_ID)
    }
    return loaded
  } catch {
    return null
  }
}

async function callLetterLLM(
  settings: AppSettings,
  data: SundayLetterDataReady,
  persona: LoadedPersona,
  letterDate: string,
): Promise<string | null> {
  const desktopPet = window.desktopPet
  if (!desktopPet?.completeChat) return null

  const messages = buildLetterPrompt({
    persona,
    data,
    uiLanguage: settings.uiLanguage,
    letterDate,
  })

  const resp = await desktopPet.completeChat({
    providerId: settings.apiProviderId,
    baseUrl: settings.apiBaseUrl,
    apiKey: settings.apiKey,
    model: settings.model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    temperature: LETTER_TEMPERATURE,
    maxTokens: LETTER_MAX_TOKENS,
    traceId: 'background:letter',
  })
  return resp.content ?? null
}

/**
 * Polls every 30 min. The scheduler decides which Sunday slot is due; the
 * aggregator decides whether that week had enough life in it. A letter is
 * persisted only after the LLM response parses, so a failure never consumes
 * the week. `memoryPaused` skips generation entirely.
 */
export function useLetterScheduler({
  settings,
  messages,
  memories,
  dailyMemories = {},
  focusState = 'active',
  enabled = true,
  onEvent,
}: UseLetterSchedulerOptions) {
  const liveRef = useRef({ settings, messages, memories, dailyMemories, focusState, onEvent })
  const runningRef = useRef(false)
  useEffect(() => {
    liveRef.current = { settings, messages, memories, dailyMemories, focusState, onEvent }
  }, [settings, messages, memories, dailyMemories, focusState, onEvent])

  useEffect(() => {
    if (!enabled) return
    if (!settings.proactiveLetterEnabled) return
    if (typeof window === 'undefined') return

    const tick = async () => {
      if (runningRef.current) return
      const live = liveRef.current
      const s = live.settings
      if (!s.proactiveLetterEnabled) return

      // While the user is here, a due follow-up is the more personal
      // open. Away from the machine the letter can still be prepared.
      if (live.focusState === 'active' && hasDueAgendaItem(live.memories, Date.now())) return

      const decision = decideLetter({
        enabled: true,
        nowMs: Date.now(),
        lastLetterDate: getMostRecentLetterDate(),
        relationshipType: s.companionRelationshipType,
        memoryPaused: s.memoryPaused,
      })
      if (!decision.shouldFire) return

      const admission = admitProactiveMessage({
        nowMs: Date.now(),
        kind: 'letter',
        enabled: true,
        preset: s.proactiveFrequency,
        quietStart: s.proactiveQuietHoursStart,
        quietEnd: s.proactiveQuietHoursEnd,
        userTyping: isUserTypingAnywhere(s),
        focusState: 'active',
        channel: 'next_turn',
      })
      if (!admission.allow) return

      runningRef.current = true
      try {
        const windowStartMs = decision.dueAtMs - WEEK_MS
        const windowEndMs = decision.dueAtMs
        const userMessages = userMessagesIn(live.messages, windowStartMs, windowEndMs)
        // Catch-up letters describe the week that just ended. Reading the
        // current affect window would mix in days that belong to the next
        // letter, so catch-up skips the affect paragraph instead.
        const affectThisWeek = decision.catchUp
          ? undefined
          : computeAffectSnapshot(loadUserAffectWindow(7))
        const priorFourWeek = decision.catchUp
          ? undefined
          : computeAffectSnapshot(
              loadUserAffectWindow(35).filter((sample) => Date.parse(sample.ts) < windowStartMs),
            )
        const affectShift = affectThisWeek && priorFourWeek
          && affectThisWeek.n > 0 && priorFourWeek.n > 0
          ? compareAffectSnapshots(priorFourWeek, affectThisWeek)
          : undefined
        const aggregate = aggregateSundayLetter({
          nowMs: decision.dueAtMs,
          recentMemories: recentMemoriesIn(live.memories, windowStartMs, windowEndMs),
          recentDiaryEntries: recentDiaryEntriesIn(live.dailyMemories, windowStartMs, windowEndMs),
          activeDayKeys: activeDayKeysFromMessages(userMessages),
          userMessageCount: userMessages.length,
          ...(affectThisWeek ? { affectThisWeek } : {}),
          ...(affectShift ? { affectShift } : {}),
        })
        if (!aggregate.shouldFire) {
          live.onEvent?.({
            title: '[letter] skipped',
            detail: `aggregate gate: ${aggregate.reason} (active days ${aggregate.weekDayCount})`,
            tone: 'info',
          })
          return
        }

        const policyInput = {
          providerId: s.apiProviderId,
          baseUrl: s.apiBaseUrl,
          model: s.model,
          apiKey: s.apiKey,
        }
        const gate = getBackgroundChatGate(policyInput)
        if (!gate.allowed) {
          if (gate.shouldNotify) {
            live.onEvent?.({
              title: '[letter] skipped',
              detail: `background:letter blocked: ${gate.reason}`,
              tone: 'info',
            })
          }
          return
        }
        if (!isBackgroundChatLeaseAvailable()) return

        const persona = await loadActivePersona(s)
        if (!persona) {
          live.onEvent?.({
            title: '[letter] skipped',
            detail: 'persona not loaded',
            tone: 'warn',
          })
          return
        }

        const letterDate = decision.letterDate
        let raw: string | null
        const lease = acquireBackgroundChatLease()
        if (!lease) return
        try {
          raw = await callLetterLLM(s, aggregate, persona, letterDate)
          recordBackgroundChatSuccess(policyInput)
        } catch (err) {
          recordBackgroundChatFailure(policyInput, classifyBackgroundChatFailure(err))
          live.onEvent?.({
            title: '[letter] LLM call failed',
            detail: getRedactedLogErrorMessage(err),
            tone: 'warn',
          })
          return
        } finally {
          releaseBackgroundChatLease(lease)
        }

        const parsed = raw ? parseLetterResponse(raw) : null
        if (!parsed) {
          live.onEvent?.({
            title: '[letter] parse failed',
            detail: 'JSON contract not honoured — skipping save',
            tone: 'warn',
          })
          return
        }

        const saved = createSavedLetter({
          letterDate,
          personaId: persona.id,
          uiLanguage: s.uiLanguage,
          content: parsed,
          weekDayCount: aggregate.weekDayCount,
          themes: aggregate.themes,
        })
        if (!saved) return
        saveLetter(saved)

        try {
          await window.desktopPet?.showProactiveNotification?.({
            title: `${s.companionName?.trim() || 'Nexus'}`,
            body: parsed.greeting,
          })
        } catch {
          // Notification failure shouldn't undo the save.
        }

        live.onEvent?.({
          title: '[letter] generated',
          detail: `Saved letter for ${letterDate} — ${aggregate.weekDayCount} active days, ${aggregate.themes.length} themes`,
          tone: 'info',
        })
      } finally {
        runningRef.current = false
      }
    }

    void tick()
    const id = window.setInterval(() => { void tick() }, POLL_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [enabled, settings.proactiveLetterEnabled])
}
