/**
 * Timer and focus wiring for the daily memory pass and the shared agenda.
 * Whether to run, what to say, and the rate limit all live in features.
 * Failures are logged and swallowed so chat never waits on this hook.
 */

import { useCallback, useEffect, useRef } from 'react'
import {
  acquireBackgroundChatLease,
  getBackgroundChatGate,
  releaseBackgroundChatLease,
} from '../features/autonomy/backgroundChatPolicy.ts'
import {
  PROACTIVE_RESUME_GRACE_MS,
  evaluateProactiveEtiquette,
  isLikelyFullscreenSurface,
} from '../features/autonomy/proactiveBudget.ts'
import {
  buildAgendaPrompt,
  markAgendaFired,
  recordLoopSurfaced,
  selectAgendaItem,
  syncProactiveAgenda,
} from '../features/autonomy/proactiveAgenda.ts'
import { isUserTyping } from '../features/autonomy/userTyping.ts'
import { consolidateDailyMemory, decideDailyConsolidation } from '../features/memory/dailyConsolidation.ts'
import type { Translator } from '../types/i18n.ts'
import { getMemoryReconcileRevision } from './chat/memoryReconcile.ts'
import { localDayKey } from '../lib/localDate.ts'
import { getRedactedLogErrorMessage } from '../lib/logRedaction.ts'
import { appendMemoryOpLog } from '../lib/storage/memoryOpLog.ts'
import { loadMessageFollowUps, settleMessageFollowUp } from '../lib/storage/messageFollowUps.ts'
import { loadProactiveAgenda, saveProactiveAgenda } from '../lib/storage/proactiveAgenda.ts'
import type { AppSettings, DailyMemoryStore, FocusState, MemoryItem } from '../types'

const TICK_MS = 60_000

type Notice = {
  chatContent: string
  bubbleContent?: string
  dedupeKey?: string
}

