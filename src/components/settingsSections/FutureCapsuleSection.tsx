import { memo, useCallback, useEffect, useState } from 'react'
import {
  enqueueFutureCapsule,
  loadFutureCapsules,
  removeFutureCapsule,
  type FutureCapsuleRecord,
} from '../../features/futureCapsule/futureCapsuleStore'
import type { UiLanguage } from '../../types'

interface FutureCapsuleSectionProps {
  active: boolean
  uiLanguage: UiLanguage
}

const COPY = {
  title: { 'en-US': 'Future-self time capsules', 'zh-CN': '给未来自己的时光胶囊', 'zh-TW': '給未來自己的時光膠囊', 'ja': '未来の自分へのタイムカプセル', 'ko': '미래의 자신에게 보내는 타임캡슐' },
  description: {
    'en-US': "Write something for your future self and pick the date she'll deliver it back to you. A specific kind of letter — past-you, in your present companion's voice.",
    'zh-CN': '给未来的自己写一段话，选一个日子她替你送回来。过去的你，由现在的她念出来。',
    'zh-TW': '給未來的自己寫一段話，選一個日子她替你送回來。過去的你，由現在的她念出來。',
    'ja': '未来の自分に向けてひとこと書いて、届く日を決めてください。過去のあなたを、今のあなたのコンパニオンが読みあげます。',
    'ko': '미래의 자신에게 한 마디 적고 전해질 날짜를 정하세요. 과거의 당신을, 지금의 동반자가 읽어드립니다.',
  },
  titlePlaceholder: { 'en-US': 'Title (optional) — e.g. "after the album"', 'zh-CN': '标题（可选）—— 例如"专辑做完之后"', 'zh-TW': '標題（可選）—— 例如「專輯做完之後」', 'ja': 'タイトル（任意）— 例：「アルバムが終わった頃」', 'ko': '제목(선택) — 예: "앨범이 끝나갈 즈음"' },
  messagePlaceholder: { 'en-US': 'Write to your future self…', 'zh-CN': '给未来的自己写点什么……', 'zh-TW': '給未來的自己寫點什麼……', 'ja': '未来の自分に向けて書いてください…', 'ko': '미래의 자신에게 무언가 적으세요…' },
  dateLabel: { 'en-US': 'Deliver on', 'zh-CN': '送达日期', 'zh-TW': '送達日期', 'ja': '届く日', 'ko': '전달 날짜' },
  add: { 'en-US': 'Seal capsule', 'zh-CN': '封存胶囊', 'zh-TW': '封存膠囊', 'ja': 'カプセルを封印', 'ko': '캡슐 봉인' },
  remove: { 'en-US': 'Remove', 'zh-CN': '移除', 'zh-TW': '移除', 'ja': '削除', 'ko': '제거' },
  empty: { 'en-US': 'No capsules sealed yet.', 'zh-CN': '还没有封存的胶囊。', 'zh-TW': '還沒有封存的膠囊。', 'ja': 'まだ封印されたカプセルはありません。', 'ko': '아직 봉인된 캡슐이 없습니다.' },
  pending: { 'en-US': 'Pending', 'zh-CN': '等待送达', 'zh-TW': '等待送達', 'ja': '配達待ち', 'ko': '대기 중' },
  delivered: { 'en-US': 'Delivered', 'zh-CN': '已送达', 'zh-TW': '已送達', 'ja': '配達済み', 'ko': '전달됨' },
  scheduled: { 'en-US': 'Scheduled for', 'zh-CN': '送达日期', 'zh-TW': '送達日期', 'ja': '届く予定', 'ko': '전달 예정' },
}

function pick(field: { [key: string]: string }, uiLanguage: UiLanguage): string {
  return field[uiLanguage] ?? field['en-US'] ?? ''
}

