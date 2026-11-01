/**
 * Cross-process truth for proactive-message delivery.
 *
 * `routeDelivery` answers one question only: which surface may show this
 * message right now. It is pure — no clock, no I/O, no globals — because the
 * renderer tests the same decisions the main process makes.
 *
 * The inbox is always written by the caller and is therefore part of every
 * decision's outlet list: rules 1 and 6 make it the *only* visible outcome,
 * they never drop the message. `kind` stays a plain string here; shared/ must
 * not import src/, so the renderer narrows it to the etiquette layer's
 * ProactiveMessageKind instead of duplicating that union.
 */

/** Title budget from the message contract; the IPC schema enforces it. */
export const PROACTIVE_TITLE_MAX_LENGTH = 80

/** Body budget from the message contract; the IPC schema enforces it. */
export const PROACTIVE_BODY_MAX_LENGTH = 160

/** Every proactive source the router can carry. Order is not contractual. */
export const PROACTIVE_SOURCES = Object.freeze([
  'reminder',
  'agenda',
  'bracket',
  'letter',
  'capsule',
  'open_arc',
  'away',
  'dream',
])

/** Actions a message can offer. An empty list marks a companionship line. */
export const PROACTIVE_ACTIONS = Object.freeze(['done', 'snooze', 'open', 'reply'])

/** Priorities usable by the badge rule (`high` counts without actions). */
export const PROACTIVE_PRIORITIES = Object.freeze(['high', 'normal', 'low'])

/** Inbox statuses; the load validator and the IPC schema share this list. */
export const PROACTIVE_INBOX_STATUSES = Object.freeze(['unread', 'done', 'dismissed'])

/** @typedef {import('./proactiveDelivery.js').DeliverySurface} DeliverySurface */

/**
 * Pick the primary delivery surface for one message.
 *
 * Rules are matched top to bottom and the first match wins:
 *   1 quiet conditions (fullscreen / system DND / locked / quiet hours)
 *   2 panel focused
 *   3 active focus, actionable message, strip enabled
 *   4 any other active focus
 *   5 idle or away with away notifications enabled
 *   6 fallthrough
 *
 * A missing system-DND reading is passed as null and counts as "not muted",
 * so an unreadable signal can only ever be less restrictive, never mute the
 * app by accident.
 *
 * @param {{ actions: string[] }} message
 * @param {{
 *   panelFocused: boolean,
 *   fullscreen: boolean,
 *   focusState: 'active' | 'idle' | 'away' | 'locked',
 *   inQuietHours: boolean,
 *   systemDnd: boolean | null,
 *   awayNotificationsEnabled: boolean,
 *   stripEnabled: boolean,
 * }} context
 * @returns {{ rule: 1 | 2 | 3 | 4 | 5 | 6, outlets: DeliverySurface[] }}
 */
export function routeDelivery(message, context) {
  const actions = Array.isArray(message?.actions) ? message.actions : []
  const focusState = context?.focusState

  if (
    context?.fullscreen === true
    || context?.systemDnd === true
    || focusState === 'locked'
    || context?.inQuietHours === true
  ) {
    return { rule: 1, outlets: ['inbox', 'badge'] }
  }

  if (context?.panelFocused === true) {
    return { rule: 2, outlets: ['inbox', 'panel'] }
  }

  if (focusState === 'active' && actions.length > 0 && context?.stripEnabled === true) {
    // Actionable messages own exactly one surface: the strip replaces the
    // bubble instead of joining it, so the user never sees the same line twice.
    return { rule: 3, outlets: ['inbox', 'strip'] }
  }

  if (focusState === 'active') {
    return { rule: 4, outlets: ['inbox', 'bubble'] }
  }

  if (
    (focusState === 'idle' || focusState === 'away')
    && context?.awayNotificationsEnabled === true
  ) {
    return { rule: 5, outlets: ['inbox', 'os_notification'] }
  }

  return { rule: 6, outlets: ['inbox', 'badge'] }
}
