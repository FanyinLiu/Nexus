import type { NotificationMessage, TranslationKey } from '../../types'

export type NotificationCardPrimaryActionId = 'draft_reply' | 'mark_important' | 'snooze_later'

export type NotificationCardPrimaryAction = {
  id: NotificationCardPrimaryActionId
  labelKey: TranslationKey
  titleKey?: TranslationKey
}

/**
 * Overflow actions. Reply and mark-read stay on the card; drafting a reply
 * happens inside the reply composer, so it is not a separate button.
 */
export function getNotificationCardPrimaryActions(
  message: Pick<NotificationMessage, 'isImportant'>,
): NotificationCardPrimaryAction[] {
  return [
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
