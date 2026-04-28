import { memo, useCallback, useEffect, useState } from 'react'
import {
  dropArc,
  loadOpenArcs,
  openArc,
  removeArc,
  resolveArc,
  type OpenArcRecord,
} from '../../features/arc/openArcStore'
import type { UiLanguage } from '../../types'

interface OpenArcsSectionProps {
  active: boolean
  uiLanguage: UiLanguage
}

const COPY = {
  title: {
    'en-US': 'Open threads',
    'zh-CN': '还没收的线',
    'zh-TW': '還沒收的線',
    'ja': '開いたままの糸',
    'ko': '열어둔 실',
  },
  description: {
    'en-US': "For things that won't resolve in one sitting. Open a thread; she follows up on day 3 and day 5, then drops it gracefully if you don't close it by day 7.",
    'zh-CN': '不是一两句能聊完的事情。开一根线，她第 3 天、第 5 天分别问一次，第 7 天没动作就轻轻放下。',
    'zh-TW': '不是一兩句能聊完的事情。開一根線，她第 3 天、第 5 天分別問一次，第 7 天沒動作就輕輕放下。',
    'ja': '一度では片付かないことのために。糸を開けば、3日目と5日目にそっと様子を聞いてくれます。7日経って閉じなければ、静かに手放します。',
    'ko': '한 번에 끝나지 않는 일들을 위해. 실을 열면 3일째, 5일째에 가만히 안부를 물어봅니다. 7일 동안 닫지 않으면 조용히 놓아둡니다.',
  },
  themePlaceholder: {
    'en-US': 'In your own words — what is the thread about?',
    'zh-CN': '用你自己的话——这根线是什么事？',
    'zh-TW': '用你自己的話——這根線是什麼事？',
    'ja': 'あなた自身の言葉で — どんな糸ですか？',
    'ko': '네 말로 — 어떤 실이야?',
  },
  open: {
    'en-US': 'Open thread',
    'zh-CN': '开线',
    'zh-TW': '開線',
    'ja': '糸を開く',
    'ko': '실 열기',
  },
  resolve: {
    'en-US': 'Close',
    'zh-CN': '收线',
    'zh-TW': '收線',
    'ja': '閉じる',
    'ko': '닫기',
  },
  drop: {
    'en-US': 'Drop',
    'zh-CN': '放下',
    'zh-TW': '放下',
    'ja': '手放す',
    'ko': '놓기',
  },
  remove: {
    'en-US': 'Remove',
    'zh-CN': '移除',
    'zh-TW': '移除',
    'ja': '削除',
    'ko': '제거',
  },
  empty: {
    'en-US': 'No threads open. Start one when something is sitting with you.',
    'zh-CN': '没有正在跟的线。心里有事时开一根。',
    'zh-TW': '沒有正在跟的線。心裡有事時開一根。',
    'ja': '今は開いている糸はありません。心に何か残っているときに開いてください。',
    'ko': '지금 열린 실은 없어. 마음에 남는 일이 있을 때 하나 열어봐.',
  },
  statusOpen: {
    'en-US': 'Open',
    'zh-CN': '正在跟',
    'zh-TW': '正在跟',
    'ja': '進行中',
    'ko': '진행 중',
  },
  statusResolved: {
    'en-US': 'Closed',
    'zh-CN': '已收',
    'zh-TW': '已收',
    'ja': '閉じた',
    'ko': '닫힘',
  },
  statusDropped: {
    'en-US': 'Let go',
    'zh-CN': '放下了',
    'zh-TW': '放下了',
    'ja': '手放した',
    'ko': '놓았어',
  },
  daysOpen: {
    'en-US': 'open {days}d',
    'zh-CN': '开 {days} 天',
    'zh-TW': '開 {days} 天',
    'ja': '{days}日経過',
    'ko': '{days}일째',
  },
  pings: {
    'en-US': 'pings: {n}',
    'zh-CN': '问候 {n} 次',
    'zh-TW': '問候 {n} 次',
    'ja': 'ピング {n} 回',
    'ko': '안부 {n}회',
  },
  closingNotePlaceholder: {
    'en-US': 'Optional: what happened? (skip to just close)',
    'zh-CN': '可选：最后怎么样了？（不写也能直接收）',
    'zh-TW': '可選：最後怎麼樣了？（不寫也能直接收）',
    'ja': '任意：どうなりましたか？（書かなくても閉じられます）',
    'ko': '선택: 어떻게 됐어? (안 써도 닫을 수 있어)',
  },
}

function pick(field: { [key: string]: string }, uiLanguage: UiLanguage): string {
  return field[uiLanguage] ?? field['en-US'] ?? ''
}

function fillTemplate(tpl: string, vars: Record<string, string | number>): string {
  let out = tpl
  for (const [k, v] of Object.entries(vars)) {
    // Function-form replacement so `$&`, `$$`, `$\``, `$'` in the value
    // aren't interpreted as backreference / placeholder syntax.
    const value = String(v)
    out = out.replace(`{${k}}`, () => value)
  }
  return out
}

