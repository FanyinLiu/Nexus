import type { AppSettings } from '../../types'

type NotificationBridgeSettings = Pick<AppSettings, 'autonomyNotificationsEnabled'>

export function isNotificationBridgeEnabled(settings: NotificationBridgeSettings): boolean {
  return settings.autonomyNotificationsEnabled
}

/**
 * The pet window owns bridge subscriptions, but `notification:start` is a
 * panel capability. The panel has to arm the webhook or live messages never
 * arrive. The pet must not also stop that session when it is the owner.
 */
export function shouldPanelArmNotificationBridge(runtimeOwner: boolean, enabled: boolean): boolean {
  return !runtimeOwner && enabled
}
