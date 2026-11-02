import {
  findDueCapsule,
  markDelivered,
} from '../features/futureCapsule/futureCapsuleStore.ts'
import { buildFutureCapsuleDelivery } from '../features/futureCapsule/futureCapsuleDelivery.ts'
import { deliverDueCapsule } from '../features/futureCapsule/capsuleProactiveMessage.ts'
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

const POLL_INTERVAL_MS = 5 * 60 * 1000  // 5 min — same cadence as bracket / errand

interface UseFutureCapsuleSchedulerOptions {
  settings: AppSettings
  enabled?: boolean
  /** Pet-window view of the user's focus; main adds the panel signal itself. */
  focusState?: FocusState
  /** Shared chat path for the capsule chat line; absent keeps the inbox only. */
  pushCompanionNotice?: (payload: CompanionNoticePayload) => Promise<void>
}

/**
 * Future-self capsule scheduler.
 *
 * Polls every 5 minutes. When a pending capsule's `scheduledFor` date
 * has arrived (or passed — late-running app catches up), the scheduler
 * hands the past-self message to the proactive router, which decides the
 * surface and always writes the inbox. A one-off capsule is high priority,
 * so the badge counts it as soon as it exists.
 *
 * One delivery per tick, so a queue of overdue capsules drips out one
 * day at a time rather than dumping on the user. Manual approval
 * contract is enforced upstream: the runner only delivers entries the
 * user explicitly created. `PROACTIVE_LEGACY_PATH.capsule` restores the
 * pre-router OS notification for one release.
 */
export function useFutureCapsuleScheduler({
  settings,
  enabled = true,
  focusState = 'active',
  pushCompanionNotice,
}: UseFutureCapsuleSchedulerOptions) {
  usePollingScheduler({
    enabled,
    intervalMs: POLL_INTERVAL_MS,
    requireNotificationBridge: true,
    live: { settings, focusState, pushCompanionNotice },
    tick: async ({ settings: s, focusState: focus, pushCompanionNotice: push }, isStopped) => {
      const due = findDueCapsule()
      if (!due) return

      const delivery = buildFutureCapsuleDelivery({
        uiLanguage: s.uiLanguage,
        companionName: s.companionName,
        capsule: due,
      })

      const admission = admitProactiveMessage({
        nowMs: Date.now(),
        kind: 'capsule',
        text: `${delivery.title} ${delivery.body}`,
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
        await deliverDueCapsule({
          capsule: due,
          delivery,
          now,
          useLegacyPath: PROACTIVE_LEGACY_PATH.capsule,
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
                  // The line is history only for every rule: an empty bubble
                  // suppresses the pet bubble that would otherwise default to
                  // chatContent (no strip, popup or OS toast either), while the
                  // dedupe key keeps this capsule on a single chat entry.
                  bubbleContent: '',
                  dedupeKey: `capsule:${due.id}`,
                }),
              }
            : {}),
          markDelivered,
          isStopped,
        })
      } catch (err) {
        console.warn('[future-capsule] delivery failed:', getRedactedLogErrorMessage(err))
      }
    },
  })
}