function todayLocal(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function defaultScheduledFor(): string {
  // 30 days out — a sensible default for a "letter to your future self" use case.
  const d = new Date()
  d.setDate(d.getDate() + 30)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatDate(iso: string, uiLanguage: UiLanguage): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return iso
  return new Intl.DateTimeFormat(uiLanguage === 'en-US' ? 'en-US' : uiLanguage, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(t))
}

export const FutureCapsuleSection = memo(function FutureCapsuleSection({
  active,
  uiLanguage,
}: FutureCapsuleSectionProps) {
  const [capsules, setCapsules] = useState<FutureCapsuleRecord[]>(() => loadFutureCapsules())
  const [draftMessage, setDraftMessage] = useState('')
  const [draftTitle, setDraftTitle] = useState('')
  const [draftDate, setDraftDate] = useState(defaultScheduledFor())

  const refresh = useCallback(() => {
    setCapsules(loadFutureCapsules())
  }, [])

  useEffect(() => {
    if (!active) return
    const id = window.setInterval(refresh, 30_000)
    return () => window.clearInterval(id)
  }, [active, refresh])

  const handleAdd = () => {
    const trimmed = draftMessage.trim()
    if (!trimmed) return
    enqueueFutureCapsule({
      message: trimmed,
      scheduledFor: draftDate,
      title: draftTitle.trim() || undefined,
    })
    setDraftMessage('')
    setDraftTitle('')
    setDraftDate(defaultScheduledFor())
    refresh()
  }

  const handleRemove = (id: string) => {
    removeFutureCapsule(id)
    refresh()
  }

  const pending = capsules.filter((c) => c.status === 'pending')
  const delivered = capsules.filter((c) => c.status === 'delivered')

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
          placeholder={pick(COPY.titlePlaceholder, uiLanguage)}
          value={draftTitle}
          onChange={(e) => setDraftTitle(e.target.value)}
        />
        <textarea
          className="settings-errands__textarea"
          rows={3}
          placeholder={pick(COPY.messagePlaceholder, uiLanguage)}
          value={draftMessage}
          onChange={(e) => setDraftMessage(e.target.value)}
        />
        <label className="settings-errands__date">
          {pick(COPY.dateLabel, uiLanguage)}
          <input
            type="date"
            min={todayLocal()}
            value={draftDate}
            onChange={(e) => setDraftDate(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="primary-button"
          onClick={handleAdd}
          disabled={!draftMessage.trim()}
        >
          {pick(COPY.add, uiLanguage)}
        </button>
      </div>

      {capsules.length === 0 ? (
        <p className="settings-errands__empty">{pick(COPY.empty, uiLanguage)}</p>
      ) : (
        <ul className="settings-errands__list">
          {pending.map((c) => (
            <li key={c.id} className="settings-errands__item settings-errands__item--queued">
              <div className="settings-errands__item-header">
                <span className="settings-errands__status">{pick(COPY.pending, uiLanguage)}</span>
                <span className="settings-errands__time">
                  {pick(COPY.scheduled, uiLanguage)}: {formatDate(c.scheduledFor, uiLanguage)}
                </span>
                <button
                  type="button"
                  className="ghost-button settings-errands__remove"
                  onClick={() => handleRemove(c.id)}
                >
                  {pick(COPY.remove, uiLanguage)}
                </button>
              </div>
              {c.title ? <p className="settings-errands__title">{c.title}</p> : null}
              <p className="settings-errands__prompt">{c.message}</p>
            </li>
          ))}
          {delivered.map((c) => (
            <li key={c.id} className="settings-errands__item settings-errands__item--delivered">
              <div className="settings-errands__item-header">
                <span className="settings-errands__status">{pick(COPY.delivered, uiLanguage)}</span>
                <span className="settings-errands__time">
                  {c.deliveredAt ? formatDate(c.deliveredAt, uiLanguage) : ''}
                </span>
                <button
                  type="button"
                  className="ghost-button settings-errands__remove"
                  onClick={() => handleRemove(c.id)}
                >
                  {pick(COPY.remove, uiLanguage)}
                </button>
              </div>
              {c.title ? <p className="settings-errands__title">{c.title}</p> : null}
              <p className="settings-errands__prompt">{c.message}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
})
