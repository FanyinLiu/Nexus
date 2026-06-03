import { memo, useCallback, useMemo, useState } from 'react'
import { PetControlIcon } from '../PetControlIcon'
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
    <section className={`settings-section settings-lorebook-section ${active ? 'is-active' : 'is-hidden'}`}>
      <div className="settings-section__title-row settings-lorebook-section__head">
        <div className="settings-lorebook-section__intro">
          <h4>{ti('settings.lorebooks.entries_title')}</h4>
          <p className="settings-drawer__hint">
            {ti('settings.lorebooks.entries_note')}
          </p>
        </div>
        <div className="settings-page__meta settings-lorebook-section__actions">
          <span>{ti('settings.lorebooks.count_summary', { total: entries.length, enabled: totalEnabled })}</span>
          <button type="button" className="ghost-button" onClick={addEntry}>
            {ti('settings.lorebooks.add_entry')}
          </button>
        </div>
      </div>

      {entries.length === 0 ? (
        <p className="settings-lorebook-empty">{ti('settings.lorebooks.empty_state')}</p>
      ) : (
        <ul className="settings-lorebook-list">
          {entries.map((entry) => {
            const draft = draftKeywords[entry.id] ?? entry.keywords.join('，')
            const entryLabel = entry.label || ti('settings.lorebooks.label_placeholder')
            const deleteLabel = `${ti('settings.lorebooks.delete')}: ${entryLabel}`

            return (
              <li key={entry.id} className="settings-lorebook-item">
                <div className="settings-lorebook-item__toolbar">
                  <label className="settings-toggle settings-lorebook-check">
                    <span>{ti('settings.lorebooks.enabled')}</span>
                    <input
                      type="checkbox"
                      checked={entry.enabled}
                      onChange={(event) => updateEntry(entry.id, { enabled: event.target.checked })}
                    />
                  </label>
                  <label className="settings-lorebook-field settings-lorebook-title-field">
                    <span>{ti('settings.lorebooks.label_label')}</span>
                    <input
                      className="settings-lorebook-item__label"
                      value={entry.label}
                      placeholder={ti('settings.lorebooks.label_placeholder')}
                      aria-label={ti('settings.lorebooks.label_placeholder')}
                      onChange={(event) => updateEntry(entry.id, { label: event.target.value })}
                    />
                  </label>
                  <label className="settings-lorebook-priority">
                    <span>{ti('settings.lorebooks.priority')}</span>
                    <input
                      type="number"
                      value={entry.priority}
                      onChange={(event) => updateEntry(entry.id, { priority: Number(event.target.value) || 0 })}
                    />
                  </label>
                  <button
                    type="button"
                    className="settings-danger-button settings-lorebook-item__delete"
                    onClick={() => removeEntry(entry.id)}
                    aria-label={deleteLabel}
                    title={deleteLabel}
                  >
                    <PetControlIcon name="trash" />
                  </button>
                </div>

                <label className="settings-lorebook-field settings-lorebook-keywords-field">
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

                <label className="settings-lorebook-field settings-lorebook-content-field">
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
