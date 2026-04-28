import { memo, useCallback, useEffect, useState } from 'react'
import {
  enqueueErrand,
  loadErrands,
  removeErrand,
  type ErrandRecord,
  type ErrandStatus,
} from '../../features/agent/errandStore'
import type { UiLanguage } from '../../types'

interface ErrandsSectionProps {
  active: boolean
  uiLanguage: UiLanguage
}

const STATUS_LABEL: Record<ErrandStatus, Record<string, string>> = {
  queued:    { 'en-US': 'Queued', 'zh-CN': '已加入', 'zh-TW': '已加入', 'ja': 'キュー', 'ko': '대기 중' },
  running:   { 'en-US': 'Running', 'zh-CN': '执行中', 'zh-TW': '執行中', 'ja': '実行中', 'ko': '실행 중' },
  completed: { 'en-US': 'Ready', 'zh-CN': '已完成', 'zh-TW': '已完成', 'ja': '完了', 'ko': '완료' },
  failed:    { 'en-US': 'Failed', 'zh-CN': '失败', 'zh-TW': '失敗', 'ja': '失敗', 'ko': '실패' },
  delivered: { 'en-US': 'Delivered', 'zh-CN': '已送达', 'zh-TW': '已送達', 'ja': '受け取り済み', 'ko': '전달됨' },
}

const COPY = {
  title:        { 'en-US': 'Overnight errands', 'zh-CN': '夜间错事', 'zh-TW': '夜間差事', 'ja': '夜間のおつかい', 'ko': '밤 동안의 심부름' },
  description:  {
    'en-US': "Queue tasks during the day; she'll work on them overnight (22:00–06:00 local) and deliver the result at the morning bracket. Up to 4 per night.",
    'zh-CN': '白天把任务交给她，她会在夜里 22:00-06:00 帮你做，早上 bracket 通知里告诉你结果。每晚最多 4 个。',
    'zh-TW': '白天把任務交給她，她會在夜裡 22:00-06:00 幫你做，早上 bracket 通知裡告訴你結果。每晚最多 4 個。',
    'ja': '昼間にタスクを預けると、夜 22:00–06:00 の間に取り組み、朝のブラケット通知で結果を伝えます。一晩につき最大 4 件。',
    'ko': '낮에 작업을 맡기면 밤 22:00–06:00 사이에 처리하고 아침 브래킷 알림에서 결과를 알려드립니다. 하룻밤에 최대 4개.',
  },
  inputPlaceholder: {
    'en-US': 'e.g. Research the best espresso grinders under $300',
    'zh-CN': '例：帮我查 300 美元以内最好的浓缩咖啡磨豆机',
    'zh-TW': '例：幫我查 300 美元以內最好的濃縮咖啡磨豆機',
    'ja': '例：300 ドル以下で最も良いエスプレッソグラインダーを調べて',
    'ko': '예: 300달러 이하 최고의 에스프레소 그라인더 조사',
  },
  add:        { 'en-US': 'Queue', 'zh-CN': '加入队列', 'zh-TW': '加入佇列', 'ja': 'キューに追加', 'ko': '추가' },
  remove:     { 'en-US': 'Remove', 'zh-CN': '移除', 'zh-TW': '移除', 'ja': '削除', 'ko': '제거' },
  empty:      { 'en-US': 'No errands queued.', 'zh-CN': '当前没有任务。', 'zh-TW': '當前沒有任務。', 'ja': 'おつかいはまだありません。', 'ko': '맡긴 일이 없습니다.' },
  result:     { 'en-US': 'Result', 'zh-CN': '结果', 'zh-TW': '結果', 'ja': '結果', 'ko': '결과' },
  error:      { 'en-US': 'Error', 'zh-CN': '错误', 'zh-TW': '錯誤', 'ja': 'エラー', 'ko': '오류' },
}

function pick(field: { [key: string]: string }, uiLanguage: UiLanguage): string {
  return field[uiLanguage] ?? field['en-US'] ?? ''
}

