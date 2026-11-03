import {
  findDueCapsule,
  markDelivered,
} from '../features/futureCapsule/futureCapsuleStore.ts'
import { buildFutureCapsuleDelivery } from '../features/futureCapsule/futureCapsuleDelivery.ts'
import { deliverDueCapsule } from '../features/futureCapsule/capsuleProactiveMessage.ts'
import type { CapsuleChatLine } from '../features/futureCapsule/capsuleProactiveMessage.ts'
import { waitForCapsuleTypingPause } from '../features/futureCapsule/capsuleTypingWait.ts'
import { isUserTypingAnywhere } from '../features/autonomy/userTyping.ts'
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

/**
 * Capsules whose tick is currently waiting or delivering.
 *
 * `usePollingScheduler` does not await a tick, and its interval matches the
 * five-minute typing budget, so an overlapping tick can see the same pending
 * capsule. The id guard lets that tick skip instead of delivering twice.
 */
const inFlightCapsuleIds = new Set<string>()

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
  /**
   * Test seams for the typing wait. Production omits them, which reads the
   * opt-in signal, the bridge permission and real timers instead.
   */
  typingWait?: {
    readPermission?: () => unknown | Promise<unknown>
    isTyping?: () => boolean
    sleep?: (ms: number) => Promise<void>
    now?: () => number
  }
}

/**
 * One future-capsule poll: deliver at most one due capsule to the router.
 *
 * Exported so tests can drive the real tick instead of rebuilding its payload
 * by hand. The hook below only supplies timers and the live settings mirror.
 *
 * A due capsule first passes the typing-pause gate (see the scheduler doc
 * below). The gate only reads an aggregate boolean and never logs; when it
 * waits, the delivery framing and stamp use the post-wait clock. A capsule
 * already waiting or delivering in another tick is skipped by id, because
 * the polling host does not await ticks.
 */
export async function runFutureCapsuleTick({
  settings,
  focusState = 'active',
  pushCompanionNotice,
  now = Date.now(),
  typingWait,
}: FutureCapsuleTickDeps, isStopped: () => boolean): Promise<void> {
  const due = findDueCapsule(new Date(now))
  if (!due || inFlightCapsuleIds.has(due.id)) return

  inFlightCapsuleIds.add(due.id)
  try {
    const waitClock = typingWait?.now ?? Date.now
    const wait = await waitForCapsuleTypingPause({
      enabled: settings.typingAwarenessEnabled === true,
      readPermission: typingWait?.readPermission
        ?? (() => window.desktopPet?.getDesktopTypingStatus?.()),
      isTyping: typingWait?.isTyping
        ?? (() => isUserTypingAnywhere(settings, waitClock())),
      sleep: typingWait?.sleep
        ?? ((ms) => new Promise<void>((resolve) => { globalThis.setTimeout(resolve, ms) })),
      now: waitClock,
      isStopped,
    })
    // The scheduler stopped while waiting: the capsule stays pending for the
    // next tick instead of arriving after the surface is gone.
    if (isStopped()) return

    const deliverAt = wait.waited ? waitClock() : now
    const delivery = buildFutureCapsuleDelivery({
      uiLanguage: settings.uiLanguage,
      capsule: due,
      now: new Date(deliverAt),
    })

    await deliverDueCapsule({
      capsule: due,
      delivery,
      now: deliverAt,
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
          stripEnabled: settings.proactiveReminderStripEnabled,
          now: deliverAt,
        })
      },
      preferences: buildReminderDeliveryPreferences(settings),
      ...(pushCompanionNotice
        ? {
            pushChatLine: (line: CapsuleChatLine) => pushCompanionNotice({
              chatContent: line.content,
              // The card is the letter itself; it rides the chat history so
              // every outlet that renders a capsule line can show it.
              capsuleLetter: line.capsuleLetter,
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
      markDelivered: (id) => { markDelivered(id, new Date(deliverAt)) },
      isStopped,
    })
  } catch (err) {
    console.warn('[future-capsule] delivery failed:', getRedactedLogErrorMessage(err))
  } finally {
    inFlightCapsuleIds.delete(due.id)
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
 * The one thing that does hold a capsule back is active typing. When the
 * opt-in typing-awareness setting is on and the OS reports permission, a due
 * capsule waits for the aggregate typing signal to pause, for at most five
 * minutes; after that the budget wins and it is delivered anyway. The gate
 * reads only typing / not-typing — never key contents, codes or rates — and
 * logs nothing. With the setting off, the permission denied or unavailable,
 * a missing bridge, or a garbled status, no typing state is read and the
 * capsule is delivered immediately.
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
