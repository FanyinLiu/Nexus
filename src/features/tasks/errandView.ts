import type { UiLanguage } from '../../types'

export type ErrandViewStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'delivered'

export type ErrandViewRecord = {
  status: ErrandViewStatus
}

type LocalizedText = Record<UiLanguage, string>

export const ERRAND_STATUS_ORDER: ErrandViewStatus[] = [
  'queued',
  'running',
  'completed',
  'delivered',
  'failed',
]

const STATUS_LABEL: Record<ErrandViewStatus, LocalizedText> = {
  queued: {
    'en-US': 'Queued',
    'zh-CN': '已加入',
    'zh-TW': '已加入',
    ja: 'キュー',
    ko: '대기 중',
  },
  running: {
    'en-US': 'Running',
    'zh-CN': '执行中',
    'zh-TW': '執行中',
    ja: '実行中',
    ko: '실행 중',
  },
  completed: {
    'en-US': 'Ready',
    'zh-CN': '已完成',
    'zh-TW': '已完成',
    ja: '完了',
    ko: '완료',
  },
  failed: {
    'en-US': 'Failed',
    'zh-CN': '失败',
    'zh-TW': '失敗',
    ja: '失敗',
    ko: '실패',
  },
  delivered: {
    'en-US': 'Delivered',
    'zh-CN': '已送达',
    'zh-TW': '已送達',
    ja: '受け取り済み',
    ko: '전달됨',
  },
}

export const ERRAND_COPY = {
  title: {
    'en-US': 'Overnight tasks',
    'zh-CN': '夜间任务',
    'zh-TW': '夜間任務',
    ja: '夜間タスク',
    ko: '야간 작업',
  },
  description: {
    'en-US': 'Queue small tasks during the day; Nexus can work on them overnight (22:00-06:00 local) and show the result in the morning. Up to 4 per night.',
    'zh-CN': '白天把小任务交给 Nexus，它会在夜里 22:00-06:00 处理，并在早上告诉你结果。每晚最多 4 个。',
    'zh-TW': '白天把小任務交給 Nexus，它會在夜裡 22:00-06:00 處理，並在早上告訴你結果。每晚最多 4 個。',
    ja: '昼間に小さなタスクを預けると、Nexus が夜 22:00-06:00 に処理し、朝に結果を知らせます。一晩につき最大 4 件。',
    ko: '낮에 작은 작업을 맡기면 Nexus가 밤 22:00-06:00 사이에 처리하고 아침에 결과를 알려줍니다. 하룻밤에 최대 4개입니다.',
  },
  inputPlaceholder: {
    'en-US': 'e.g. Research the best espresso grinders under $300',
    'zh-CN': '例：帮我查 300 美元以内最好的浓缩咖啡磨豆机',
    'zh-TW': '例：幫我查 300 美元以內最好的濃縮咖啡磨豆機',
    ja: '例：300 ドル以下で最も良いエスプレッソグラインダーを調べて',
    ko: '예: 300달러 이하 최고의 에스프레소 그라인더 조사',
  },
  add: {
    'en-US': 'Queue',
    'zh-CN': '加入队列',
    'zh-TW': '加入佇列',
    ja: 'キューに追加',
    ko: '추가',
  },
  remove: {
    'en-US': 'Remove',
    'zh-CN': '移除',
    'zh-TW': '移除',
    ja: '削除',
    ko: '제거',
  },
  removeConfirm: {
    'en-US': 'Remove this queued task?',
    'zh-CN': '确认移除这个任务吗？',
    'zh-TW': '確認移除這個任務嗎？',
    ja: 'このタスクを削除しますか？',
    ko: '이 작업을 제거할까요?',
  },
  empty: {
    'en-US': 'No tasks queued.',
    'zh-CN': '当前没有任务。',
    'zh-TW': '目前沒有任務。',
    ja: 'タスクはまだありません。',
    ko: '맡긴 작업이 없습니다.',
  },
  result: {
    'en-US': 'Result',
    'zh-CN': '结果',
    'zh-TW': '結果',
    ja: '結果',
    ko: '결과',
  },
  error: {
    'en-US': 'Error',
    'zh-CN': '错误',
    'zh-TW': '錯誤',
    ja: 'エラー',
    ko: '오류',
  },
} satisfies Record<string, LocalizedText>

export type ErrandCopyKey = keyof typeof ERRAND_COPY

export function pickLocalizedText(field: LocalizedText, uiLanguage: UiLanguage): string {
  return field[uiLanguage] ?? field['en-US'] ?? ''
}

export function pickErrandCopy(key: ErrandCopyKey, uiLanguage: UiLanguage): string {
  return pickLocalizedText(ERRAND_COPY[key], uiLanguage)
}

export function formatErrandStatus(status: ErrandViewStatus, uiLanguage: UiLanguage): string {
  return pickLocalizedText(STATUS_LABEL[status], uiLanguage)
}

export function formatErrandTimestamp(iso: string | undefined, uiLanguage: UiLanguage): string {
  if (!iso) return ''
  const timestamp = Date.parse(iso)
  if (!Number.isFinite(timestamp)) return ''
  return new Intl.DateTimeFormat(uiLanguage, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

export function groupErrandsByStatus<T extends ErrandViewRecord>(errands: T[]) {
  return errands.reduce<Partial<Record<ErrandViewStatus, T[]>>>((groups, errand) => {
    groups[errand.status] ??= []
    groups[errand.status]!.push(errand)
    return groups
  }, {})
}
