/**
 * Host wiring for the daily morning/evening bracket.
 *
 * The pure decision lives in bracketScheduler.ts, the copy in
 * bracketCopy.ts, and the evening→morning thread in bracketTopic.ts.
 * This hook only owns the timer, the open/focus triggers, storage, and
 * delivery through the same chat/bubble path as every other proactive
 * notice, so the default V2 surface shows it without a separate UI.
 */

import { useCallback, useEffect, useRef } from 'react'
import {
  decideBracket,
} from '../features/proactive/bracketScheduler.ts'
import { buildBracketMessage } from '../features/proactive/bracketCopy.ts'
import {
  latestTomorrowTopic,
  morningCallbackTopic,
} from '../features/proactive/bracketTopic.ts'
import {
  hasDueAgendaItem,
} from '../features/autonomy/proactiveAgenda.ts'
import {
  hasRecentChatActivity,
  isLikelyFullscreenSurface,
} from '../features/autonomy/proactiveBudget.ts'
import { isUserTyping } from '../features/autonomy/userTyping.ts'
import {
  findUndeliveredErrands,
  markDelivered,
} from '../features/agent/errandStore.ts'
import { buildErrandDeliveryBody } from '../features/agent/errandDelivery.ts'
import { decideLetter } from '../features/letter/letterScheduler.ts'
import { getMostRecentLetterDate } from '../features/letter/letterStore.ts'
import {
  PROACTIVE_BRACKET_STATE_STORAGE_KEY,
  clearBracketEveningTopic,
  loadBracketState,
  recordBracketEveningPrompt,
  recordBracketEveningTopic,
  recordBracketFire,
  writeJson,
} from '../lib/storage.ts'
import { loadProactiveAgenda } from '../lib/storage/proactiveAgenda.ts'
import { getRedactedLogErrorMessage } from '../lib/logRedaction.ts'
import { admitProactiveMessage } from '../features/autonomy/proactiveEtiquette.ts'
import { isUserTypingAnywhere } from '../features/autonomy/userTyping.ts'
import { localDayKey } from '../lib/localDate.ts'
import { usePollingScheduler } from './usePollingScheduler.ts'
import type { CompanionNoticePayload } from './chat/types.ts'
import type { AppSettings, ChatMessage, FocusState, MemoryItem } from '../types'

const POLL_INTERVAL_MS = 5 * 60_000
const BRACKET_BUBBLE_MS = 18_000

type UseBracketSchedulerOptions = {
  settings: AppSettings
  messages: ChatMessage[]
  memories: MemoryItem[]
  panelCollapsed: boolean
  /** Renderer-level scheduler switch; defaults on for isolated callers/tests. */
  enabled?: boolean
  pushCompanionNotice: (payload: CompanionNoticePayload) => Promise<void>
  busyRef?: React.RefObject<boolean>
  focusState?: FocusState
  onEvent?: (event: { title: string; detail: string; tone: 'info' | 'warn' }) => void
}

