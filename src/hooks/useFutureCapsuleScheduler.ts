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
import { usePollingScheduler } from './usePollingScheduler.ts'
import type { CompanionNoticePayload } from './chat/types.ts'
import type { AppSettings, FocusState } from '../types'

const POLL_INTERVAL_MS = 5 * 60 * 1000  // 5 min — same cadence as bracket / errand

/** Signals one capsule poll reads; the hook mirrors them into the live ref. */
export interface FutureCapsuleSignals {
  settings: AppSettings
  /** Pet-window view of the user's focus; main adds the panel signal itself. */
  focusState?: FocusState
  /** Shared chat path for the capsule chat line; absent keeps the inbox only. */
  pushCompanionNotice?: (payload: CompanionNoticePayload) => Promise<void>
}

interface UseFutureCapsuleSchedulerOptions extends FutureCapsuleSignals {
  enabled?: boolean
}

/** Everything one capsule tick reads. */
export interface FutureCapsuleTickDeps extends FutureCapsuleSignals {
  /**
   * Delivery clock in ms. Defaults to `Date.now()`; tests pass a fixed instant
   * so the capsule framing text and the persisted delivery stamp are stable.
   */
  now?: number
}

/**
 * One future-capsule poll: deliver at most one due capsule to the router.
 *
 * Exported so tests can drive the real tick instead of rebuilding its payload
 * by hand. The hook below only supplies timers and the live settings mirror.
 */
export async function runFutureCapsuleTick({
  settings,
  focusState = 'active',
  pushCompanionNotice,
  now = Date.now(),
}: FutureCapsuleTickDeps, isStopped: () => boolean): Promise<void> {
  const due = findDueCapsule(new Date(now))
  if (!due) return

  const delivery = buildFutureCapsuleDelivery({
    uiLanguage: settings.uiLanguage,
    companionName: settings.companionName,
    capsule: due,
    now: new Date(now),
  })

  try {
    await deliverDueCapsule({
      capsule: due,
      delivery,
      now,
      useLegacyPath: PROACTIVE_LEGACY_PATH.capsule,
      deliver: window.desktopPet?.deliverProactiveMessage,
      showNotification: window.desktopPet?.showProactiveNotification,
      buildContext: async () => {
        const desktopContext = await readProactiveDesktopContext(settings)
        return buildReminderDeliveryContext({
          focusState,
          activeWindowTitle: desktopContext?.activeWindowTitle,
          activeWindowAppName: desktopContext?.activeWindowAppName,
          quietStart: settings.proactiveQuietHoursStart,
          quietEnd: settings.proactiveQuietHoursEnd,
          awayNotificationsEnabled: settings.proactiveAwayNotificationsEnabled,
          now,
        })
      },
      preferences: buildReminderDeliveryPreferences(settings),
      ...(pushCompanionNotice
        ? {
            pushChatLine: (text: string) => pushCompanionNotice({
              chatContent: text,
              // The line is history only for every rule: an empty bubble
              // suppresses the pet bubble that would otherwise default to
              // chatContent (no strip, popup or OS toast either), while the
              // dedupe key keeps this capsule on a single chat entry.
              bubbleContent: '',
              dedupeKey: `capsule:${due.id}`,
              // Quiet conditions already kept the surface down to the inbox;
              // the pet's expression must not advertise what stayed quiet.
              petReaction: false,
            }),
          }
        : {}),
      markDelivered: (id) => { markDelivered(id, new Date(now)) },
      isStopped,
    })
  } catch (err) {
    console.warn('[future-capsule] delivery failed:', getRedactedLogErrorMessage(err))
  }
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
 * Capsules deliberately skip the proactive-etiquette gate: the user chose
 * this date, so the shared daily budget, back-off, silence stop and repeat
 * check must not postpone it. Quiet conditions still belong to the router,
 * which keeps the capsule in the inbox and badge until the user is free.
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
    tick: (live, isStopped) => runFutureCapsuleTick(live, isStopped),
  })
}
