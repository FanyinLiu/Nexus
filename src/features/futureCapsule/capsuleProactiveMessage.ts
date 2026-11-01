/**
 * Pure future-capsule delivery helpers for the proactive router (M1.1).
 *
 * The capsule scheduler only gathers signals; the message, the post-routing
 * presentation plan and the delivery orchestration live here so they can be
 * tested without React or Electron. A capsule is a one-off authored message,
 * so it is high priority (it must count in the badge) but carries no actions:
 * there is nothing to complete or snooze.
 */

import {
  PROACTIVE_BODY_MAX_LENGTH,
  PROACTIVE_TITLE_MAX_LENGTH,
} from '../../../shared/proactiveDelivery.js'
import type {
  DeliveryContext,
  DeliveryDecision,
  ProactiveDeliveryPreferences,
  ProactiveMessage as SharedProactiveMessage,
} from '../../../shared/proactiveDelivery.js'
import { clipText } from '../reminders/proactiveMessage.ts'
import type { FutureCapsuleRecord } from './futureCapsuleStore.ts'

/** A capsule message with its `kind` narrowed for the renderer bridge. */
export type CapsuleProactiveMessage = Omit<SharedProactiveMessage, 'kind'> & {
  kind: 'capsule'
}

/** The legacy OS-notification payload the scheduler used before M1.1. */
export interface CapsuleDeliveryText {
  title: string
  body: string
}

/**
 * Build the router message for one due capsule.
 *
 * The id is the capsule id alone: a re-delivery of the same capsule updates
 * the existing inbox entry instead of adding a second one.
 */
export function buildCapsuleProactiveMessage(
  capsule: FutureCapsuleRecord,
  delivery: CapsuleDeliveryText,
  now: number,
): CapsuleProactiveMessage {
  return {
    id: `capsule:${capsule.id}`,
    source: 'capsule',
    kind: 'capsule',
    priority: 'high',
    title: clipText(delivery.title, PROACTIVE_TITLE_MAX_LENGTH),
    body: clipText(delivery.body, PROACTIVE_BODY_MAX_LENGTH),
    actions: [],
    createdAt: now,
    origin: { capsuleId: capsule.id },
  }
}

/** The renderer-side surfaces a capsule still owns after main routes it. */
export interface CapsulePresentationPlan {
  /**
   * Rule 2 (panel focused) has no panel outlet in main, so the chat line is
   * its panel surface. Rules 4 and 5 are covered by the bubble and
   * os_notification outlets; 1, 3 and 6 are inbox(+badge) only.
   */
  chatLine: boolean
}

/** Map a routing decision to the renderer's own capsule surfaces. */
export function planCapsulePresentation(
  decision: Pick<DeliveryDecision, 'rule'>,
): CapsulePresentationPlan {
  return { chatLine: decision.rule === 2 }
}

/** Bridge function shape for the router call. */
export type CapsuleDeliverBridge = (payload: {
  message: CapsuleProactiveMessage
  context: DeliveryContext
  preferences: ProactiveDeliveryPreferences
}) => Promise<DeliveryDecision>

/** Bridge function shape for the legacy OS notification. */
export type CapsuleNotificationBridge = (payload: CapsuleDeliveryText) => Promise<unknown>

export interface DeliverDueCapsuleDeps {
  capsule: FutureCapsuleRecord
  delivery: CapsuleDeliveryText
  now: number
  /** One-version rollback: when true the pre-M1.1 notification path runs. */
  useLegacyPath: boolean
  deliver?: CapsuleDeliverBridge
  showNotification?: CapsuleNotificationBridge
  buildContext: () => Promise<DeliveryContext> | DeliveryContext
  preferences: ProactiveDeliveryPreferences
  pushChatLine?: (text: string) => Promise<void>
  markDelivered: (id: string) => void
  isStopped: () => boolean
}

export interface DeliverDueCapsuleResult {
  path: 'legacy' | 'router' | 'fallback'
  rule?: DeliveryDecision['rule']
}

/**
 * Deliver one due capsule through the router, or fall back to the legacy
 * notification when the router is unavailable.
 *
 * The inbox stores the message on success, so an inbox-only rule still counts
 * as delivered. A failed router call is retried once as the old OS toast so
 * the user never loses a message to a bridge error.
 */
export async function deliverDueCapsule(
  deps: DeliverDueCapsuleDeps,
): Promise<DeliverDueCapsuleResult> {
  if (deps.useLegacyPath || !deps.deliver) {
    await deliverLegacy(deps)
    return { path: 'legacy' }
  }

  const message = buildCapsuleProactiveMessage(deps.capsule, deps.delivery, deps.now)
  let decision: DeliveryDecision
  try {
    const context = await deps.buildContext()
    decision = await deps.deliver({ message, context, preferences: deps.preferences })
  } catch {
    await deliverLegacy(deps)
    return { path: 'fallback' }
  }

  if (planCapsulePresentation(decision).chatLine && deps.pushChatLine) {
    await deps.pushChatLine(deps.delivery.body)
  }
  if (!deps.isStopped()) deps.markDelivered(deps.capsule.id)
  return { path: 'router', rule: decision.rule }
}

/** Pre-M1.1 surfacing: one OS notification, then mark the capsule delivered. */
async function deliverLegacy(deps: DeliverDueCapsuleDeps): Promise<void> {
  await deps.showNotification?.(deps.delivery)
  if (!deps.isStopped()) deps.markDelivered(deps.capsule.id)
}
