/**
 * Public types for the cross-process proactive delivery contract.
 * Declarations mirror the JSDoc in `proactiveDelivery.js`; the router logic
 * itself lives only in the `.js` module.
 */

export const PROACTIVE_TITLE_MAX_LENGTH: 80
export const PROACTIVE_BODY_MAX_LENGTH: 160

export type ProactiveSource =
  | 'reminder'
  | 'agenda'
  | 'bracket'
  | 'letter'
  | 'capsule'
  | 'open_arc'
  | 'away'
  | 'dream'

export type DeliverySurface = 'inbox' | 'badge' | 'panel' | 'strip' | 'bubble' | 'os_notification'

export type ProactiveAction = 'done' | 'snooze' | 'open' | 'reply'

export type ProactivePriority = 'high' | 'normal' | 'low'

export type FocusState = 'active' | 'idle' | 'away' | 'locked'

export type ProactiveInboxStatus = 'unread' | 'done' | 'dismissed'

export const PROACTIVE_SOURCES: readonly ProactiveSource[]
export const PROACTIVE_ACTIONS: readonly ProactiveAction[]
export const PROACTIVE_PRIORITIES: readonly ProactivePriority[]
export const PROACTIVE_INBOX_STATUSES: readonly ProactiveInboxStatus[]

export interface ProactiveMessage {
  /** Dedupe key: a repeated id updates the existing inbox entry in place. */
  id: string
  source: ProactiveSource
  /** Renderer narrows this to proactiveEtiquette's ProactiveMessageKind. */
  kind: string
  priority: ProactivePriority
  title: string
  body: string
  /** Spoken text; nothing is spoken when absent. */
  speech?: string
  /** Empty array marks a companionship line the red dot ignores. */
  actions: ProactiveAction[]
  createdAt: number
  /** Removed from the inbox once this instant passes. */
  expiresAt?: number
  origin?: {
    taskId?: string
    letterId?: string
    capsuleId?: string
    arcId?: string
  }
}

export interface DeliveryContext {
  panelFocused: boolean
  fullscreen: boolean
  focusState: FocusState
  inQuietHours: boolean
  /** null when the platform cannot report it; treated as false. */
  systemDnd: boolean | null
  awayNotificationsEnabled: boolean
  stripEnabled: boolean
}

export type ProactiveDeliveryRule = 1 | 2 | 3 | 4 | 5 | 6

export interface DeliveryDecision {
  rule: ProactiveDeliveryRule
  /** Always starts with `inbox`; `panel` and `os_notification` may be unregistered. */
  outlets: DeliverySurface[]
}

export interface ProactiveInboxEntry extends ProactiveMessage {
  status: ProactiveInboxStatus
  updatedAt: number
}

/** Mutable per-delivery state shared between the inbox and badge outlets. */
export interface DeliveryState {
  unreadCount: number
  entries: ProactiveInboxEntry[]
  removedIds: string[]
  changed: boolean
  published: boolean
}

export interface ProactiveInboxSnapshot {
  /** Newest first by createdAt, at most 100 entries. */
  entries: ProactiveInboxEntry[]
  unreadCount: number
  /** Ids removed by read-time pruning; empty when nothing aged out. */
  removedIds: string[]
}

export interface ProactiveInboxChangeItem {
  id: string
  status: ProactiveInboxStatus
}

/**
 * Main -> renderer metadata push. Deliberately carries no title, body or
 * speech; a window that needs the content reads it through `inbox:list`.
 */
export interface ProactiveInboxChange {
  unreadCount: number
  /** Only the entries whose status changed in this mutation. */
  changes: ProactiveInboxChangeItem[]
  removedIds: string[]
}

export interface ProactiveInboxUpdateResult {
  updated: boolean
  unreadCount: number
}

export interface ProactiveDeliveryPayload {
  message: ProactiveMessage
  context: DeliveryContext
}

export interface ProactivePresentation {
  outlet: DeliverySurface
  message: ProactiveMessage
}

export function routeDelivery(
  message: Pick<ProactiveMessage, 'actions'>,
  context: DeliveryContext,
): DeliveryDecision
