import type { TranslationDictionary } from '../../../types/i18n.ts'

/** zh-TW messages — namespace `settings-history`. */
export const zhTWSettingsHistory = {
  'settings.history.message_count': '當前訊息數',
  'settings.history.current_status': '當前狀態',
  'settings.history.replying': '回覆處理中',
  'settings.history.idle': '待機',
  'settings.history.hint': '匯出為 JSON；匯入會覆蓋當前記錄；清空不可撤銷。',
  'settings.history.exporting': '匯出中...',
  'settings.history.export': '匯出聊天 JSON',
  'settings.history.importing': '匯入中...',
  'settings.history.import': '匯入聊天 JSON',
  'settings.history.clearing': '清空中...',
  'settings.history.clear': '清空當前聊天',
  'settings.history.archived_title': '歷史會話',
  'settings.history.archived_note': '每次啟動 Nexus 會開啟新的對話面板，歷史對話保留在此——點擊展開查看。',
  'settings.history.archived_empty': '暫無歷史會話',
  'settings.history.untitled_session': '（未命名會話）',
  'settings.history.message_count_suffix': '則',
  'settings.history.expand': '展開',
  'settings.history.collapse': '收起',
  'settings.history.delete': '刪除',
  'settings.history.delete_confirm': '確認刪除這段歷史會話嗎？',
  'settings.history.empty_messages': '（此會話沒有訊息）',
  'settings.history.role.user': '你',
  'settings.history.role.assistant': '夥伴',
} as const satisfies Partial<TranslationDictionary>
