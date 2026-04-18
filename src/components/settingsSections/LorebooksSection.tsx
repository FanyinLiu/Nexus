import { memo, useCallback, useMemo, useState } from 'react'
import { loadLorebookEntries, saveLorebookEntries } from '../../lib/storage/lorebooks'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import type { LorebookEntry, UiLanguage } from '../../types'

type LorebooksSectionProps = {
  active: boolean
  uiLanguage: UiLanguage
}

function makeId(): string {
  return `lorebook-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function cloneEntries(entries: LorebookEntry[]): LorebookEntry[] {
  return entries.map((entry) => ({ ...entry, keywords: [...entry.keywords] }))
}

export const LorebooksSection = memo(function LorebooksSection({
  active,
  uiLanguage,
}: LorebooksSectionProps) {
  const ti = (key: Parameters<typeof pickTranslatedUiText>[1]) => pickTranslatedUiText(uiLanguage, key)
  const [entries, setEntries] = useState<LorebookEntry[]>(() => cloneEntries(loadLorebookEntries()))
  const [draftKeywords, setDraftKeywords] = useState<Record<string, string>>({})

  const persist = useCallback((next: LorebookEntry[]) => {
    setEntries(cloneEntries(next))
    saveLorebookEntries(next)
  }, [])

  const updateEntry = useCallback((id: string, patch: Partial<LorebookEntry>) => {
    const now = new Date().toISOString()
    persist(entries.map((entry) => (entry.id === id ? { ...entry, ...patch, updatedAt: now } : entry)))
  }, [entries, persist])

  const addEntry = useCallback(() => {
    const now = new Date().toISOString()
    const fresh: LorebookEntry = {
      id: makeId(),
      label: '',
      keywords: [],
      content: '',
      enabled: true,
      priority: 0,
      createdAt: now,
      updatedAt: now,
    }
    persist([fresh, ...entries])
  }, [entries, persist])

  const removeEntry = useCallback((id: string) => {
    persist(entries.filter((entry) => entry.id !== id))
  }, [entries, persist])

  const totalEnabled = useMemo(
    () => entries.filter((entry) => entry.enabled && entry.keywords.length > 0 && entry.content.trim()).length,
    [entries],
  )

  return (
    <section className={`settings-section ${active ? 'is-active' : 'is-hidden'}`}>
      <div className="settings-section__title-row">
        <div>
          <h4>Lorebook 背景条目</h4>
          <p className="settings-drawer__hint">
            当你最近几句话里出现任一关键词时，条目内容会被注入系统 prompt。每轮最多 6 条生效，按优先级和最长匹配排序。
            适合放"我家人设定 / 常提到的朋友 / 项目背景"这类按需触发的背景知识。
          </p>
        </div>
        <div className="settings-page__meta">
          <span>{`${entries.length} 条 · ${totalEnabled} 条生效`}</span>
        </div>
      </div>

      <div className="settings-section__title-row">
        <button type="button" className="ghost-button" onClick={addEntry}>
          新增条目
        </button>
      </div>

      {entries.length === 0 ? (
        <p className="settings-drawer__hint">（还没有条目。点上方"新增条目"加一条，填入关键词和内容即可。）</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {entries.map((entry) => {
            const draft = draftKeywords[entry.id] ?? entry.keywords.join('，')
            return (
              <li
                key={entry.id}
                style={{
                  border: '1px solid var(--border-subtle, rgba(255,255,255,0.08))',
                  borderRadius: 8,
                  padding: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={entry.enabled}
                      onChange={(event) => updateEntry(entry.id, { enabled: event.target.checked })}
                    />
                    <span>启用</span>
                  </label>
                  <input
                    value={entry.label}
                    placeholder="标题（可选，仅用于你自己分辨）"
                    onChange={(event) => updateEntry(entry.id, { label: event.target.value })}
                    style={{ flex: 1 }}
                  />
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>优先级</span>
                    <input
                      type="number"
                      value={entry.priority}
                      onChange={(event) => updateEntry(entry.id, { priority: Number(event.target.value) || 0 })}
                      style={{ width: 64 }}
                    />
                  </label>
                  <button type="button" className="settings-danger-button" onClick={() => removeEntry(entry.id)}>
                    删除
                  </button>
                </div>

                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span>关键词（逗号或顿号分隔，任一命中即触发）</span>
                  <input
                    value={draft}
                    placeholder="妈妈, mom, 我妈"
                    onChange={(event) => setDraftKeywords((prev) => ({ ...prev, [entry.id]: event.target.value }))}
                    onBlur={() => {
                      const parsed = draft
                        .split(/[,，、;；]/)
                        .map((k) => k.trim())
                        .filter(Boolean)
                      updateEntry(entry.id, { keywords: parsed })
                      setDraftKeywords((prev) => {
                        const next = { ...prev }
                        delete next[entry.id]
                        return next
                      })
                    }}
                  />
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span>注入内容</span>
                  <textarea
                    rows={4}
                    value={entry.content}
                    placeholder="用户的母亲是上海一名小学教师，姓张，退休后爱养多肉。"
                    onChange={(event) => updateEntry(entry.id, { content: event.target.value })}
                  />
                </label>
              </li>
            )
          })}
        </ul>
      )}

      {/* ti is retained so future i18n additions can slot in without retagging the component. */}
      <span style={{ display: 'none' }}>{ti('settings.history.title')}</span>
    </section>
  )
})
