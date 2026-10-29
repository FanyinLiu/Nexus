/**
 * Morning delivery for the dream diary.
 *
 * This is deliberately the smallest possible delivery path: one line through
 * `pushCompanionNotice`, with the same dedupe key shape every other proactive
 * scheduler uses. The pure priority/frequency rules live in
 * features/dream/dreamSurfacing.ts, so the shared proactive-etiquette layer
 * can later admit `kind: 'dream'` here without changing any decision logic.
 */

import { useCallback, useEffect, useRef } from 'react'
import { decideDreamSurfacing } from '../features/dream/dreamSurfacing.ts'
import {
  getLatestUnsurfacedDream,
  getMostRecentSurfacedAtMs,
  markDreamSurfaced,
} from '../features/dream/dreamDiaryStore.ts'
import { hasDueAgendaItem } from '../features/autonomy/proactiveAgenda.ts'
import { hasRecentChatActivity } from '../features/autonomy/proactiveBudget.ts'
import { isUserTyping } from '../features/autonomy/userTyping.ts'
import { decideLetter } from '../features/letter/letterScheduler.ts'
import { getMostRecentLetterDate } from '../features/letter/letterStore.ts'
import { loadProactiveAgenda } from '../lib/storage/proactiveAgenda.ts'
import { loadBracketState } from '../lib/storage/autonomy.ts'
import { localDayKey } from '../lib/localDate.ts'
import { getRedactedLogErrorMessage } from '../lib/logRedaction.ts'
import { useTranslation } from '../i18n/useTranslation.ts'
import { usePollingScheduler } from './usePollingScheduler.ts'
import type { CompanionNoticePayload } from './chat/types.ts'
import type { AppSettings, ChatMessage, FocusState, MemoryItem } from '../types'

const POLL_INTERVAL_MS = 15 * 60_000
const DREAM_BUBBLE_MS = 18_000

type UseDreamSurfacingOptions = {
  settings: AppSettings
  messages: ChatMessage[]
  memories: MemoryItem[]
  panelCollapsed: boolean
  enabled?: boolean
  pushCompanionNotice: (payload: CompanionNoticePayload) => Promise<void>
  busyRef?: React.RefObject<boolean>
  focusState?: FocusState
  onEvent?: (event: { title: string; detail: string; tone: 'info' | 'warn' }) => void
}

export function useDreamSurfacing({
  settings,
  messages,
  memories,
  panelCollapsed,
  enabled = true,
  pushCompanionNotice,
  busyRef,
  focusState = 'active',
  onEvent,
}: UseDreamSurfacingOptions) {
  const { t } = useTranslation()
  const runningRef = useRef(false)
  const liveRef = useRef({
    settings,
    messages,
    memories,
    pushCompanionNotice,
    busyRef,
    focusState,
    onEvent,
    t,
  })

  useEffect(() => {
    liveRef.current = {
      settings,
      messages,
      memories,
      pushCompanionNotice,
      busyRef,
      focusState,
      onEvent,
      t,
    }
  }, [settings, messages, memories, pushCompanionNotice, busyRef, focusState, onEvent, t])

  const run = useCallback(async () => {
    const live = liveRef.current
    const s = live.settings
    if (!s.dreamDiaryEnabled || !s.autonomyEnabled || !s.autonomyDreamEnabled) return
    if (runningRef.current || live.busyRef?.current === true) return

    const dream = getLatestUnsurfacedDream()
    if (!dream) return

    const nowMs = Date.now()
    const bracket = loadBracketState()
    const letterLastDate = getMostRecentLetterDate()
    const letterDue = s.proactiveLetterEnabled && (
      decideLetter({
        enabled: true,
        nowMs,
        lastLetterDate: letterLastDate,
        relationshipType: s.companionRelationshipType,
        memoryPaused: s.memoryPaused === true,
      }).shouldFire
      || letterLastDate === localDayKey(nowMs)
    )
    const agenda = loadProactiveAgenda()
    const lastOpenClaimAtMs = agenda.firedAt.length
      ? Math.max(...agenda.firedAt)
      : null

    const decision = decideDreamSurfacing({
      enabled: true,
      nowMs,
      dream,
      lastSurfacedAtMs: getMostRecentSurfacedAtMs(),
      relationshipType: s.companionRelationshipType,
      memoryPaused: s.memoryPaused === true,
      frequency: s.proactiveFrequency,
      quietStart: s.proactiveQuietHoursStart,
      quietEnd: s.proactiveQuietHoursEnd,
      focusState: live.focusState,
      busy: Boolean(live.busyRef?.current),
      userTyping: isUserTyping(nowMs),
      bracketEnabled: s.proactiveBracketEnabled,
      lastMorningBracketFiredMs: bracket.lastMorningFiredMs,
      eventFollowUpDue: s.proactiveAgendaEnabled && hasDueAgendaItem(live.memories, nowMs),
      letterDue,
      otherOpenClaimAtMs: lastOpenClaimAtMs,
      recentChatActivity: hasRecentChatActivity(live.messages, nowMs),
    })
    if (!decision.shouldSurface) return

    runningRef.current = true
    try {
      const body = live.t('chat.dream.line', { dream: dream.text })
      await live.pushCompanionNotice({
        chatContent: body,
        bubbleContent: body,
        dedupeKey: `dream:${dream.night}`,
        autoHideMs: DREAM_BUBBLE_MS,
      })
      markDreamSurfaced(dream.id)
      live.onEvent?.({
        title: '[dream] mentioned',
        detail: `night ${dream.night}`,
        tone: 'info',
      })
    } catch (err) {
      console.warn('[dream] mention failed:', getRedactedLogErrorMessage(err))
      live.onEvent?.({
        title: '[dream] mention failed',
        detail: getRedactedLogErrorMessage(err),
        tone: 'warn',
      })
    } finally {
      runningRef.current = false
    }
  }, [])

  usePollingScheduler({
    enabled: enabled && settings.dreamDiaryEnabled,
    intervalMs: POLL_INTERVAL_MS,
    live: { run },
    tick: () => run(),
  })

  // The first open after a night is the natural moment. The bracket hook is
  // declared earlier, so on a shared open it has already had its chance; the
  // decision additionally waits until its line is at least 30 minutes old.
  const previousPanelCollapsedRef = useRef(panelCollapsed)
  useEffect(() => {
    const wasCollapsed = previousPanelCollapsedRef.current
    previousPanelCollapsedRef.current = panelCollapsed
    if (!enabled || !settings.dreamDiaryEnabled) return
    if (wasCollapsed && !panelCollapsed) void run()
  }, [enabled, panelCollapsed, run, settings.dreamDiaryEnabled])

  const previousFocusRef = useRef(focusState)
  useEffect(() => {
    const previous = previousFocusRef.current
    previousFocusRef.current = focusState
    if (!enabled || !settings.dreamDiaryEnabled) return
    if (previous !== 'active' && focusState === 'active') void run()
  }, [enabled, focusState, run, settings.dreamDiaryEnabled])
}
