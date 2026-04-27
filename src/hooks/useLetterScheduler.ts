import { useEffect, useRef } from 'react'
import { decideLetter } from '../features/letter/letterScheduler.ts'
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
  getMostRecentLetterMs,
  saveLetter,
  type SavedLetter,
} from '../features/letter/letterStore.ts'
import {
  DEFAULT_PERSONA_PROFILE_ID,
  type LoadedPersona,
} from '../features/autonomy/v2/personaTypes.ts'
import type { AppSettings, ChatMessage, MemoryItem } from '../types'

const POLL_INTERVAL_MS = 30 * 60_000
const WEEK_MS = 7 * 24 * 60 * 60_000
const LETTER_TEMPERATURE = 0.85
const LETTER_MAX_TOKENS = 1200

type UseLetterSchedulerOptions = {
  settings: AppSettings
  messages: ChatMessage[]
  memories: MemoryItem[]
  panelOpen: boolean
  onEvent?: (event: {
    title: string
    detail: string
    tone: 'info' | 'warn'
  }) => void
}

function localDayKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

function activeDayKeysFromMessages(messages: ChatMessage[], windowStartMs: number): string[] {
  const keys = new Set<string>()
  for (const m of messages) {
    if (m.role !== 'user') continue
    const t = Date.parse(m.createdAt)
    if (!Number.isFinite(t) || t < windowStartMs) continue
    keys.add(localDayKey(t))
  }
  return [...keys]
}

function recentMemoriesIn(memories: MemoryItem[], windowStartMs: number): MemoryItem[] {
  return memories.filter((m) => {
    const t = Date.parse(m.createdAt)
    return Number.isFinite(t) && t >= windowStartMs
  })
}

async function loadDefaultPersona(): Promise<LoadedPersona | null> {
  try {
    const desktopPet = window.desktopPet
    if (!desktopPet?.personaLoadProfile) return null
    return await desktopPet.personaLoadProfile(DEFAULT_PERSONA_PROFILE_ID)
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
  })
  return resp.content ?? null
}

/**
 * Polls every 30 min, fires the Sunday-letter generation when the
 * scheduler + aggregator both pass. The actual letter (a JSON object)
 * is parsed, persisted to the letter store, and surfaced via an OS
 * notification. UI rendering of the artifact is a follow-up.
 */
export function useLetterScheduler({
  settings,
  messages,
  memories,
  panelOpen,
  onEvent,
}: UseLetterSchedulerOptions) {
  const liveRef = useRef({ settings, messages, memories, panelOpen, onEvent })
  useEffect(() => {
    liveRef.current = { settings, messages, memories, panelOpen, onEvent }
  }, [settings, messages, memories, panelOpen, onEvent])

  useEffect(() => {
    if (!settings.proactiveLetterEnabled) return
    if (typeof window === 'undefined') return

    const tick = async () => {
      const live = liveRef.current
      const s = live.settings
      if (!s.proactiveLetterEnabled) return
      if (live.panelOpen) return

      const decision = decideLetter({
        enabled: true,
        nowMs: Date.now(),
        lastFiredMs: getMostRecentLetterMs(),
        relationshipType: s.companionRelationshipType,
      })
      if (!decision.shouldFire) return

      const windowStartMs = Date.now() - WEEK_MS
      // Pull the past-week / prior-4-week affect snapshots so the letter
      // prompt can reference how the user's mood actually moved this
      // week (Russell circumplex valence + Kuppens inertia). The
      // aggregator gates on min-samples; if the timeline is too sparse
      // the affectShape simply isn't attached and the letter falls back
      // to memory-only.
      const affectThisWeek = computeAffectSnapshot(loadUserAffectWindow(7))
      const priorFourWeek = computeAffectSnapshot(
        loadUserAffectWindow(35).filter((s) => Date.parse(s.ts) < windowStartMs),
      )
      const affectShift = affectThisWeek.n > 0 && priorFourWeek.n > 0
        ? compareAffectSnapshots(priorFourWeek, affectThisWeek)
        : undefined
      const aggregate = aggregateSundayLetter({
        nowMs: Date.now(),
        recentMemories: recentMemoriesIn(live.memories, windowStartMs),
        activeDayKeys: activeDayKeysFromMessages(live.messages, windowStartMs),
        affectThisWeek,
        affectShift,
      })
      if (!aggregate.shouldFire) {
        live.onEvent?.({
          title: '[letter] skipped',
          detail: `aggregate gate: ${aggregate.reason} (active days ${aggregate.weekDayCount})`,
          tone: 'info',
        })
        return
      }

      const persona = await loadDefaultPersona()
      if (!persona) {
        live.onEvent?.({
          title: '[letter] skipped',
          detail: 'persona not loaded',
          tone: 'warn',
        })
        return
      }

      const letterDate = new Date().toISOString().slice(0, 10)
      let raw: string | null
      try {
        raw = await callLetterLLM(s, aggregate, persona, letterDate)
      } catch (err) {
        live.onEvent?.({
          title: '[letter] LLM call failed',
          detail: err instanceof Error ? err.message : String(err),
          tone: 'warn',
        })
        return
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

      const saved: SavedLetter = {
        id: `letter-${letterDate}-${Date.now()}`,
        letterDate,
        createdAt: new Date().toISOString(),
        personaId: persona.id,
        uiLanguage: s.uiLanguage,
        content: parsed,
        weekDayCount: aggregate.weekDayCount,
        themes: aggregate.themes,
      }
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
    }

    void tick()
    const id = window.setInterval(() => { void tick() }, POLL_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [settings.proactiveLetterEnabled])
}
