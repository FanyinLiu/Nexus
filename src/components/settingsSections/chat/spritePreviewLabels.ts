import type { SpritePetAnimationState } from '../../../features/pet'
import type { AppSettings } from '../../../types'

const SPRITE_PREVIEW_STATE_LABELS: Record<SpritePetAnimationState, Record<AppSettings['uiLanguage'], string>> = {
  idle: {
    'zh-CN': '待机',
    'zh-TW': '待機',
    'en-US': 'Idle',
    ja: '待機',
    ko: '대기',
  },
  'running-right': {
    'zh-CN': '向右跑',
    'zh-TW': '向右跑',
    'en-US': 'Run right',
    ja: '右走行',
    ko: '오른쪽',
  },
  'running-left': {
    'zh-CN': '向左跑',
    'zh-TW': '向左跑',
    'en-US': 'Run left',
    ja: '左走行',
    ko: '왼쪽',
  },
  waving: {
    'zh-CN': '招手',
    'zh-TW': '揮手',
    'en-US': 'Wave',
    ja: '手振り',
    ko: '인사',
  },
  jumping: {
    'zh-CN': '跳跃',
    'zh-TW': '跳躍',
    'en-US': 'Jump',
    ja: 'ジャンプ',
    ko: '점프',
  },
  failed: {
    'zh-CN': '失败',
    'zh-TW': '失敗',
    'en-US': 'Failed',
    ja: '失敗',
    ko: '실패',
  },
  waiting: {
    'zh-CN': '等待',
    'zh-TW': '等待',
    'en-US': 'Wait',
    ja: '待機中',
    ko: '기다림',
  },
  running: {
    'zh-CN': '跑动',
    'zh-TW': '跑動',
    'en-US': 'Run',
    ja: '走行',
    ko: '달리기',
  },
  review: {
    'zh-CN': '复查',
    'zh-TW': '檢視',
    'en-US': 'Review',
    ja: '確認',
    ko: '검토',
  },
}

export function getSpritePreviewStateLabel(state: SpritePetAnimationState, uiLanguage: AppSettings['uiLanguage']) {
  return SPRITE_PREVIEW_STATE_LABELS[state][uiLanguage]
}
