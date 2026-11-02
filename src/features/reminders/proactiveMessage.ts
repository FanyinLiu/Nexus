/**
 * Pure reminder-to-proactive-message helpers.
 *
 * A `notice` reminder is the first source switched to the unified delivery
 * router (design 4.4). The controller only gathers signals; the message, the
 * delivery context and the post-routing presentation plan are built here so
 * they can be tested without React or Electron.
 */

import {
  PROACTIVE_BODY_MAX_LENGTH,
  PROACTIVE_STRIP_ENABLED,
  PROACTIVE_TITLE_MAX_LENGTH,
} from '../../../shared/proactiveDelivery.js'
import type {
  DeliveryContext,
  DeliveryDecision,
  FocusState,
  ProactiveAction,
  ProactiveDeliveryPreferences,
  ProactiveMessage as SharedProactiveMessage,
} from '../../../shared/proactiveDelivery.js'
import { isQuietHour, isLikelyFullscreenSurface } from '../autonomy/proactiveBudget.ts'
import type { ProactiveMessageKind } from '../autonomy/proactiveEtiquette.ts'
import type { AppSettings, DesktopContextSnapshot, ReminderTask } from '../../types/index.ts'

/** A reminder message whose `kind` is already narrowed for the renderer bridge. */
export type ReminderProactiveMessage = Omit<SharedProactiveMessage, 'kind'> & {
  kind: ProactiveMessageKind
}

const REMINDER_ACTIONS: readonly ProactiveAction[] = Object.freeze([
  'done',
  'snooze',
  'open',
])

/**
 * Collapse whitespace and clip to a contract budget. A clipped value ends with
 * an ellipsis so the truncation stays visible instead of silently changing the
 * wording. Shared by every source that maps onto the 80/160 message contract.
 */
export function clipText(value: string, maxLength: number): string {
  const singleLine = value.replace(/\s+/g, ' ').trim()
  if (singleLine.length <= maxLength) return singleLine
  return `${singleLine.slice(0, maxLength - 1)}…`
}

/**
 * Build the router message for one reminder firing.
 *
 * `now` is part of the id so every firing creates its own inbox entry, while a
 * repeated delivery of the same firing updates that entry in place. Reminders
 * are high priority because they are must-deliver and must count in the badge.
 */
export function buildReminderProactiveMessage(
  task: Pick<ReminderTask, 'id' | 'title'>,
  options: { displayText: string; speech: string; now: number },
): ReminderProactiveMessage {
  const speech = options.speech.trim()
  return {
    id: `reminder:${task.id}:${options.now}`,
    source: 'reminder',
    kind: 'reminder_follow_up',
    priority: 'high',
    title: clipText(task.title, PROACTIVE_TITLE_MAX_LENGTH),
    body: clipText(options.displayText, PROACTIVE_BODY_MAX_LENGTH),
    ...(speech ? { speech } : {}),
    actions: [...REMINDER_ACTIONS],
    createdAt: options.now,
    origin: { taskId: task.id },
  }
}

/** The renderer-side signals the context builder needs; all already exist. */
export type ReminderContextSignals = {
  focusState: FocusState
  activeWindowTitle?: string | null
  activeWindowAppName?: string | null
  quietStart: number
  quietEnd: number
  awayNotificationsEnabled: boolean
  now: number
}

/**
 * Build the `DeliveryContext` for a reminder.
 *
 * `panelFocused` stays false here: the pet window cannot see the panel, so the
 * main-process deliver handler ORs in that signal. `systemDnd` is null until
 * M1.1 adds platform detection, which the router treats as "not muted".
 */
export function buildReminderDeliveryContext(
  signals: ReminderContextSignals,
): DeliveryContext {
  const hour = new Date(signals.now).getHours()
  return {
    panelFocused: false,
    fullscreen: isLikelyFullscreenSurfaceFromSignals(signals),
    focusState: signals.focusState,
    inQuietHours: isQuietHour(hour, signals.quietStart, signals.quietEnd),
    systemDnd: null,
    awayNotificationsEnabled: signals.awayNotificationsEnabled,
    stripEnabled: PROACTIVE_STRIP_ENABLED,
  }
}

function isLikelyFullscreenSurfaceFromSignals(signals: ReminderContextSignals): boolean {
  return isLikelyFullscreenSurface(signals.activeWindowTitle, signals.activeWindowAppName)
}

/**
 * Read the active-window snapshot only when the user's settings allow desktop
 * awareness. Anything unreadable counts as "not fullscreen": a proactive
 * message must still be delivered when context collection is unavailable.
 */
export async function readProactiveDesktopContext(
  settings: AppSettings,
): Promise<DesktopContextSnapshot | null> {
  if (
    !settings.contextAwarenessEnabled
    || !settings.activeWindowContextEnabled
    || settings.companionAwarenessPaused
  ) {
    return null
  }
  try {
    return await window.desktopPet?.getDesktopContext?.({ includeActiveWindow: true }) ?? null
  } catch {
    // Best-effort only: a failed read relaxes routing, it never blocks delivery.
    return null
  }
}

/** The settings subset the delivery-preference snapshot needs. */
export type ReminderPreferenceSettings = Pick<
  AppSettings,
  | 'proactiveQuietHoursStart'
  | 'proactiveQuietHoursEnd'
  | 'contextAwarenessEnabled'
  | 'activeWindowContextEnabled'
  | 'companionAwarenessPaused'
  | 'proactiveAwayNotificationsEnabled'
>

/**
 * Snapshot the delivery preferences main keeps for a snooze re-route.
 *
 * Desktop awareness mirrors `readProactiveDesktopContext`: when it is off or
 * paused the active-window snapshot is not read, so fullscreen must stay false.
 */
export function buildReminderDeliveryPreferences(
  settings: ReminderPreferenceSettings,
): ProactiveDeliveryPreferences {
  return {
    quietStart: settings.proactiveQuietHoursStart,
    quietEnd: settings.proactiveQuietHoursEnd,
    desktopAwarenessAllowed: settings.contextAwarenessEnabled
      && settings.activeWindowContextEnabled
      && !settings.companionAwarenessPaused,
    awayNotificationsEnabled: settings.proactiveAwayNotificationsEnabled,
  }
}

/** What the reminder controller still does itself after the main process routes. */
export interface ReminderPresentationPlan {
  /** The chat history line is kept in every situation. */
  chatLine: boolean
  /** The controller bubble stays off; rule 4's bubble comes from the router outlet. */
  bubble: boolean
  speech: boolean
}

/**
 * Map a routing decision to the renderer's own surfaces.
 *
 * The strip is a main-process window, so rule 3 only speaks here. Rule 2 uses
 * the chat line as its panel surface. Os notification and inbox-only rules
 * stay quiet.
 */
export function planReminderPresentation(
  decision: Pick<DeliveryDecision, 'rule'>,
): ReminderPresentationPlan {
  return {
    chatLine: true,
    // Rule 4's bubble is rendered by the M0 bubble outlet through
    // `proactive:present`; the controller must not add a second one.
    bubble: false,
    speech: decision.rule === 2 || decision.rule === 3 || decision.rule === 4,
  }
}
