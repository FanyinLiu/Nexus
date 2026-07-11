import { getNotificationCardPrimaryActions, type NotificationCardPrimaryActionId } from '../../features/notifications/notificationCardActions'
import { shorten } from '../../lib'
import type { NotificationMessage, TranslationKey, TranslationParams } from '../../types'

type Translate = (key: TranslationKey, params?: TranslationParams) => string

type PanelNotificationSummaryProps = {
  canReplyToNotification: (message: NotificationMessage) => boolean
  getNotificationSourceLabel: (message: NotificationMessage) => string
  messages: NotificationMessage[]
  onClearNotifications: () => Promise<void> | void
  onMarkAllRead: () => Promise<void> | void
  onMarkNotificationRead: (messageId: string) => void
  onNotificationPrimaryAction: (actionId: NotificationCardPrimaryActionId, message: NotificationMessage) => void
  onReplyToNotification: (message: NotificationMessage) => void
  totalMessageCount: number
  translate: Translate
}

function getNotificationSummary(message: NotificationMessage, fallback: string): string {
  const rawSummary = message.summary || message.body || ''
  return shorten(rawSummary || fallback, 120)
}

function formatNotificationPriority(message: NotificationMessage): string {
  if (message.importance === 'critical' || message.isImportant) return '!!!'
  if (message.importance === 'high') return '!!'
  return ''
}

function formatNotificationTime(timestamp: string): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.valueOf())) return ''
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getNotificationTitle(message: { sender?: string; channelName: string; title: string }): string {
  if (message.sender) {
    return `${message.sender} · ${message.title}`
  }

  return message.title || message.channelName
}

export function PanelNotificationSummary({
  canReplyToNotification,
  getNotificationSourceLabel,
  messages,
  onClearNotifications,
  onMarkAllRead,
  onMarkNotificationRead,
  onNotificationPrimaryAction,
  onReplyToNotification,
  totalMessageCount,
  translate,
}: PanelNotificationSummaryProps) {
  const hasUnreadNotifications = messages.length > 0

  return (
    <section className="panel-notification-summary" aria-live="polite">
      <div className="panel-notification-summary__header">
        <div>
          <p className="panel-notification-summary__title">
            {translate('panel.notification.title')}
          </p>
          <p className="panel-notification-summary__hint">
            {hasUnreadNotifications
              ? translate('panel.notification.unread_count', { count: messages.length })
              : translate('panel.notification.none')}
          </p>
        </div>
        <div className="panel-notification-summary__actions">
          <button
            className="ghost-button"
            type="button"
            onClick={() => void onMarkAllRead()}
            disabled={!hasUnreadNotifications}
          >
            {translate('panel.notification.mark_all_read')}
          </button>
          <button
            className="ghost-button"
            type="button"
            onClick={() => void onClearNotifications()}
            disabled={!totalMessageCount}
          >
            {translate('panel.notification.clear')}
          </button>
        </div>
      </div>

      {hasUnreadNotifications ? (
        <ul className="panel-notification-summary__list">
          {messages.map((message) => (
            <li key={message.id} className="panel-notification-summary__item">
              <p className="panel-notification-summary__item-title">
                <span className="panel-notification-summary__item-priority">{formatNotificationPriority(message)}</span>
                <strong>{getNotificationTitle(message)}</strong>
                <small>{formatNotificationTime(message.receivedAt)}</small>
              </p>
              <p className="panel-notification-summary__item-body">
                {getNotificationSummary(message, translate('panel.notification.no_preview'))}
              </p>
              <div className="panel-notification-summary__item-actions">
                {getNotificationCardPrimaryActions(message).map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    className="ghost-button ghost-button--compact"
                    onClick={() => onNotificationPrimaryAction(action.id, message)}
                    title={action.titleKey ? translate(action.titleKey, { source: getNotificationSourceLabel(message) }) : undefined}
                  >
                    {translate(action.labelKey)}
                  </button>
                ))}
                {canReplyToNotification(message) ? (
                  <button
                    type="button"
                    className="ghost-button ghost-button--compact"
                    onClick={() => onReplyToNotification(message)}
                  >
                    {translate('panel.notification.reply')}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="ghost-button ghost-button--compact"
                  onClick={() => onMarkNotificationRead(message.id)}
                >
                  {translate('panel.notification.mark_read')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="panel-notification-summary__empty">{translate('panel.notification.summary_empty')}</p>
      )}
    </section>
  )
}
