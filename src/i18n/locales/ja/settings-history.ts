import type { TranslationDictionary } from '../../../types/i18n.ts'

/** ja messages — namespace `settings-history`. */
export const jaSettingsHistory = {
  'settings.history.message_count': 'メッセージ数',
  'settings.history.current_status': '現在の状態',
  'settings.history.replying': '返信中...',
  'settings.history.idle': '待機中',
  'settings.history.hint': 'JSON でエクスポート。インポートは現在のチャットを上書きします。クリアは取り消せません。',
  'settings.history.exporting': 'エクスポート中...',
  'settings.history.export': 'チャット JSON をエクスポート',
  'settings.history.importing': 'インポート中...',
  'settings.history.import': 'チャット JSON をインポート',
  'settings.history.clearing': 'クリア中...',
  'settings.history.clear': '現在のチャットをクリア',
  'settings.history.archived_title': '過去の会話',
  'settings.history.archived_note': '起動ごとに新しいチャットパネルが始まり、過去の会話はここに残ります。開いて確認できます。',
  'settings.history.archived_empty': '過去の会話はまだありません',
  'settings.history.untitled_session': '（タイトルなしの会話）',
  'settings.history.message_count_suffix': '件',
  'settings.history.expand': '開く',
  'settings.history.collapse': '閉じる',
  'settings.history.delete': '削除',
  'settings.history.delete_confirm': 'この過去の会話を削除しますか？',
  'settings.history.empty_messages': '（この会話にはメッセージがありません）',
  'settings.history.role.user': 'あなた',
  'settings.history.role.assistant': 'パートナー',
} as const satisfies Partial<TranslationDictionary>
