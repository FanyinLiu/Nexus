import { memo, useCallback, useEffect, useState } from 'react'
import {
  enqueueFutureCapsule,
  loadFutureCapsules,
  removeFutureCapsule,
  type FutureCapsuleRecord,
  type FutureCapsuleStatus,
} from '../../features/futureCapsule/futureCapsuleStore'
import type { ProactiveCareSourceRef } from '../../lib/storage/proactiveCare.ts'
import type { UiLanguage } from '../../types'

interface FutureCapsulesSectionProps {
  active: boolean
  uiLanguage: UiLanguage
  sourceTarget?: ProactiveCareSourceRef | null
}

const STATUS_LABEL: Record<FutureCapsuleStatus, Record<string, string>> = {
  pending: {
    'en-US': 'Pending',
    'zh-CN': '待送达',
    'zh-TW': '待送達',
    ja: '待機中',
    ko: '대기 중',
  },
  delivered: {
    'en-US': 'Delivered',
    'zh-CN': '已送达',
    'zh-TW': '已送達',
    ja: '配達済み',
    ko: '전달됨',
  },
}

const COPY = {
  title: {
    'en-US': 'Future capsules',
    'zh-CN': '未来胶囊',
    'zh-TW': '未來膠囊',
    ja: '未来カプセル',
    ko: '미래 캡슐',
  },
  description: {
    'en-US': 'Write a short note for your future self; she holds it until the date you choose.',
    'zh-CN': '写一段给未来自己的话，她会按你选的日期送回来。',
    'zh-TW': '寫一段給未來自己的話，她會依你選的日期送回來。',
    ja: '未来の自分への短いメモを書いて、選んだ日に届けてもらいます。',
    ko: '미래의 나에게 짧은 메모를 남기면, 고른 날짜에 다시 전해줍니다.',
  },
  titlePlaceholder: {
    'en-US': 'Optional title',
    'zh-CN': '可选标题',
    'zh-TW': '可選標題',
    ja: '任意のタイトル',
    ko: '선택 제목',
  },
  messagePlaceholder: {
    'en-US': 'What should future you hear?',
    'zh-CN': '想让未来的你听到什么？',
    'zh-TW': '想讓未來的你聽到什麼？',
    ja: '未来の自分に何を伝えたいですか？',
    ko: '미래의 나에게 무엇을 전할까요?',
  },
  scheduledFor: {
    'en-US': 'Deliver on',
    'zh-CN': '送达日期',
    'zh-TW': '送達日期',
    ja: '配達日',
    ko: '전달 날짜',
  },
  add: {
    'en-US': 'Save capsule',
    'zh-CN': '保存胶囊',
    'zh-TW': '保存膠囊',
    ja: 'カプセルを保存',
    ko: '캡슐 저장',
  },
  remove: {
    'en-US': 'Remove',
    'zh-CN': '移除',
    'zh-TW': '移除',
    ja: '削除',
    ko: '제거',
  },
  empty: {
    'en-US': 'No future capsules yet.',
    'zh-CN': '还没有未来胶囊。',
    'zh-TW': '還沒有未來膠囊。',
    ja: '未来カプセルはまだありません。',
    ko: '아직 미래 캡슐이 없습니다.',
  },
}

function pick(field: Record<string, string>, uiLanguage: UiLanguage): string {
  return field[uiLanguage] ?? field['en-US'] ?? ''
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDate(value: string, uiLanguage: UiLanguage): string {
  const parsed = Date.parse(`${value}T00:00:00`)
  if (!Number.isFinite(parsed)) return value
  const localeTag = uiLanguage === 'en-US' ? 'en-US' : uiLanguage
  return new Intl.DateTimeFormat(localeTag, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(parsed))
}

function itemClassName(capsule: FutureCapsuleRecord, targetId: string | null): string {
  const state = capsule.status === 'pending' ? 'queued' : 'delivered'
  return [
    'settings-errands__item',
    `settings-errands__item--${state}`,
    targetId === capsule.id ? 'is-source-target' : '',
  ].filter(Boolean).join(' ')
}

export const FutureCapsulesSection = memo(function FutureCapsulesSection({
  active,
  sourceTarget,
  uiLanguage,
}: FutureCapsulesSectionProps) {
  const [capsules, setCapsules] = useState<FutureCapsuleRecord[]>(() => loadFutureCapsules())
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [scheduledFor, setScheduledFor] = useState(() => formatLocalDate(new Date()))
  const targetId = sourceTarget?.kind === 'capsule' ? sourceTarget.id : null

  const refresh = useCallback(() => {
    setCapsules(loadFutureCapsules())
  }, [])

  useEffect(() => {
    if (!active) return
    const id = window.setInterval(refresh, 30_000)
    return () => window.clearInterval(id)
  }, [active, refresh])

  const handleAdd = () => {
    const created = enqueueFutureCapsule({
      title,
      message,
      scheduledFor,
    })
    if (!created) return
    setTitle('')
    setMessage('')
    setScheduledFor(formatLocalDate(new Date()))
    refresh()
  }

  const handleRemove = (id: string) => {
    removeFutureCapsule(id)
    refresh()
  }

  return (
    <section className="settings-diagnostics-panel">
      <header className="settings-diagnostics-panel__header">
        <h4>{pick(COPY.title, uiLanguage)}</h4>
        <p>{pick(COPY.description, uiLanguage)}</p>
      </header>

      <div className="settings-errands__compose">
        <input
          className="settings-errands__textarea"
          type="text"
          aria-label={`${pick(COPY.title, uiLanguage)}: ${pick(COPY.titlePlaceholder, uiLanguage)}`}
          placeholder={pick(COPY.titlePlaceholder, uiLanguage)}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <label className="settings-errands__date">
          <span>{pick(COPY.scheduledFor, uiLanguage)}</span>
          <input
            type="date"
            min={formatLocalDate(new Date())}
            value={scheduledFor}
            onChange={(event) => setScheduledFor(event.target.value)}
          />
        </label>
        <textarea
          className="settings-errands__textarea"
          rows={2}
          aria-label={`${pick(COPY.title, uiLanguage)}: ${pick(COPY.messagePlaceholder, uiLanguage)}`}
          placeholder={pick(COPY.messagePlaceholder, uiLanguage)}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
        />
        <button
          type="button"
          className="primary-button"
          onClick={handleAdd}
          disabled={!message.trim() || !scheduledFor}
        >
          {pick(COPY.add, uiLanguage)}
        </button>
      </div>

      {capsules.length === 0 ? (
        <p className="settings-errands__empty">{pick(COPY.empty, uiLanguage)}</p>
      ) : (
        <ul className="settings-errands__list">
          {capsules.map((capsule) => (
            <li key={capsule.id} className={itemClassName(capsule, targetId)}>
              <div className="settings-errands__item-header">
                <span className="settings-errands__status">{pick(STATUS_LABEL[capsule.status], uiLanguage)}</span>
                <span className="settings-errands__time">{formatDate(capsule.scheduledFor, uiLanguage)}</span>
                <button
                  type="button"
                  className="ghost-button settings-errands__remove"
                  onClick={() => handleRemove(capsule.id)}
                >
                  {pick(COPY.remove, uiLanguage)}
                </button>
              </div>
              {capsule.title ? (
                <p className="settings-errands__title">{capsule.title}</p>
              ) : null}
              <p className="settings-errands__prompt">{capsule.message}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
})
