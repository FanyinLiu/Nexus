import { getNotificationCardPrimaryActions, type NotificationCardPrimaryActionId } from '../../features/notifications/notificationCardActions.ts'
import { getNotificationCardBadge } from '../../features/notifications/notificationCardSession.ts'
import { formatLocaleClockTime } from '../../lib/localDate.ts'
import type { NotificationMessage, TranslationKey, TranslationParams } from '../../types'

type Translate = (key: TranslationKey, params?: TranslationParams) => string

type PanelNotificationSummaryProps = {
  canReplyToNotification: (message: NotificationMessage) => boolean
  getNotificationSourceLabel: (message: NotificationMessage) => string
  locale: string
  messages: NotificationMessage[]
  onClearNotifications: () => Promise<void> | void
  onMarkAllRead: () => Promise<void> | void
  onMarkNotificationRead: (messageId: string) => void
  onNotificationPrimaryAction: (actionId: NotificationCardPrimaryActionId, message: NotificationMessage) => void
  onReplyToNotification: (message: NotificationMessage) => void
  totalMessageCount: number
  translate: Translate
}

function isNotificationMarked(message: NotificationMessage): boolean {
  return Boolean(message.isImportant)
    || message.importance === 'critical'
    || message.importance === 'high'
}

function getNotificationTitle(message: { sender?: string; channelName: string; title: string }): string {
  if (message.sender) {
    return `${message.sender} · ${message.title}`
  }

  return message.title || message.channelName
}

function NotificationCardMark({ message }: { message: NotificationMessage }) {
  const badge = getNotificationCardBadge(message)
  if (badge.kind === 'telegram') {
    return (
      <span className="panel-notification-summary__avatar" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false">
          <path fill="currentColor" d="M20.7 4.3 3.4 11c-.8.3-.8 1.4.1 1.6l4.4 1.4 1.7 5.2c.3.8 1.3.9 1.8.2l2.4-3.1 4.5 3.3c.6.5 1.6.1 1.7-.7l2.2-13.2c.2-.9-.7-1.7-1.5-1.4Zm-11.5 9.3 8.8-5.4c.2-.1.4.2.2.3l-7.3 6.6-.3 3.2-1.4-4.7Z" />
        </svg>
      </span>
    )
  }
  if (badge.kind === 'discord') {
    return (
      <span className="panel-notification-summary__avatar" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false">
          <path fill="currentColor" d="M12 4.8c2.3 0 4.4.4 5.8 1.2.4.2.6.6.6 1 .2 1.7.3 3.3 0 4.8-.2.9-.8 1.6-1.6 2l.7 1.8c.2.4-.3.8-.7.5l-2-1.1c-.8.2-1.8.4-2.8.4s-2-.2-2.8-.4l-2 1.1c-.4.3-.9-.1-.7-.5l.7-1.8c-.8-.4-1.4-1.1-1.6-2-.3-1.5-.2-3.1 0-4.8 0-.4.2-.8.6-1C7.6 5.2 9.7 4.8 12 4.8Zm-2.2 3.6a1.35 1.35 0 1 0 0 2.7 1.35 1.35 0 0 0 0-2.7Zm4.4 0a1.35 1.35 0 1 0 0 2.7 1.35 1.35 0 0 0 0-2.7Z" />
        </svg>
      </span>
    )
  }
  return (
    <span className="panel-notification-summary__avatar" aria-hidden="true">{badge.letter}</span>
  )
}

export function PanelNotificationSummary({
  canReplyToNotification,
  getNotificationSourceLabel,
  locale,
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
          {messages.map((message) => {
            const preview = (message.summary || message.body || '').trim()
            const menuActions = getNotificationCardPrimaryActions(message)
            return (
              <li key={message.id} className="panel-notification-summary__item">
                <div className="panel-notification-summary__item-row">
                  <NotificationCardMark message={message} />
                  <div className="panel-notification-summary__item-copy">
                    <p className="panel-notification-summary__item-title">
                      {isNotificationMarked(message) ? (
                        <span className="panel-notification-summary__tag">{translate('panel.notification.important_tag')}</span>
                      ) : null}
                      <strong>{getNotificationTitle(message)}</strong>
                      <small>{formatLocaleClockTime(message.receivedAt, locale)}</small>
                    </p>
                    {preview ? (
                      <p className="panel-notification-summary__item-body">{preview}</p>
                    ) : null}
                  </div>
                  <div className="panel-notification-summary__item-actions">
                  {canReplyToNotification(message) ? (
                    <button
                      type="button"
                      className="ghost-button ghost-button--compact panel-notification-summary__action--primary"
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
                  <details className="panel-notification-summary__more">
                    <summary
                      className="ghost-button ghost-button--compact"
                      aria-label={translate('panel.notification.more_actions')}
                    >
                      …
                    </summary>
                    <div className="panel-notification-summary__menu">
                      {menuActions.map((action) => (
                        <button
                          key={action.id}
                          type="button"
                          className="ghost-button ghost-button--compact"
                          onClick={(event) => {
                            onNotificationPrimaryAction(action.id, message)
                            event.currentTarget.closest('details')?.removeAttribute('open')
                          }}
                          title={action.titleKey ? translate(action.titleKey, { source: getNotificationSourceLabel(message) }) : undefined}
                        >
                          {translate(action.labelKey)}
                        </button>
                      ))}
                    </div>
                  </details>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="panel-notification-summary__empty">{translate('panel.notification.summary_empty')}</p>
      )}
    </section>
  )
}
