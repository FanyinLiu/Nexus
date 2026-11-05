/**
 * Pure future-capsule delivery helpers for the proactive router (M1.1).
 *
 * The capsule scheduler only gathers signals; the message, the post-routing
 * presentation plan and the delivery orchestration live here so they can be
 * tested without React or Electron. A capsule is a one-off authored message,
 * so it is high priority (it must count in the badge) but carries no actions:
 * there is nothing to complete or snooze.
 *
 * Three copies leave this module and they are deliberately different:
 * the inbox row keeps the letter (`body` + `fullBody`), while `publicCopy`
 * is the only text a bubble or OS toast may render (title + opener), and the
 * chat line carries the opener plus the full letter as a card payload.
 */

import {
  PROACTIVE_BODY_MAX_LENGTH,
  PROACTIVE_FULL_BODY_MAX_LENGTH,
  PROACTIVE_TITLE_MAX_LENGTH,
} from '../../../shared/proactiveDelivery.js'
import type {
  DeliveryContext,
  DeliveryDecision,
  ProactiveDeliveryPreferences,
  ProactiveMessage as SharedProactiveMessage,
} from '../../../shared/proactiveDelivery.js'
import { deliverThroughRouter } from '../proactive/routedDelivery.ts'
import type { FutureCapsuleDelivery } from './futureCapsuleDelivery.ts'
import type { FutureCapsuleRecord } from './futureCapsuleStore.ts'

/** A capsule message with its `kind` narrowed for the renderer bridge. */
export type CapsuleProactiveMessage = Omit<SharedProactiveMessage, 'kind'> & {
  kind: 'capsule'
}

/** The localized copy `buildFutureCapsuleDelivery` produces for one capsule. */
export type CapsuleDeliveryText = FutureCapsuleDelivery

/**
 * One chat line for a routed capsule: the opener is the message text, and the
 * letter travels beside it as structured card data. The card body is capped at
 * the storage budget so an oversized capsule cannot break the IPC contract.
 */
export interface CapsuleChatLine {
  content: string
  capsuleLetter: {
    title?: string
    body: string
    writtenAt: string
  }
}

/**
 * Clip text to a display budget without rewriting its inner content.
 *
 * `clipText` collapses all whitespace, which would silently rewrite a capsule
 * the user authored verbatim (line breaks, indentation). Here only the tail is
 * replaced by an ellipsis, so the visible prefix is byte-for-byte the source
 * copy and the result is always a valid IPC payload.
 */
