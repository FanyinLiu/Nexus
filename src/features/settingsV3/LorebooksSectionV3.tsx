import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadLorebookEntries, saveLorebookEntries } from '../../lib/storage/lorebooks'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import type { LorebookEntry, UiLanguage } from '../../types'
import type { ConfirmFn } from '../../components/useConfirm'
import { SettingsV3Disclosure, SettingsV3Empty, SettingsV3Field, SettingsV3Page, SettingsV3Section, SettingsV3Switch, SettingsV3Toolbar } from './SettingsV3Primitives'
import './settings-v3-collection.css'

type LorebooksSectionV3Props = { active: boolean; uiLanguage: UiLanguage; confirm: ConfirmFn }

function makeId(): string {
  return `lorebook-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function cloneEntries(entries: LorebookEntry[]): LorebookEntry[] {
  return entries.map((entry) => ({ ...entry, keywords: [...entry.keywords] }))
}

export const LorebooksSectionV3 = memo(function LorebooksSectionV3({ active, uiLanguage, confirm }: LorebooksSectionV3Props) {
  const ti = useCallback((key: Parameters<typeof pickTranslatedUiText>[1], params?: Parameters<typeof pickTranslatedUiText>[2]) =>
    pickTranslatedUiText(uiLanguage, key, params), [uiLanguage])
  const [entries, setEntries] = useState<LorebookEntry[]>(() => cloneEntries(loadLorebookEntries()))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draftKeywords, setDraftKeywords] = useState<Record<string, string>>({})
  const editorRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!selectedId) return
    window.requestAnimationFrame(() => {
      editorRef.current?.scrollIntoView({ block: 'nearest' })
      editorRef.current?.focus({ preventScroll: true })
    })
  }, [selectedId])

  const persist = useCallback((update: (current: LorebookEntry[]) => LorebookEntry[]) => {
    setEntries((current) => {
      const next = update(current)
      saveLorebookEntries(next)
      return cloneEntries(next)
    })
  }, [])

  const updateEntry = useCallback((id: string, patch: Partial<LorebookEntry>) => {
    const updatedAt = new Date().toISOString()
    persist((current) => current.map((entry) => entry.id === id ? { ...entry, ...patch, updatedAt } : entry))
  }, [persist])

  const addEntry = useCallback(() => {
    const now = new Date().toISOString()
    const fresh: LorebookEntry = { id: makeId(), label: '', keywords: [], content: '', enabled: true, priority: 0, createdAt: now, updatedAt: now }
    persist((current) => [fresh, ...current])
    setSelectedId(fresh.id)
  }, [persist])

  const removeEntry = useCallback(async (entry: LorebookEntry) => {
    const confirmed = await confirm({
      title: ti('settings.lorebooks.delete'),
      message: `${ti('settings.lorebooks.delete')}: ${entry.label || ti('settings.lorebooks.label_placeholder')}`,
      confirmLabel: ti('settings.lorebooks.delete'),
      tone: 'danger',
    })
    if (!confirmed) return
    persist((current) => current.filter((item) => item.id !== entry.id))
    setSelectedId((current) => current === entry.id ? null : current)
  }, [confirm, persist, ti])

  const enabledCount = useMemo(() => entries.filter((entry) => entry.enabled && entry.keywords.length && entry.content.trim()).length, [entries])
  const selected = entries.find((entry) => entry.id === selectedId) ?? null

  return (
    <SettingsV3Page className={`${entries.length === 0 ? 'settings-v3-page--fill' : ''} ${active ? '' : 'is-hidden'}`.trim()}>
      <SettingsV3Section title={ti('settings.lorebooks.entries_title')} hideHeader fill={entries.length === 0}>
        <div className="settings-v3-collection-toolbar">
          <span className="settings-v3-collection-count">{ti('settings.lorebooks.count_summary', { total: entries.length, enabled: enabledCount })}</span>
          <SettingsV3Toolbar><button type="button" onClick={addEntry}>{ti('settings.lorebooks.add_entry')}</button></SettingsV3Toolbar>
        </div>
        {entries.length === 0 ? (
          <SettingsV3Empty title={ti('settings.lorebooks.empty_state')} description={ti('settings.lorebooks.entries_note')} />
        ) : (
          <ul className="settings-v3-collection">
            {entries.map((entry) => (
              <li key={entry.id} className="settings-v3-collection-row is-compact">
                <button
                  type="button"
                  className="settings-v3-collection-row__main"
                  aria-current={selectedId === entry.id ? 'true' : undefined}
                  aria-controls="settings-v3-lorebook-editor"
                  onClick={() => setSelectedId(entry.id)}
                >
                  <span className="settings-v3-collection-row__title">{entry.label || ti('settings.lorebooks.label_placeholder')}</span>
                  <span className="settings-v3-collection-row__preview">{entry.content || ti('settings.lorebooks.content_placeholder')}</span>
                  <span className="settings-v3-chip-line">{entry.keywords.map((keyword) => <span key={keyword}>{keyword}</span>)}</span>
                </button>
                <SettingsV3Switch label={`${ti('settings.lorebooks.enabled')}: ${entry.label || ti('settings.lorebooks.label_placeholder')}`} checked={entry.enabled} onChange={(enabled) => updateEntry(entry.id, { enabled })} />
              </li>
            ))}
          </ul>
        )}
      </SettingsV3Section>

      {selected ? (
        <SettingsV3Section title={selected.label || ti('settings.lorebooks.label_placeholder')} description={ti('settings.lorebooks.entries_note')}>
          <div id="settings-v3-lorebook-editor" ref={editorRef} className="settings-v3-editor" tabIndex={-1}>
            <SettingsV3Field label={ti('settings.lorebooks.label_label')}>
              <input value={selected.label} onChange={(event) => updateEntry(selected.id, { label: event.target.value })} />
            </SettingsV3Field>
            <SettingsV3Field label={ti('settings.lorebooks.keywords_label')} hint={ti('settings.lorebooks.keywords_placeholder')}>
              <input
                value={draftKeywords[selected.id] ?? selected.keywords.join('，')}
                onChange={(event) => setDraftKeywords((current) => ({ ...current, [selected.id]: event.target.value }))}
                onBlur={() => {
                  const value = draftKeywords[selected.id]
                  if (value === undefined) return
                  updateEntry(selected.id, { keywords: value.split(/[,，、;；]/).map((keyword) => keyword.trim()).filter(Boolean) })
                  setDraftKeywords((current) => { const next = { ...current }; delete next[selected.id]; return next })
                }}
              />
            </SettingsV3Field>
            <SettingsV3Field label={ti('settings.lorebooks.content_label')}>
              <textarea value={selected.content} onChange={(event) => updateEntry(selected.id, { content: event.target.value })} />
            </SettingsV3Field>
            <SettingsV3Disclosure title={ti('settings.lorebooks.priority')} description={String(selected.priority)}>
              <SettingsV3Field label={ti('settings.lorebooks.priority')}><input type="number" value={selected.priority} onChange={(event) => updateEntry(selected.id, { priority: Number(event.target.value) || 0 })} /></SettingsV3Field>
            </SettingsV3Disclosure>
            <SettingsV3Toolbar><button type="button" className="is-danger" onClick={() => void removeEntry(selected)}>{ti('settings.lorebooks.delete')}</button></SettingsV3Toolbar>
          </div>
        </SettingsV3Section>
      ) : null}
    </SettingsV3Page>
  )
})
