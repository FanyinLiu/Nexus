import type { AppSettings } from '../../types'

type NotificationBridgeSettings = Pick<AppSettings, 'autonomyNotificationsEnabled'>

export function isNotificationBridgeEnabled(settings: NotificationBridgeSettings): boolean {
  return settings.autonomyNotificationsEnabled
}