function formatStatus(status: ErrandStatus, uiLanguage: UiLanguage): string {
  return pick(STATUS_LABEL[status], uiLanguage)
}

function formatRelativeTime(iso: string | undefined, uiLanguage: UiLanguage): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const localeTag = uiLanguage === 'en-US' ? 'en-US' : uiLanguage
  return new Intl.DateTimeFormat(localeTag, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(t))
}

export const ErrandsSection = memo(function ErrandsSection({
  active,
  uiLanguage,
}: ErrandsSectionProps) {
  const [errands, setErrands] = useState<ErrandRecord[]>(() => loadErrands())
  const [draft, setDraft] = useState('')

  const refresh = useCallback(() => {
    setErrands(loadErrands())
  }, [])

  useEffect(() => {
    if (!active) return
    // Defer the initial refresh into the polling timer so it doesn't fire
    // synchronously during effect setup (lint rule
    // react-hooks/set-state-in-effect). The cost is one 10s wait before
    // the first auto-refresh; queue mutations from the same panel update
    // the list immediately via their own setState calls.
    const id = window.setInterval(refresh, 10_000)
    return () => window.clearInterval(id)
  }, [active, refresh])

  const handleAdd = () => {
    const trimmed = draft.trim()
    if (!trimmed) return
    enqueueErrand(trimmed)
    setDraft('')
    refresh()
  }

  const handleRemove = (id: string) => {
    removeErrand(id)
    refresh()
  }

  // 5-locale strings come from the inline COPY table below; not wired
  // through pickTranslatedUiText yet. If a future iteration centralises
  // the keys, restore a `ti` helper here that returns proper i18n keys
  // (NOT `as never` — declare the key shape in src/types/i18nKeys/settings.ts).

  const grouped: Partial<Record<ErrandStatus, ErrandRecord[]>> = {}
  for (const e of errands) {
    if (!grouped[e.status]) grouped[e.status] = []
    grouped[e.status]!.push(e)
  }

  return (
    <section className="settings-diagnostics-panel">
      <header className="settings-diagnostics-panel__header">
        <h4>{pick(COPY.title, uiLanguage)}</h4>
        <p>{pick(COPY.description, uiLanguage)}</p>
      </header>

      <div className="settings-errands__compose">
        <textarea
          className="settings-errands__textarea"
          rows={2}
          placeholder={pick(COPY.inputPlaceholder, uiLanguage)}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button
          type="button"
          className="primary-button"
          onClick={handleAdd}
          disabled={!draft.trim()}
        >
          {pick(COPY.add, uiLanguage)}
        </button>
      </div>

      {errands.length === 0 ? (
        <p className="settings-errands__empty">{pick(COPY.empty, uiLanguage)}</p>
      ) : (
        <ul className="settings-errands__list">
          {(['queued', 'running', 'completed', 'delivered', 'failed'] as ErrandStatus[]).flatMap((status) =>
            (grouped[status] ?? []).map((errand) => (
              <li key={errand.id} className={`settings-errands__item settings-errands__item--${errand.status}`}>
                <div className="settings-errands__item-header">
                  <span className="settings-errands__status">{formatStatus(status, uiLanguage)}</span>
                  <span className="settings-errands__time">{formatRelativeTime(errand.createdAt, uiLanguage)}</span>
                  <button
                    type="button"
                    className="ghost-button settings-errands__remove"
                    onClick={() => handleRemove(errand.id)}
                  >
                    {pick(COPY.remove, uiLanguage)}
                  </button>
                </div>
                <p className="settings-errands__prompt">{errand.prompt}</p>
                {errand.result ? (
                  <details className="settings-errands__result">
                    <summary>{pick(COPY.result, uiLanguage)}</summary>
                    <pre>{errand.result}</pre>
                  </details>
                ) : null}
                {errand.error ? (
                  <p className="settings-errands__error">
                    <strong>{pick(COPY.error, uiLanguage)}:</strong> {errand.error}
                  </p>
                ) : null}
              </li>
            )),
          )}
        </ul>
      )}
    </section>
  )
})
