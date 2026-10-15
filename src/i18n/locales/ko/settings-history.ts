import type { TranslationDictionary } from '../../../types/i18n.ts'

/** ko messages — namespace `settings-history`. */
export const koSettingsHistory = {
  'settings.history.message_count': '메시지 수',
  'settings.history.current_status': '현재 상태',
  'settings.history.replying': '답장 중...',
  'settings.history.idle': '대기 중',
  'settings.history.hint': 'JSON으로 내보내기. 가져오기는 현재 채팅을 덮어씁니다. 지우기는 되돌릴 수 없습니다.',
  'settings.history.exporting': '내보내는 중...',
  'settings.history.export': '채팅 JSON 내보내기',
  'settings.history.importing': '가져오는 중...',
  'settings.history.import': '채팅 JSON 가져오기',
  'settings.history.clearing': '지우는 중...',
  'settings.history.clear': '현재 채팅 지우기',
  'settings.history.archived_title': '지난 대화',
  'settings.history.archived_note': 'Nexus 를 실행할 때마다 새 채팅 패널이 열리고, 이전 대화는 여기에 보관됩니다. 열어서 확인할 수 있습니다.',
  'settings.history.archived_empty': '아직 보관된 대화가 없습니다',
  'settings.history.untitled_session': '(제목 없는 대화)',
  'settings.history.message_count_suffix': '건',
  'settings.history.expand': '펼치기',
  'settings.history.collapse': '접기',
  'settings.history.delete': '삭제',
  'settings.history.delete_confirm': '이 지난 대화를 삭제할까요?',
  'settings.history.empty_messages': '(이 대화에는 메시지가 없습니다)',
  'settings.history.role.user': '나',
  'settings.history.role.assistant': '동반자',
} as const satisfies Partial<TranslationDictionary>