function clipVerbatim(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength - 1)}…`
}

/**
 * Clip an expanded letter to the storage budget, keeping its authored text.
 */
export function clipFullBody(text: string): string {
  return clipVerbatim(text, PROACTIVE_FULL_BODY_MAX_LENGTH)
}

/**
 * Build the router message for one due capsule.
 *
 * The id is the capsule id alone: a re-delivery of the same capsule updates
 * the existing inbox entry instead of adding a second one. The inbox row is
 * the letter's header plus its opening characters; `publicCopy` carries the
 * routing title and the opener so a bubble or OS toast can never read the
 * letter.
 */
export function buildCapsuleProactiveMessage(
  capsule: FutureCapsuleRecord,
  delivery: CapsuleDeliveryText,
  now: number,
): CapsuleProactiveMessage {
  const body = clipVerbatim(delivery.letterBody, PROACTIVE_BODY_MAX_LENGTH)
  const fullBody = clipFullBody(delivery.letterBody)
  return {
    id: `capsule:${capsule.id}`,
    source: 'capsule',
    kind: 'capsule',
    priority: 'high',
    title: clipVerbatim(delivery.header, PROACTIVE_TITLE_MAX_LENGTH),
    body,
    // Only carry the expanded copy when it actually adds text; an identical
    // fullBody would duplicate the payload for every short capsule.
    ...(fullBody !== body ? { fullBody } : {}),
    publicCopy: {
      title: clipVerbatim(delivery.notificationTitle, PROACTIVE_TITLE_MAX_LENGTH),
      body: clipVerbatim(delivery.opener, PROACTIVE_BODY_MAX_LENGTH),
    },
    actions: [],
    createdAt: now,
    origin: { capsuleId: capsule.id },
  }
}

/**
 * The chat line for one routed capsule: opener plus card.
 *
 * The card header stays the capsule's raw title so the renderer can fall back
 * to the localized default; the letter body is capped at the storage budget.
 */
export function buildCapsuleChatLine(
  capsule: FutureCapsuleRecord,
  delivery: CapsuleDeliveryText,
): CapsuleChatLine {
  const title = (capsule.title ?? '').trim()
  return {
    content: delivery.opener,
    capsuleLetter: {
      ...(title ? { title } : {}),
      body: clipFullBody(delivery.letterBody),
      writtenAt: delivery.writtenAt,
    },
  }
}

/** The renderer-side surfaces a capsule still owns after main routes it. */
export interface CapsulePresentationPlan {
  /**
   * The chat line is chat-history only: it never draws a bubble, strip, popup
   * or OS toast. Every routed rule plans it because no routed outlet shows the
   * full text — 1, 3 and 6 are inbox(+badge) only, 4 and 5 carry the public
   * copy in a bubble or notification, and rule 2 has no panel outlet in main.
   */
  chatLine: boolean
}

/** Map a routing decision to the renderer's own capsule surfaces. */
export function planCapsulePresentation(
  decision: Pick<DeliveryDecision, 'rule'>,
): CapsulePresentationPlan {
  // The router only returns rules 1-6 and every one of them needs the line, so
  // the route itself is the only thing this plan can branch on today.
  return { chatLine: decision.rule >= 1 }
}

/** Bridge function shape for the router call. */
export type CapsuleDeliverBridge = (payload: {
  message: CapsuleProactiveMessage
  context: DeliveryContext
  preferences: ProactiveDeliveryPreferences
}) => Promise<DeliveryDecision>

/** Bridge function shape for the legacy OS notification. */
export type CapsuleNotificationBridge = (
  payload: { title: string; body: string },
) => Promise<unknown>

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
  pushChatLine?: (line: CapsuleChatLine) => Promise<void>
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
 *
 * Success is settled before any chat push: once the router or the fallback
 * notification resolves, the capsule is marked delivered even when the
 * scheduler stopped in the meantime. Both paths then get the same single chat
 * line — the opener followed by the letter card — because no legacy OS toast
 * can show the letter either. A chat push may still fail; that error reaches
 * the caller's log instead of re-delivering the capsule on every tick.
 */
export async function deliverDueCapsule(
  deps: DeliverDueCapsuleDeps,
): Promise<DeliverDueCapsuleResult> {
  const message = buildCapsuleProactiveMessage(deps.capsule, deps.delivery, deps.now)
  return deliverThroughRouter<CapsuleProactiveMessage, CapsuleChatLine>({
    buildMessage: () => message,
    useLegacyPath: deps.useLegacyPath,
    deliver: deps.deliver,
    buildContext: deps.buildContext,
    preferences: deps.preferences,
    ...(deps.pushChatLine ? { pushChatLine: deps.pushChatLine } : {}),
    planChatLine: (decision) => ({
      chatLine: planCapsulePresentation(decision).chatLine,
      // One call for every rule, so a capsule can never get two lines. The
      // line is the opener plus the letter card, capped at the storage budget
      // so an oversized capsule cannot break the chat contract.
      line: buildCapsuleChatLine(deps.capsule, deps.delivery),
    }),
    planLegacyChatLine: () => buildCapsuleChatLine(deps.capsule, deps.delivery),
    onDelivered: () => deps.markDelivered(deps.capsule.id),
    isStopped: deps.isStopped,
    runLegacy: () => deliverLegacy(deps, message),
  })
}

/**
 * Pre-M1.1 surfacing: the single OS notification, without bookkeeping.
 *
 * The mark and the chat line belong to the shared pipeline, which runs them
 * after this resolves so a throwing notification leaves the capsule pending
 * with no half-delivery.
 *
 * The notification carries the message's existing `publicCopy` (routing title
 * and opener) only. The letter is bound for the chat card and the inbox; a lock
 * screen is not the place for it. Reusing the already-built message keeps the
 * public copy in one place instead of recomputing it here.
 */
async function deliverLegacy(
  deps: DeliverDueCapsuleDeps,
  message: CapsuleProactiveMessage,
): Promise<void> {
  const copy = message.publicCopy ?? {
    title: deps.delivery.notificationTitle,
    body: deps.delivery.opener,
  }
  await deps.showNotification?.({
    title: copy.title,
    body: copy.body,
  })
}
