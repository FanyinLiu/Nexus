import { autoDropExpiredArcs, loadOpenArcs, recordCheckInFired } from '../features/arc/openArcStore.ts'
import { decideNextCheckIn } from '../features/arc/openArcPolicy.ts'
import { buildArcCheckIn } from '../features/arc/openArcDelivery.ts'
import {
  deliverDueOpenArc,
  openArcMessageId,
} from '../features/arc/openArcProactiveMessage.ts'
import {
  buildReminderDeliveryContext,
  buildReminderDeliveryPreferences,
  readProactiveDesktopContext,
} from '../features/reminders/proactiveMessage.ts'
import { PROACTIVE_LEGACY_PATH } from '../features/proactive/legacyPaths.ts'
import { getRedactedLogErrorMessage } from '../lib/logRedaction.ts'
import { admitProactiveMessage } from '../features/autonomy/proactiveEtiquette.ts'
import { isUserTypingAnywhere } from '../features/autonomy/userTyping.ts'
import { usePollingScheduler } from './usePollingScheduler.ts'
import type { CompanionNoticePayload } from './chat/types.ts'
import type { AppSettings, FocusState } from '../types'

const POLL_INTERVAL_MS = 5 * 60 * 1000  // 5 min — matches bracket / errand / capsule

interface UseOpenArcSchedulerOptions {
  settings: AppSettings
  enabled?: boolean
  /** Pet-window view of the user's focus; main adds the panel signal itself. */
  focusState?: FocusState
  /** Shared chat path for a rule-2 arc line; absent keeps the inbox only. */
  pushCompanionNotice?: (payload: CompanionNoticePayload) => Promise<void>
}

/**
 * Open-arc thread scheduler.
 *
 * Every 5 minutes:
 *   1. Sweep for expired arcs (>7 days open) and auto-drop them.
 *   2. Ask the policy whether any arc has a due check-in milestone right
 *      now and is outside quiet hours. Fire one check-in per tick and hand
 *      it to the proactive router, which decides the surface and always
 *      writes the inbox. The milestone is recorded once the router accepts
 *      the message, so a failed chat push cannot fire it again.
 *
 * Manual contract: the runner only follows arcs the user explicitly
 * opened. `PROACTIVE_LEGACY_PATH.open_arc` restores the pre-router OS
 * notification for one release.
 */
export function useOpenArcScheduler({
  settings,
  enabled = true,
  focusState = 'active',
  pushCompanionNotice,
}: UseOpenArcSchedulerOptions) {
  usePollingScheduler({
    enabled,
    intervalMs: POLL_INTERVAL_MS,
    requireNotificationBridge: true,
    live: { settings, focusState, pushCompanionNotice },
    tick: async ({ settings: s, focusState: focus, pushCompanionNotice: push }, isStopped) => {
      autoDropExpiredArcs()
      const arcs = loadOpenArcs()
      const decision = decideNextCheckIn(arcs, new Date(), {
        quietHoursStart: s.autonomyQuietHoursStart,
        quietHoursEnd: s.autonomyQuietHoursEnd,
      })
      if (!decision.shouldFire || !decision.arcId || decision.milestoneDay == null) return
      const milestoneDay = decision.milestoneDay

      const arc = arcs.find((a) => a.id === decision.arcId)
      if (!arc) return

      const payload = buildArcCheckIn({
        arc,
        uiLanguage: s.uiLanguage,
        companionName: s.companionName,
        milestoneDay,
      })

      const admission = admitProactiveMessage({
        nowMs: Date.now(),
        kind: 'open_arc',
        text: `${payload.title} ${payload.body}`,
        enabled: true,
        preset: s.proactiveFrequency,
        quietStart: s.proactiveQuietHoursStart,
        quietEnd: s.proactiveQuietHoursEnd,
        userTyping: isUserTypingAnywhere(s),
        focusState: 'active',
        channel: 'next_turn',
      })
      if (!admission.allow) return

      try {
        const now = Date.now()
        await deliverDueOpenArc({
          arc,
          delivery: payload,
          milestoneDay,
          now,
          useLegacyPath: PROACTIVE_LEGACY_PATH.open_arc,
          deliver: window.desktopPet?.deliverProactiveMessage,
          showNotification: window.desktopPet?.showProactiveNotification,
          buildContext: async () => {
            const desktopContext = await readProactiveDesktopContext(s)
            return buildReminderDeliveryContext({
              focusState: focus,
              activeWindowTitle: desktopContext?.activeWindowTitle,
              activeWindowAppName: desktopContext?.activeWindowAppName,
              quietStart: s.proactiveQuietHoursStart,
              quietEnd: s.proactiveQuietHoursEnd,
              awayNotificationsEnabled: s.proactiveAwayNotificationsEnabled,
              now,
            })
          },
          preferences: buildReminderDeliveryPreferences(s),
          ...(push
            ? {
                pushChatLine: (text: string) => push({
                  chatContent: text,
                  // Rule 2 is panel-only: an empty bubble suppresses the pet bubble that would otherwise default to chatContent.
                  bubbleContent: '',
                  dedupeKey: openArcMessageId(arc.id, milestoneDay),
                }),
              }
            : {}),
          recordCheckInFired,
          isStopped,
        })
      } catch (err) {
        console.warn('[open-arc] check-in delivery failed:', getRedactedLogErrorMessage(err))
      }
    },
  })
}
