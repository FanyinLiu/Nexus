import { decideAwayNotification } from '../features/proactive/awayScheduler.ts'
import { pickAwayNotificationCopy } from '../features/proactive/awayNotificationCopy.ts'
import {
  buildAwaySummaryMessage,
  countAwaySummaryItems,
} from '../features/proactive/awaySummary.ts'
import type { AwaySummaryEntry } from '../features/proactive/awaySummary.ts'
import { deliverThroughRouter } from '../features/proactive/routedDelivery.ts'
import {
  buildReminderDeliveryContext,
  buildReminderDeliveryPreferences,
  readProactiveDesktopContext,
} from '../features/reminders/proactiveMessage.ts'
import {
  loadAwayLastFiredMs,
  saveAwayLastFiredMs,
} from '../lib/storage.ts'
import { getRedactedLogErrorMessage } from '../lib/logRedaction.ts'
import { admitProactiveMessage } from '../features/autonomy/proactiveEtiquette.ts'
import { isUserTypingAnywhere } from '../features/autonomy/userTyping.ts'
import { usePollingScheduler } from './usePollingScheduler.ts'
import type {
  DeliveryContext,
  DeliveryDecision,
  ProactiveDeliveryPreferences,
  ProactiveMessage,
} from '../../shared/proactiveDelivery.js'
import type { AppSettings, ChatMessage, FocusState } from '../types'

const POLL_INTERVAL_MS = 5 * 60_000 // every 5 minutes — coarse enough that startup cost is nil

function findLastUserMessageMs(messages: ChatMessage[]): number | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'user') {
      const t = Date.parse(messages[i].createdAt)
      return Number.isFinite(t) ? t : null
    }
  }
  return null
}

/** Bridge functions one away tick may call; defaults read `window.desktopPet`. */
export interface AwayNotificationBridge {
  listInbox?: () => Promise<{ entries?: readonly AwaySummaryEntry[] } | null | undefined>
  deliver?: (payload: {
    message: ProactiveMessage
    context: DeliveryContext
    preferences: ProactiveDeliveryPreferences
  }) => Promise<DeliveryDecision>
  showNotification?: (payload: { title: string; body: string }) => Promise<unknown>
}

/** Everything one away tick reads; exported so tests drive the real tick. */
export interface RunAwayNotificationTickOptions {
  settings: AppSettings
  messages: ChatMessage[]
  panelOpen: boolean
  /** Current focus, so the router sees the same signal as the other sources. */
  focusState?: FocusState
  /** Delivery clock; tests pass a fixed instant. */
  now?: number
  /** Test seams for storage and the bridge. */
  loadLastFiredMs?: () => number | null
  saveLastFiredMs?: (ms: number) => void
  bridge?: AwayNotificationBridge
  isStopped?: () => boolean
}

function readWindowBridge(): AwayNotificationBridge {
  if (typeof window === 'undefined') return {}
  const bridge = window.desktopPet
  return {
    listInbox: bridge?.listProactiveInbox as AwayNotificationBridge['listInbox'],
    deliver: bridge?.deliverProactiveMessage as AwayNotificationBridge['deliver'],
    showNotification: bridge?.showProactiveNotification as AwayNotificationBridge['showNotification'],
  }
}

async function readAwaySummaryCount(
  listInbox: AwayNotificationBridge['listInbox'],
  sinceMs: number,
): Promise<number> {
  if (!listInbox) return 0
  try {
    const snapshot = await listInbox()
    return countAwaySummaryItems(snapshot?.entries, sinceMs)
  } catch {
    // An unreadable inbox must keep the legacy ping instead of announcing a
    // count the scheduler could not verify.
    return 0
  }
}

/**
 * One away-notification poll.
 *
 * The decision and etiquette gates behave exactly as before. Once they pass,
 * the tick counts unread inbox items since the user's last message and sends
 * one count-only away summary through the router when there are any. A zero
 * count, an unreadable inbox, or a missing/throwing router bridge falls back
 * to the original direct "thinking of you" toast, so "0 things" never shows
 * and the legacy behavior stays intact.
 */