export function useBracketScheduler({
  settings,
  messages,
  memories,
  panelCollapsed,
  enabled = true,
  pushCompanionNotice,
  busyRef,
  focusState = 'active',
  onEvent,
}: UseBracketSchedulerOptions) {
  const runningRef = useRef(false)
  const liveRef = useRef({
    settings,
    messages,
    memories,
    panelCollapsed,
    pushCompanionNotice,
    busyRef,
    focusState,
    onEvent,
  })

  useEffect(() => {
    liveRef.current = {
      settings,
      messages,
      memories,
      panelCollapsed,
      pushCompanionNotice,
      busyRef,
      focusState,
      onEvent,
    }
  }, [settings, messages, memories, panelCollapsed, pushCompanionNotice, busyRef, focusState, onEvent])

  // Persist a reply as soon as it arrives, so closing the app before the
  // next poll does not lose what was said about tomorrow.
  useEffect(() => {
    if (!enabled || !settings.proactiveBracketEnabled || settings.memoryPaused === true) return
    const state = loadBracketState()
    if (state.eveningPromptAtMs == null) return
    const captured = latestTomorrowTopic(messages, state.eveningPromptAtMs)
    if (!captured) return
    if (captured.topic === state.eveningTopic && captured.atMs === state.eveningTopicAtMs) return
    writeJson(
      PROACTIVE_BRACKET_STATE_STORAGE_KEY,
      recordBracketEveningTopic(state, captured.topic, captured.atMs),
    )
  }, [enabled, messages, settings.memoryPaused, settings.proactiveBracketEnabled])

  const run = useCallback(async () => {
    const live = liveRef.current
    const s = live.settings
    if (!s.proactiveBracketEnabled || runningRef.current) return

    const nowMs = Date.now()
    let state = loadBracketState()

    // A reply to last night's "anything tomorrow?" is captured here so the
    // next morning can quote it. Only user turns after the prompt count.
    if (s.memoryPaused !== true && state.eveningPromptAtMs != null) {
      const captured = latestTomorrowTopic(live.messages, state.eveningPromptAtMs)
      if (
        captured
        && (captured.topic !== state.eveningTopic || captured.atMs !== state.eveningTopicAtMs)
      ) {
        state = recordBracketEveningTopic(state, captured.topic, captured.atMs)
        writeJson(PROACTIVE_BRACKET_STATE_STORAGE_KEY, state)
      }
    }

    let fullscreen = false
    if (s.contextAwarenessEnabled && s.activeWindowContextEnabled && !s.companionAwarenessPaused) {
      try {
        const snapshot = await window.desktopPet?.getDesktopContext?.({ includeActiveWindow: true })
        fullscreen = isLikelyFullscreenSurface(snapshot?.activeWindowTitle, snapshot?.activeWindowAppName)
      } catch {
        fullscreen = false
      }
    }

    // The letter scheduler now speaks in Sunday week keys, not timestamps:
    // "due" means a slot is waiting, and "delivered today" covers the case
    // where the letter already landed and the bracket should stay quiet.
    const letterLastDate = getMostRecentLetterDate()
    const letterDecision = decideLetter({
      enabled: s.proactiveLetterEnabled,
      nowMs,
      lastLetterDate: letterLastDate,
      relationshipType: s.companionRelationshipType,
      memoryPaused: s.memoryPaused === true,
    })
    const letterDue = letterDecision.shouldFire
      || letterLastDate === localDayKey(nowMs)
    const agendaState = loadProactiveAgenda()
    const lastOpenClaimAtMs = agendaState.firedAt.length
      ? Math.max(...agendaState.firedAt)
      : null

    const decision = decideBracket({
      enabled: true,
      nowMs,
      lastMorningFiredMs: state.lastMorningFiredMs,
      lastEveningFiredMs: state.lastEveningFiredMs,
      relationshipType: s.companionRelationshipType,
      memoryPaused: s.memoryPaused === true,
      busy: live.busyRef?.current === true,
      userTyping: isUserTyping(nowMs),
      fullscreen,
      focusState: live.focusState,
      quietStart: s.proactiveQuietHoursStart,
      quietEnd: s.proactiveQuietHoursEnd,
      eventFollowUpDue: hasDueAgendaItem(live.memories, nowMs),
      letterDue,
      recentChatActivity: hasRecentChatActivity(live.messages, nowMs),
      lastOpenClaimAtMs,
    })
    if (!decision.shouldFire) return

    runningRef.current = true
    try {
      const topic = decision.bracket === 'morning'
        ? morningCallbackTopic(state, live.memories, nowMs)
        : null
      const result = buildBracketMessage({
        uiLanguage: s.uiLanguage,
        companionName: s.companionName,
        bracket: decision.bracket,
        previousEveningTopic: topic?.kind === 'evening' ? topic.topic : null,
        todayEventTopic: topic?.kind === 'event' ? topic.topic : null,
        lastPicks: state.lastPicks,
      })

      // The morning bracket is also the only surface for an overnight
      // errand. One result per morning; the rest wait for tomorrow.
      let body = result.body
      let deliveredErrandId: string | null = null
      if (decision.bracket === 'morning') {
        const undelivered = findUndeliveredErrands()
        const next = undelivered[0]
        if (next) {
          body = buildErrandDeliveryBody({
            uiLanguage: s.uiLanguage,
            companionName: s.companionName,
            prompt: next.prompt,
            result: next.result ?? '',
          })
          deliveredErrandId = next.id
        }
      }

      const admission = admitProactiveMessage({
        nowMs,
        kind: decision.bracket === 'morning' && deliveredErrandId ? 'errand' : 'bracket',
        text: `${result.title} ${body}`,
        enabled: true,
        preset: s.proactiveFrequency,
        quietStart: s.proactiveQuietHoursStart,
        quietEnd: s.proactiveQuietHoursEnd,
        userTyping: isUserTypingAnywhere(s),
        focusState: 'active',
        channel: 'next_turn',
      })
      if (!admission.allow) return

      await live.pushCompanionNotice({
        chatContent: body,
        bubbleContent: body,
        dedupeKey: `bracket:${decision.bracket}:${localDayKey(nowMs)}`,
        autoHideMs: BRACKET_BUBBLE_MS,
      })

      const fresh = loadBracketState()
      let updated = recordBracketFire(fresh, decision.bracket, nowMs)
      updated.lastPicks = { ...fresh.lastPicks, ...result.pickedIndices }
      updated = decision.bracket === 'evening'
        ? recordBracketEveningPrompt(updated, nowMs)
        : clearBracketEveningTopic(updated)
      writeJson(PROACTIVE_BRACKET_STATE_STORAGE_KEY, updated)
      if (deliveredErrandId) markDelivered(deliveredErrandId)

      const hidden = typeof document !== 'undefined' && (document.hidden || !document.hasFocus())
      if (hidden) {
        try {
          await window.desktopPet?.showProactiveNotification?.({
            title: result.title,
            body,
          })
        } catch {
          // The chat/bubble copy already landed; a missing OS toast is not fatal.
        }
      }

      live.onEvent?.({
        title: `[bracket] ${decision.bracket} delivered`,
        detail: topic ? `callback=${topic.kind}` : 'open question',
        tone: 'info',
      })
    } catch (err) {
      console.warn('[bracket] fire failed:', getRedactedLogErrorMessage(err))
      live.onEvent?.({
        title: '[bracket] delivery failed',
        detail: getRedactedLogErrorMessage(err),
        tone: 'warn',
      })
    } finally {
      runningRef.current = false
    }
  }, [])

  usePollingScheduler({
    enabled: enabled && settings.proactiveBracketEnabled,
    intervalMs: POLL_INTERVAL_MS,
    live: { run },
    tick: () => run(),
  })

  // "First open" is the panel coming back up, not a timed poll. The poll
  // remains a fallback for a panel that was already open at launch.
  const previousPanelCollapsedRef = useRef(panelCollapsed)
  useEffect(() => {
    const wasCollapsed = previousPanelCollapsedRef.current
    previousPanelCollapsedRef.current = panelCollapsed
    if (!enabled || !settings.proactiveBracketEnabled) return
    if (wasCollapsed && !panelCollapsed) void run()
  }, [enabled, panelCollapsed, run, settings.proactiveBracketEnabled])

  // Coming back to the machine after an idle/lock stretch is the other
  // natural "first show up" moment.
  const previousFocusRef = useRef(focusState)
  useEffect(() => {
    const previous = previousFocusRef.current
    previousFocusRef.current = focusState
    if (!enabled || !settings.proactiveBracketEnabled) return
    if (previous !== 'active' && focusState === 'active') void run()
  }, [enabled, focusState, run, settings.proactiveBracketEnabled])
}
