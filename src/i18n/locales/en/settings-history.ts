import type { TranslationDictionary } from '../../../types/i18n.ts'

/** en messages — namespace `settings-history`. */
export const enSettingsHistory = {
  'settings.history.message_count': 'Message count',
  'settings.history.current_status': 'Current status',
  'settings.history.replying': 'Replying...',
  'settings.history.idle': 'Idle',
  'settings.history.hint': 'Export as JSON; import overwrites current chat; clear is irreversible.',
  'settings.history.exporting': 'Exporting...',
  'settings.history.export': 'Export chat JSON',
  'settings.history.importing': 'Importing...',
  'settings.history.import': 'Import chat JSON',
  'settings.history.clearing': 'Clearing...',
  'settings.history.clear': 'Clear current chat',
  'settings.history.archived_title': 'Archived sessions',
  'settings.history.archived_note': 'Each launch starts a fresh chat panel; past conversations are kept here — expand one to review.',
  'settings.history.archived_empty': 'No archived sessions yet',
  'settings.history.untitled_session': '(Untitled session)',
  'settings.history.message_count_suffix': 'msgs',
  'settings.history.expand': 'Expand',
  'settings.history.collapse': 'Collapse',
  'settings.history.delete': 'Delete',
  'settings.history.delete_confirm': 'Delete this archived session?',
  'settings.history.empty_messages': '(No messages in this session)',
  'settings.history.role.user': 'You',
  'settings.history.role.assistant': 'Companion',
} as const satisfies Partial<TranslationDictionary>
