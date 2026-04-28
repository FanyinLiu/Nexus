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
  const ti = (
    key: Parameters<typeof pickTranslatedUiText>[1],
    params?: Parameters<typeof pickTranslatedUiText>[2],
  ) => pickTranslatedUiText(uiLanguage, key, params)
  const [entries, setEntries] = useState<LorebookEntry[]>(() => cloneEntries(loadLorebookEntries()))
  const [draftKeywords, setDraftKeywords] = useState<Record<string, string>>({})

  // Functional setState in every mutator so two rapid edits across
  // different rows can't both compute their `next` array from the same
  // pre-edit snapshot of `entries`. The previous closure-over-`entries`
  // pattern dropped the first edit when a second one fired before the
  // first re-render landed.
  const updateEntry = useCallback((id: string, patch: Partial<LorebookEntry>) => {
    const now = new Date().toISOString()
    setEntries((current) => {
      const next = current.map((entry) => (entry.id === id ? { ...entry, ...patch, updatedAt: now } : entry))
      saveLorebookEntries(next)
      return cloneEntries(next)
    })
  }, [])

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
    setEntries((current) => {
      const next = [fresh, ...current]
      saveLorebookEntries(next)
      return cloneEntries(next)
    })
  }, [])

  const removeEntry = useCallback((id: string) => {
    setEntries((current) => {
      const next = current.filter((entry) => entry.id !== id)
      saveLorebookEntries(next)
      return cloneEntries(next)
    })
  }, [])

  const totalEnabled = useMemo(
    () => entries.filter((entry) => entry.enabled && entry.keywords.length > 0 && entry.content.trim()).length,
    [entries],
  )

  return (
    <section className={`settings-section ${active ? 'is-active' : 'is-hidden'}`}>
      <div className="settings-section__title-row">
        <div>
          <h4>{ti('settings.lorebooks.title')}</h4>
          <p className="settings-drawer__hint">
            {ti('settings.lorebooks.note')}
          </p>
        </div>
        <div className="settings-page__meta">
          <span>{ti('settings.lorebooks.count_summary', { total: entries.length, enabled: totalEnabled })}</span>
        </div>
      </div>

      <div className="settings-section__title-row">
        <button type="button" className="ghost-button" onClick={addEntry}>
          {ti('settings.lorebooks.add_entry')}
        </button>
      </div>

      {entries.length === 0 ? (
        <p className="settings-drawer__hint">{ti('settings.lorebooks.empty_state')}</p>
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
                    <span>{ti('settings.lorebooks.enabled')}</span>
                  </label>
                  <input
                    value={entry.label}
                    placeholder={ti('settings.lorebooks.label_placeholder')}
                    onChange={(event) => updateEntry(entry.id, { label: event.target.value })}
                    style={{ flex: 1 }}
                  />
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>{ti('settings.lorebooks.priority')}</span>
                    <input
                      type="number"
                      value={entry.priority}
                      onChange={(event) => updateEntry(entry.id, { priority: Number(event.target.value) || 0 })}
                      style={{ width: 64 }}
                    />
                  </label>
                  <button type="button" className="settings-danger-button" onClick={() => removeEntry(entry.id)}>
                    {ti('settings.lorebooks.delete')}
                  </button>
                </div>

                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span>{ti('settings.lorebooks.keywords_label')}</span>
                  <input
                    value={draft}
                    placeholder={ti('settings.lorebooks.keywords_placeholder')}
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
                  <span>{ti('settings.lorebooks.content_label')}</span>
                  <textarea
                    rows={4}
                    value={entry.content}
                    placeholder={ti('settings.lorebooks.content_placeholder')}
                    onChange={(event) => updateEntry(entry.id, { content: event.target.value })}
                  />
                </label>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
})
