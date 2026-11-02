/**
 * Pure open-arc delivery helpers for the proactive router (M1.1).
 *
 * The scheduler only gathers signals; the message, the post-routing
 * presentation plan and the delivery orchestration live here so they can be
 * tested without React or Electron. An arc check-in is a companionship line
 * with a single "open" action, so it counts in the badge and, under active
 * focus, may take the strip outlet exactly as the router decides.
 */

import {
  PROACTIVE_BODY_MAX_LENGTH,
  PROACTIVE_FULL_BODY_MAX_LENGTH,
  PROACTIVE_TITLE_MAX_LENGTH,
} from '../../../shared/proactiveDelivery.js'
import type {
  DeliveryContext,
  DeliveryDecision,
  ProactiveAction,
  ProactiveDeliveryPreferences,
  ProactiveMessage as SharedProactiveMessage,
} from '../../../shared/proactiveDelivery.js'
import { clipText } from '../reminders/proactiveMessage.ts'
import { deliverThroughRouter } from '../proactive/routedDelivery.ts'
import type { DeliverThroughRouterResult } from '../proactive/routedDelivery.ts'
import type { OpenArcRecord } from './openArcStore.ts'

/** The actions an open-arc check-in offers; the single place to change them. */
export const OPEN_ARC_ACTIONS: readonly ProactiveAction[] = Object.freeze(['open'])

/**
 * An arc message with its `kind` and `origin` narrowed for the renderer
 * bridge. The milestone is already part of the message id, so the origin only
 * names the arc and the shared wire type stays unchanged.
 */
export type OpenArcProactiveMessage = Omit<SharedProactiveMessage, 'kind' | 'origin'> & {
  kind: 'open_arc'
  origin: { arcId: string }
}

/** The legacy OS-notification payload the scheduler used before M1.1. */
export interface OpenArcDeliveryText {
  title: string
  body: string
}

/**
 * The inbox id for one arc milestone.
 *
 * Milestone day is part of the key so day 3 and day 5 are separate entries,
 * while a repeated delivery of the same milestone updates its entry in place.
 */
export function openArcMessageId(arcId: string, milestoneDay: number): string {
  return `open_arc:${arcId}:${milestoneDay}`
}

/** Build the router message for one due arc milestone. */
export function buildOpenArcProactiveMessage(
  arc: OpenArcRecord,
  payload: OpenArcDeliveryText,
  milestoneDay: number,
  now: number,
): OpenArcProactiveMessage {
  const body = clipText(payload.body, PROACTIVE_BODY_MAX_LENGTH)
  // A clipped or whitespace-collapsed body keeps the original copy for the
  // inbox's expanded view; an unchanged body must not duplicate the payload.
  const fullBody = body !== payload.body
    ? payload.body.slice(0, PROACTIVE_FULL_BODY_MAX_LENGTH)
    : undefined
  return {
    id: openArcMessageId(arc.id, milestoneDay),
    source: 'open_arc',
    kind: 'open_arc',
    priority: 'normal',
    actions: [...OPEN_ARC_ACTIONS],
    title: clipText(payload.title, PROACTIVE_TITLE_MAX_LENGTH),
    body,
    ...(fullBody !== undefined ? { fullBody } : {}),
    createdAt: now,
    origin: { arcId: arc.id },
  }
}

/** The renderer-side surfaces an arc check-in still owns after main routes it. */
export interface OpenArcPresentationPlan {
  /**
   * Rule 2 (panel focused) has no panel outlet in main, so the chat line is
   * its panel surface. Rule 3 goes to the strip outlet in main; the renderer
   * must not duplicate it as a bubble.
   */
  chatLine: boolean
}

/** Map a routing decision to the renderer's own open-arc surfaces. */
export function planOpenArcPresentation(
  decision: Pick<DeliveryDecision, 'rule'>,
): OpenArcPresentationPlan {
  return { chatLine: decision.rule === 2 }
}

/** Bridge function shape for the router call. */
export type OpenArcDeliverBridge = (payload: {
  message: OpenArcProactiveMessage
  context: DeliveryContext
  preferences: ProactiveDeliveryPreferences
}) => Promise<DeliveryDecision>

/** Bridge function shape for the legacy OS notification. */
export type OpenArcNotificationBridge = (payload: OpenArcDeliveryText) => Promise<unknown>

export interface DeliverDueOpenArcDeps {
  arc: OpenArcRecord
  delivery: OpenArcDeliveryText
  milestoneDay: number
  now: number
  /** One-version rollback: when true the pre-M1.1 notification path runs. */
  useLegacyPath: boolean
  deliver?: OpenArcDeliverBridge
  showNotification?: OpenArcNotificationBridge
  buildContext: () => Promise<DeliveryContext> | DeliveryContext
  preferences: ProactiveDeliveryPreferences
  pushChatLine?: (text: string) => Promise<void>
  recordCheckInFired: (id: string) => void
  isStopped: () => boolean
}

export type DeliverDueOpenArcResult = DeliverThroughRouterResult

/**
 * Deliver one due arc check-in through the router, or fall back to the legacy
 * notification when the router is unavailable.
 *
 * The inbox stores the message on success, so an inbox-only rule still counts
 * as delivered. A failed router call is retried once as the old OS toast so
 * the milestone is never lost to a bridge error.
 */
export async function deliverDueOpenArc(
  deps: DeliverDueOpenArcDeps,
): Promise<DeliverDueOpenArcResult> {
  return deliverThroughRouter<OpenArcProactiveMessage>({
    buildMessage: () => buildOpenArcProactiveMessage(
      deps.arc,
      deps.delivery,
      deps.milestoneDay,
      deps.now,
    ),
    useLegacyPath: deps.useLegacyPath,
    deliver: deps.deliver,
    buildContext: deps.buildContext,
    preferences: deps.preferences,
    ...(deps.pushChatLine ? { pushChatLine: deps.pushChatLine } : {}),
    planChatLine: (decision) => ({
      chatLine: planOpenArcPresentation(decision).chatLine,
      // The arc body is not clipped for the chat line; it uses the original
      // delivery body rather than the router message's clipped copy.
      text: deps.delivery.body,
    }),
    onDelivered: () => deps.recordCheckInFired(deps.arc.id),
    isStopped: deps.isStopped,
    runLegacy: () => deliverLegacy(deps),
  })
}

/** Pre-M1.1 surfacing: the single OS notification, without bookkeeping. */
async function deliverLegacy(deps: DeliverDueOpenArcDeps): Promise<void> {
  await deps.showNotification?.(deps.delivery)
}