function daysBetween(iso: string, now: Date): number {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return 0
  const ms = now.getTime() - t
  if (ms <= 0) return 0
  return Math.floor(ms / (24 * 60 * 60 * 1000))
}

export const OpenArcsSection = memo(function OpenArcsSection({
  active,
  uiLanguage,
}: OpenArcsSectionProps) {
  const [arcs, setArcs] = useState<OpenArcRecord[]>(() => loadOpenArcs())
  const [draftTheme, setDraftTheme] = useState('')
  const [closingNoteFor, setClosingNoteFor] = useState<string | null>(null)
  const [closingNote, setClosingNote] = useState('')

  const refresh = useCallback(() => {
    setArcs(loadOpenArcs())
  }, [])

  useEffect(() => {
    if (!active) return
    const id = window.setInterval(refresh, 30_000)
    return () => window.clearInterval(id)
  }, [active, refresh])

  const handleOpen = () => {
    const trimmed = draftTheme.trim()
    if (!trimmed) return
    openArc({ theme: trimmed })
    setDraftTheme('')
    refresh()
  }

  const handleResolve = (id: string) => {
    if (closingNoteFor === id) {
      resolveArc(id, closingNote || undefined)
      setClosingNoteFor(null)
      setClosingNote('')
    } else {
      setClosingNoteFor(id)
      setClosingNote('')
    }
    refresh()
  }

  const handleConfirmResolve = (id: string) => {
    resolveArc(id, closingNote || undefined)
    setClosingNoteFor(null)
    setClosingNote('')
    refresh()
  }

  const handleDrop = (id: string) => {
    dropArc(id)
    refresh()
  }

  const handleRemove = (id: string) => {
    removeArc(id)
    refresh()
  }

  const open = arcs.filter((a) => a.status === 'open')
  const closed = arcs.filter((a) => a.status !== 'open')
  const now = new Date()

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
          placeholder={pick(COPY.themePlaceholder, uiLanguage)}
          value={draftTheme}
          onChange={(e) => setDraftTheme(e.target.value)}
        />
        <button
          type="button"
          className="primary-button"
          onClick={handleOpen}
          disabled={!draftTheme.trim()}
        >
          {pick(COPY.open, uiLanguage)}
        </button>
      </div>

      {arcs.length === 0 ? (
        <p className="settings-errands__empty">{pick(COPY.empty, uiLanguage)}</p>
      ) : (
        <ul className="settings-errands__list">
          {open.map((a) => {
            const days = daysBetween(a.startedAt, now)
            const isClosing = closingNoteFor === a.id
            return (
              <li key={a.id} className="settings-errands__item settings-errands__item--queued">
                <div className="settings-errands__item-header">
                  <span className="settings-errands__status">{pick(COPY.statusOpen, uiLanguage)}</span>
                  <span className="settings-errands__time">
                    {fillTemplate(pick(COPY.daysOpen, uiLanguage), { days })}
                    {' · '}
                    {fillTemplate(pick(COPY.pings, uiLanguage), { n: a.checkInsFired.length })}
                  </span>
                  {!isClosing ? (
                    <>
                      <button
                        type="button"
                        className="ghost-button settings-errands__remove"
                        onClick={() => handleResolve(a.id)}
                      >
                        {pick(COPY.resolve, uiLanguage)}
                      </button>
                      <button
                        type="button"
                        className="ghost-button settings-errands__remove"
                        onClick={() => handleDrop(a.id)}
                      >
                        {pick(COPY.drop, uiLanguage)}
                      </button>
                    </>
                  ) : null}
                </div>
                <p className="settings-errands__prompt">{a.theme}</p>
                {isClosing ? (
                  <div className="settings-errands__compose">
                    <textarea
                      className="settings-errands__textarea"
                      rows={2}
                      placeholder={pick(COPY.closingNotePlaceholder, uiLanguage)}
                      value={closingNote}
                      onChange={(e) => setClosingNote(e.target.value)}
                    />
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => handleConfirmResolve(a.id)}
                    >
                      {pick(COPY.resolve, uiLanguage)}
                    </button>
                  </div>
                ) : null}
              </li>
            )
          })}
          {closed.map((a) => (
            <li key={a.id} className="settings-errands__item settings-errands__item--delivered">
              <div className="settings-errands__item-header">
                <span className="settings-errands__status">
                  {a.status === 'resolved'
                    ? pick(COPY.statusResolved, uiLanguage)
                    : pick(COPY.statusDropped, uiLanguage)}
                </span>
                <button
                  type="button"
                  className="ghost-button settings-errands__remove"
                  onClick={() => handleRemove(a.id)}
                >
                  {pick(COPY.remove, uiLanguage)}
                </button>
              </div>
              <p className="settings-errands__prompt">{a.theme}</p>
              {a.closingNote ? (
                <p className="settings-errands__title" style={{ opacity: 0.7 }}>
                  — {a.closingNote}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
})
