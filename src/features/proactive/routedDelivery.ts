/**
 * Generic orchestration for one proactive source delivery (M1.1).
 *
 * Every source follows the same pipeline: legacy rollback or a router call, a
 * legacy retry when the bridge fails, an optional rule-2 chat line for the
 * renderer's own panel surface, and a "delivered" bookkeeping step. Sources
 * differ only in the message they build and the text they surface; keeping the
 * pipeline in one place means a new source cannot quietly skip the inbox
 * fallback or re-deliver after a chat push failed.
 */

import type {
  DeliveryContext,
  DeliveryDecision,
  ProactiveDeliveryPreferences,
} from '../../../shared/proactiveDelivery.js'

/** Any message this pipeline can carry; the body feeds the rule-2 chat line. */
export interface RoutedMessage {
  body: string
}

/** Bridge function shape for the router call. */
export type RoutedDeliverBridge<TMessage extends RoutedMessage> = (payload: {
  message: TMessage
  context: DeliveryContext
  preferences: ProactiveDeliveryPreferences
}) => Promise<DeliveryDecision>

/** What the renderer still renders itself after main routes the message. */
export interface RoutedChatLinePlan<TLine> {
  chatLine: boolean
  /**
   * The source's own payload for the chat line. It is deliberately supplied by
   * the caller: a source may want the unclipped delivery copy rather than the
   * message body that main validates, and a source may carry structured data
   * beside the text.
   */
  line: TLine
}

export interface DeliverThroughRouterDeps<TMessage extends RoutedMessage, TLine = string> {
  /** Build the router message for this delivery. */
  buildMessage: () => TMessage
  /** One-version rollback: when true the pre-M1.1 path runs. */
  useLegacyPath: boolean
  deliver?: RoutedDeliverBridge<TMessage>
  buildContext: () => Promise<DeliveryContext> | DeliveryContext
  preferences: ProactiveDeliveryPreferences
  pushChatLine?: (line: TLine) => Promise<void>
  planChatLine: (decision: DeliveryDecision) => RoutedChatLinePlan<TLine>
  /**
   * Optional chat line for the legacy and fallback paths. Sources that leave
   * this unset keep the pre-M1.1 behaviour of surfacing without a chat line.
   */
  planLegacyChatLine?: () => TLine | null
  /**
   * Settle delivery exactly once, immediately after the router accepts the
   * message or the legacy surface resolves. It must not depend on the
   * scheduler still being live: the user already received the message.
   */
  onDelivered: () => void
  isStopped: () => boolean
  /**
   * Pre-router surfacing only. `onDelivered` runs after it resolves, so a
   * throwing notification propagates before the mark and a total failure
   * stays retryable.
   */
  runLegacy: () => Promise<void>
}

export interface DeliverThroughRouterResult {
  path: 'legacy' | 'router' | 'fallback'
  rule?: DeliveryDecision['rule']
}

/**
 * Deliver one message through the router, or fall back to the legacy path when
 * the router is unavailable.
 *
 * A failed router call is retried once as the legacy surface so the user never
 * loses a message to a bridge error. The inbox write happens inside the main
 * process, so an inbox-only rule still counts as delivered.
 *
 * Success is settled before any chat push: once the router or the fallback
 * resolves, `onDelivered` runs even when the scheduler stopped in the
 * meantime. The chat push runs afterwards and may still fail; that error
 * reaches the caller's log instead of re-delivering on every tick.
 */
export async function deliverThroughRouter<TMessage extends RoutedMessage, TLine = string>(
  deps: DeliverThroughRouterDeps<TMessage, TLine>,
): Promise<DeliverThroughRouterResult> {
  if (deps.useLegacyPath || !deps.deliver) {
    await deps.runLegacy()
    deps.onDelivered()
    await pushLegacyChatLine(deps)
    return { path: 'legacy' }
  }

  const message = deps.buildMessage()
  let decision: DeliveryDecision
  try {
    const context = await deps.buildContext()
    decision = await deps.deliver({ message, context, preferences: deps.preferences })
  } catch {
    // A throwing legacy surface propagates before onDelivered, so a total
    // bridge failure stays retryable instead of silently consuming the message.
    await deps.runLegacy()
    deps.onDelivered()
    await pushLegacyChatLine(deps)
    return { path: 'fallback' }
  }

  deps.onDelivered()
  const chatLine = deps.planChatLine(decision)
  if (chatLine.chatLine && deps.pushChatLine && !deps.isStopped()) {
    await deps.pushChatLine(chatLine.line)
  }
  return { path: 'router', rule: decision.rule }
}

/**
 * Optional chat line after the legacy or fallback surface resolved.
 *
 * A source that plans none keeps the previous pipeline exactly. When it does,
 * the line follows the same rules as a routed one: the delivery is already
 * settled, and a stopped scheduler drops the line instead of the message.
 */
async function pushLegacyChatLine<TMessage extends RoutedMessage, TLine>(
  deps: DeliverThroughRouterDeps<TMessage, TLine>,
): Promise<void> {
  if (!deps.planLegacyChatLine || !deps.pushChatLine || deps.isStopped()) return
  const line = deps.planLegacyChatLine()
  if (line !== null) await deps.pushChatLine(line)
}