export function useProactiveAgenda(options: {
  enabled: boolean
  settingsRef: React.RefObject<AppSettings>
  memoriesRef: React.RefObject<MemoryItem[]>
  dailyMemoriesRef: React.RefObject<DailyMemoryStore>
  setMemories: (memories: MemoryItem[]) => void
  focusState: FocusState
  focusStateRef: React.RefObject<FocusState>
  idleSecondsRef: React.RefObject<number>
  busyRef?: React.RefObject<boolean>
  pushCompanionNotice: (payload: Notice) => Promise<void>
  t: Translator
  onLog: (title: string, detail: string) => void
}) {
  const optionsRef = useRef(options)
  // Readers are timers and callbacks, which run after commit. The write stays
  // in an effect so render does not touch the ref.
  useEffect(() => {
    optionsRef.current = options
  })
  const runningRef = useRef(false)
  const launchRef = useRef(true)
  const resumedAtRef = useRef<number | null>(null)
  const fullscreenRef = useRef(false)
  const previousFocusRef = useRef<FocusState>(options.focusState)

  const refreshFullscreen = useCallback(async () => {
    const settings = optionsRef.current.settingsRef.current
    if (!settings?.contextAwarenessEnabled || !settings.activeWindowContextEnabled || settings.companionAwarenessPaused) {
      fullscreenRef.current = false
      return
    }
    try {
      const snapshot = await window.desktopPet?.getDesktopContext?.({ includeActiveWindow: true })
      fullscreenRef.current = isLikelyFullscreenSurface(snapshot?.activeWindowTitle, snapshot?.activeWindowAppName)
    } catch {
      fullscreenRef.current = false
    }
  }, [])

  const runConsolidation = useCallback(async (launching: boolean) => {
    const current = optionsRef.current
    if (!current.enabled || runningRef.current) return
    const settings = current.settingsRef.current
    if (!settings) return
    const busy = current.busyRef?.current === true
    const decision = decideDailyConsolidation({
      nowMs: Date.now(),
      lastRunAtMs: Date.parse(loadProactiveAgenda().lastConsolidationAt ?? ''),
      focusState: current.focusStateRef.current,
      idleSeconds: current.idleSecondsRef.current,
      memoryPaused: settings.memoryPaused === true,
      chatBusy: busy,
      launching,
    })
    if (!decision.run) {
      if (decision.reason !== 'chatting' && decision.reason !== 'paused') launchRef.current = false
      return
    }
    runningRef.current = true
    const revision = getMemoryReconcileRevision()
    let lease: ReturnType<typeof acquireBackgroundChatLease> = null
    try {
      const diary = Object.values(current.dailyMemoriesRef.current).flat()
      const apiKey = settings.apiKey?.trim() ?? ''
      const completeChat = window.desktopPet?.completeChat
      const policy = {
        providerId: settings.apiProviderId,
        baseUrl: settings.apiBaseUrl,
        model: settings.model,
        apiKey: settings.apiKey,
      }
      let complete: ((prompt: { system: string; user: string }) => Promise<string | null>) | null = null
      if (apiKey && completeChat && getBackgroundChatGate(policy).allowed) {
        lease = acquireBackgroundChatLease()
        if (lease) {
          complete = async (prompt) => {
            const response = await completeChat({
              providerId: settings.apiProviderId,
              baseUrl: settings.apiBaseUrl,
              apiKey,
              model: settings.model,
              messages: [
                { role: 'system', content: prompt.system },
                { role: 'user', content: prompt.user },
              ],
              temperature: 0,
              maxTokens: 800,
              traceId: 'background:memory-consolidate',
            })
            return response?.content ?? null
          }
        }
      }
      const sinceMs = Date.parse(loadProactiveAgenda().lastConsolidationAt ?? '')
      const result = await consolidateDailyMemory({
        memories: current.memoriesRef.current,
        diaryEntries: diary,
        sinceMs: Number.isFinite(sinceMs) ? sinceMs : null,
        complete,
      })
      if (revision !== getMemoryReconcileRevision() || current.busyRef?.current) {
        current.onLog('Daily consolidation skipped', 'chat moved on')
        return
      }
      current.memoriesRef.current = result.memories
      current.setMemories(result.memories)
      const persisted = result.ops.filter((op) => op.op !== 'NOOP')
      if (persisted.length) appendMemoryOpLog(persisted)
      const nowMs = Date.now()
      const synced = syncProactiveAgenda(result.memories, nowMs)
      saveProactiveAgenda({ ...synced, lastConsolidationAt: new Date(nowMs).toISOString() })
      launchRef.current = false
      current.onLog('Daily consolidation finished', `trigger=${decision.trigger} source=${result.decisionSource} ops=${result.ops.length}`)
    } catch (error) {
      current.onLog('Daily consolidation skipped', getRedactedLogErrorMessage(error))
    } finally {
      if (lease) releaseBackgroundChatLease(lease)
      runningRef.current = false
    }
  }, [])

  const deliverReturn = useCallback(async () => {
    const current = optionsRef.current
    if (!current.enabled) return
    const settings = current.settingsRef.current
    if (!settings?.proactiveAgendaEnabled || settings.memoryPaused) return
    if (current.busyRef?.current) return
    try {
      await refreshFullscreen()
      const nowMs = Date.now()
      const state = syncProactiveAgenda(current.memoriesRef.current, nowMs)
      const etiquette = evaluateProactiveEtiquette({
        nowMs,
        enabled: true,
        preset: settings.proactiveFrequency,
        quietStart: settings.proactiveQuietHoursStart,
        quietEnd: settings.proactiveQuietHoursEnd,
        firedAt: state.firedAt,
        userTyping: isUserTyping(nowMs),
        fullscreen: fullscreenRef.current,
        focusState: 'active',
        channel: 'return',
        resumedAtMs: resumedAtRef.current,
      })
      if (!etiquette.allow) return
      const item = selectAgendaItem(state.items, nowMs, 'return')
      if (!item) return
      const text = item.kind === 'message_follow_up'
        ? current.t('proactive.bubble.follow_up', { summary: item.summary })
        : current.t('proactive.bubble.loop', { summary: item.summary })
      // Claim the slot before the bubble. The in-memory notice dedupe does not
      // survive a restart or update, so a crash after the bubble would send it again.
      saveProactiveAgenda(markAgendaFired(state, item.id, nowMs))
      if (item.kind === 'message_follow_up') settleMessageFollowUp(item.sourceId, nowMs)
      if (item.kind === 'open_loop') {
        const next = recordLoopSurfaced(current.memoriesRef.current, item.sourceId, new Date(nowMs).toISOString())
        current.memoriesRef.current = next
        current.setMemories(next)
      }
      await current.pushCompanionNotice({
        chatContent: text,
        bubbleContent: text,
        dedupeKey: `agenda:${item.id}:${localDayKey(nowMs)}`,
      })
    } catch (error) {
      current.onLog('Proactive agenda skipped', getRedactedLogErrorMessage(error))
    }
  }, [refreshFullscreen])

  useEffect(() => {
    if (!options.enabled) return
    const previous = previousFocusRef.current
    previousFocusRef.current = options.focusState
    if (previous !== 'active' && options.focusState === 'active') {
      resumedAtRef.current = Date.now()
      const timer = window.setTimeout(() => { void deliverReturn() }, PROACTIVE_RESUME_GRACE_MS)
      return () => window.clearTimeout(timer)
    }
    return undefined
  }, [deliverReturn, options.enabled, options.focusState])

  useEffect(() => {
    if (!options.enabled) return
    const tick = () => { void runConsolidation(launchRef.current) }
    tick()
    const timer = window.setInterval(tick, TICK_MS)
    return () => window.clearInterval(timer)
  }, [options.enabled, options.focusState, runConsolidation])

  const consumeNextTurn = useCallback((): string => {
    try {
      const current = optionsRef.current
      const settings = current.settingsRef.current
      if (!settings?.proactiveAgendaEnabled) {
        return ''
      }
      const nowMs = Date.now()
      const state = syncProactiveAgenda(current.memoriesRef.current, nowMs)
      const items = settings.memoryPaused
        ? state.items.filter((item) => item.kind !== 'open_loop')
        : state.items
      const etiquette = evaluateProactiveEtiquette({
        nowMs,
        enabled: true,
        preset: settings.proactiveFrequency,
        quietStart: settings.proactiveQuietHoursStart,
        quietEnd: settings.proactiveQuietHoursEnd,
        firedAt: state.firedAt,
        userTyping: false,
        fullscreen: fullscreenRef.current,
        focusState: 'active',
        channel: 'next_turn',
      })
      if (!etiquette.allow) return ''
      const item = selectAgendaItem(items, nowMs, 'next_turn')
      if (!item) return ''
      saveProactiveAgenda(markAgendaFired({ ...state, items: state.items }, item.id, nowMs))
      if (item.kind === 'message_follow_up') settleMessageFollowUp(item.sourceId, nowMs)
      if (item.kind === 'open_loop') {
        const next = recordLoopSurfaced(current.memoriesRef.current, item.sourceId, new Date(nowMs).toISOString())
        current.memoriesRef.current = next
        current.setMemories(next)
      }
      return buildAgendaPrompt(item, loadMessageFollowUps())
    } catch {
      return ''
    }
  }, [])

  return { consumeNextTurn }
}