export async function runAwayNotificationTick({
  settings,
  messages,
  panelOpen,
  focusState = 'active',
  now = Date.now(),
  loadLastFiredMs = loadAwayLastFiredMs,
  saveLastFiredMs = saveAwayLastFiredMs,
  bridge,
  isStopped = () => false,
}: RunAwayNotificationTickOptions): Promise<void> {
  if (!settings.proactiveAwayNotificationsEnabled) return
  if (panelOpen) return

  const lastUserActivityMs = findLastUserMessageMs(messages)
  const lastFiredMs = loadLastFiredMs()
  const decision = decideAwayNotification({
    enabled: true,
    nowMs: now,
    lastUserActivityMs,
    lastFiredMs,
    thresholdMinutes: settings.proactiveAwayNotificationThresholdMinutes,
  })

  if (!decision.shouldFire) return

  const copy = pickAwayNotificationCopy({
    uiLanguage: settings.uiLanguage,
    relationshipType: settings.companionRelationshipType,
    companionName: settings.companionName,
  })

  const admission = admitProactiveMessage({
    nowMs: now,
    kind: 'away',
    text: `${copy.title} ${copy.body}`,
    enabled: true,
    preset: settings.proactiveFrequency,
    quietStart: settings.proactiveQuietHoursStart,
    quietEnd: settings.proactiveQuietHoursEnd,
    userTyping: isUserTypingAnywhere(settings),
    focusState: 'active',
    channel: 'next_turn',
  })
  if (!admission.allow) return

  const resolvedBridge = bridge ?? readWindowBridge()
  // With no user message there is no activity window to count from; reading
  // the inbox from epoch would announce its whole contents, so skip the read
  // and let the legacy ping below handle the tick.
  const summaryCount = lastUserActivityMs === null
    ? 0
    : await readAwaySummaryCount(resolvedBridge.listInbox, lastUserActivityMs)

  try {
    if (summaryCount > 0 && resolvedBridge.deliver) {
      await deliverThroughRouter<ProactiveMessage, string>({
        buildMessage: () => buildAwaySummaryMessage({
          title: copy.title,
          body: copy.body,
          summaryCount,
          firedAtMs: now,
        }),
        useLegacyPath: false,
        deliver: resolvedBridge.deliver,
        buildContext: async () => {
          const desktopContext = await readProactiveDesktopContext(settings)
          return buildReminderDeliveryContext({
            focusState,
            activeWindowTitle: desktopContext?.activeWindowTitle,
            activeWindowAppName: desktopContext?.activeWindowAppName,
            quietStart: settings.proactiveQuietHoursStart,
            quietEnd: settings.proactiveQuietHoursEnd,
            awayNotificationsEnabled: settings.proactiveAwayNotificationsEnabled,
            stripEnabled: settings.proactiveReminderStripEnabled,
            now,
          })
        },
        preferences: buildReminderDeliveryPreferences(settings),
        planChatLine: () => ({ chatLine: false, line: '' }),
        onDelivered: () => saveLastFiredMs(Date.now()),
        isStopped,
        runLegacy: async () => {
          await resolvedBridge.showNotification?.({ title: copy.title, body: copy.body })
        },
      })
      return
    }

    await resolvedBridge.showNotification?.({ title: copy.title, body: copy.body })
    saveLastFiredMs(Date.now())
  } catch (err) {
    console.warn('[awayNotification] fire failed:', getRedactedLogErrorMessage(err))
  }
}

type UseAwayNotificationSchedulerOptions = {
  settings: AppSettings
  messages: ChatMessage[]
  /** Pause scheduling while the panel is open and visible to the user. */
  panelOpen: boolean
  /** Pet-window view of the user's focus; main adds the panel signal itself. */
  focusState?: FocusState
  enabled?: boolean
}

/**
 * Polls every 5 min and, when the user has gone silent past
 * `proactiveAwayNotificationThresholdMinutes` and the cooldown / quiet-hours
 * gates pass, either delivers one count-only away summary through the router
 * or keeps the original "thinking of you" OS toast. Pauses while the panel
 * window is open (no point notifying someone who's already looking at the
 * companion).
 */
export function useAwayNotificationScheduler({
  settings,
  messages,
  panelOpen,
  focusState = 'active',
  enabled = true,
}: UseAwayNotificationSchedulerOptions) {
  // Live values ride the scheduler's ref so the interval handler always
  // sees the latest ones without tearing the timer down on every
  // chat-message change. The immediate tick covers the case where the
  // user re-opens the app after a long absence.
  usePollingScheduler({
    enabled: enabled && settings.proactiveAwayNotificationsEnabled,
    intervalMs: POLL_INTERVAL_MS,
    requireNotificationBridge: true,
    live: { settings, messages, panelOpen, focusState },
    tick: ({ settings: s, messages: msgs, panelOpen: open, focusState: focus }, isStopped) =>
      runAwayNotificationTick({
        settings: s,
        messages: msgs,
        panelOpen: open,
        focusState: focus,
        isStopped,
      }),
  })
}
