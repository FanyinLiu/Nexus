import type { NotificationMessage, TranslationKey } from '../../types'

export type NotificationCardPrimaryActionId = 'draft_reply' | 'mark_important' | 'snooze_later'

export type NotificationCardPrimaryAction = {
  id: NotificationCardPrimaryActionId
  labelKey: TranslationKey
  titleKey?: TranslationKey
}

export function getNotificationCardPrimaryActions(
  message: Pick<NotificationMessage, 'isImportant'>,
): NotificationCardPrimaryAction[] {
  return [
    {
      id: 'draft_reply',
      labelKey: 'panel.notification.action.draft_reply',
      titleKey: 'panel.notification.draft_reply',
    },
    {
      id: 'mark_important',
      labelKey: message.isImportant
        ? 'panel.notification.action.unmark_important'
        : 'panel.notification.action.mark_important',
    },
    {
      id: 'snooze_later',
      labelKey: 'panel.notification.action.snooze_later',
      titleKey: 'panel.notification.snooze_30m',
    },
  ]
}
