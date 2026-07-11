import { useEffect, useMemo, useState } from 'react'
import { pickTranslatedUiText } from '../../../lib/uiLanguage.ts'
import type { ChatMemoryTraceFocusTarget } from '../traceDetails.ts'
import type {
  DailyMemoryEntry,
  MemoryItem,
  MemorySearchMode,
  TranslationKey,
  UiLanguage,
} from '../../../types/index.ts'

type MemoryPanelProps = {
  assistantName: string
  dailyEntries: DailyMemoryEntry[]
  embeddingModel: string
  focus?: ChatMemoryTraceFocusTarget | null
  memories: MemoryItem[]
  onAddMemory: (content: string) => void
  onClearDaily: () => void
  onRemove: (id: string) => void
  onRemoveDailyEntry?: (id: string, day: string) => void
  onSetMemoryEnabled: (id: string, enabled: boolean) => void
  onUpdateDailyEntry?: (id: string, day: string, content: string) => void
  onUpdateMemory: (id: string, content: string) => void
  searchMode: MemorySearchMode
  uiLanguage: UiLanguage
}

const MEMORY_CATEGORY_KEY: Record<MemoryItem['category'], TranslationKey> = {
  profile: 'memory_panel.category.profile',
  preference: 'memory_panel.category.preference',
  goal: 'memory_panel.category.goal',
  habit: 'memory_panel.category.habit',
  manual: 'memory_panel.category.manual',
  feedback: 'memory_panel.category.feedback',
  project: 'memory_panel.category.project',
  reference: 'memory_panel.category.reference',
}

const SEARCH_MODE_KEY: Record<MemorySearchMode, TranslationKey> = {
  keyword: 'memory_search.keyword.label',
  hybrid: 'memory_search.hybrid.label',
  vector: 'memory_search.vector.label',
}

function getCategoryLabel(category: MemoryItem['category'], uiLanguage: UiLanguage) {
  return pickTranslatedUiText(uiLanguage, MEMORY_CATEGORY_KEY[category])
}

function getSearchModeLabel(searchMode: MemorySearchMode, uiLanguage: UiLanguage) {
  return pickTranslatedUiText(uiLanguage, SEARCH_MODE_KEY[searchMode])
}

function getActionSnippet(content: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim()
  return normalized.length > 72 ? `${normalized.slice(0, 72)}...` : normalized
}

export function MemoryPanel({
  assistantName,
  dailyEntries,
  embeddingModel,
  focus,
  memories,
  onAddMemory,
  onClearDaily,
  onRemove,
  onRemoveDailyEntry,
  onSetMemoryEnabled,
  onUpdateDailyEntry,
  onUpdateMemory,
  searchMode,
  uiLanguage,
}: MemoryPanelProps) {
  const ti = (
    key: TranslationKey,
    params?: Parameters<typeof pickTranslatedUiText>[2],
  ) => pickTranslatedUiText(uiLanguage, key, params)
  const getSearchModeSummary = (searchMode: MemorySearchMode) =>
    ti('memory_panel.search_mode_summary', { mode: getSearchModeLabel(searchMode, uiLanguage) })
  const [manualMemory, setManualMemory] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingContent, setEditingContent] = useState('')
  const [editError, setEditError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const focusedLongTermIds = useMemo(
    () => new Set([...(focus?.longTermIds ?? []), ...(focus?.semanticIds ?? [])]),
    [focus],
  )
  const focusedDailyIds = useMemo(
    () => new Set([...(focus?.dailyEntryIds ?? []), ...(focus?.semanticIds ?? [])]),
    [focus],
  )
  const focusSignature = useMemo(
    () => Array
      .from(new Set([...focusedLongTermIds, ...focusedDailyIds]))
      .sort()
      .join('\n'),
    [focusedDailyIds, focusedLongTermIds],
  )

  function handleAddMemory() {
    const content = manualMemory.trim()
    if (!content) return

    onAddMemory(content)
    setManualMemory('')
  }

  function startEditing(id: string, content: string) {
    setEditingId(id)
    setEditingContent(content)
    setEditError(null)
    setDeletingId(null)
  }

  function cancelEditing() {
    setEditingId(null)
    setEditingContent('')
    setEditError(null)
  }

  function saveMemoryEdit(id: string) {
    const trimmed = editingContent.trim()
    if (!trimmed) {
      setEditError(ti('memory_panel.empty_memory_content'))
      return
    }

    try {
      onUpdateMemory(id, trimmed)
      cancelEditing()
    } catch (error) {
      setEditError(error instanceof Error ? error.message : ti('memory_panel.edit_memory_failed'))
    }
  }

  function saveDailyEdit(id: string, day: string) {
    const trimmed = editingContent.trim()
    if (!trimmed) {
      setEditError(ti('memory_panel.empty_diary_content'))
      return
    }

    try {
      onUpdateDailyEntry?.(id, day, trimmed)
      cancelEditing()
    } catch (error) {
      setEditError(error instanceof Error ? error.message : ti('memory_panel.edit_diary_failed'))
    }
  }

  function confirmDelete(id: string) {
    setDeletingId(id)
    cancelEditing()
  }

  function cancelDelete() {
    setDeletingId(null)
  }

  useEffect(() => {
    if (!editingId && !deletingId) return undefined

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setEditingId(null)
        setEditingContent('')
        setEditError(null)
        setDeletingId(null)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [deletingId, editingId])

  useEffect(() => {
    if (!focusSignature || typeof window === 'undefined') return undefined

    const frame = window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>('.memory-pill[data-memory-focus="true"]')
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })

    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [focusSignature])

  return (
    <section className="memory-card">
      <div className="memory-card__header">
        <div>
          <p className="eyebrow">{ti('memory_panel.system_badge')}</p>
          <h3>{ti('memory_panel.title')}</h3>
          <p className="memory-card__hint">{getSearchModeSummary(searchMode)}</p>
        </div>
      </div>

      <div className="memory-card__meta">
        <span className="memory-pill__category">
          {ti('memory_panel.category.long_term')} {memories.length}
        </span>
        <span className="memory-pill__category">
          {ti('memory_panel.category.diary')} {dailyEntries.length}
        </span>
        <span className="memory-pill__category">{embeddingModel}</span>
      </div>

      <div className="memory-card__composer">
        <textarea
          rows={3}
          value={manualMemory}
          placeholder={ti('memory_panel.manual_placeholder')}
          aria-label={`${ti('memory_panel.title')}: ${ti('memory_panel.manual_placeholder')}`}
          onChange={(event) => setManualMemory(event.target.value)}
        />
        <div className="memory-card__actions">
          <button type="button" className="ghost-button" onClick={handleAddMemory}>
            {ti('memory_panel.save_to_long_term')}
          </button>
          <button type="button" className="settings-danger-button" onClick={onClearDaily}>
            {ti('memory_panel.clear_diary')}
          </button>
        </div>
      </div>

      <div className="memory-list">
        {memories.length ? (
          memories.map((memory) => {
            const memoryEnabled = memory.enabled !== false
            const memoryFocused = focusedLongTermIds.has(memory.id)
            return (
              <article
                key={memory.id}
                className={`memory-pill ${memoryEnabled ? '' : 'is-disabled'} ${memoryFocused ? 'is-focused' : ''}`.trim()}
                data-memory-focus={memoryFocused ? 'true' : undefined}
              >
                <div className="memory-pill__meta-row">
                  <span className="memory-pill__category">{getCategoryLabel(memory.category, uiLanguage)}</span>
                  {!memoryEnabled ? (
                    <span className="memory-pill__category">{ti('memory_panel.paused_badge')}</span>
                  ) : null}
                  {memoryFocused ? (
                    <span className="memory-pill__category memory-pill__category--focus">
                      {ti('memory_panel.focused_badge')}
                    </span>
                  ) : null}
                </div>

                {editingId === memory.id ? (
                  <div className="memory-pill__edit">
                    <textarea
                      rows={2}
                      value={editingContent}
                      aria-label={`${ti('memory_panel.edit')} ${ti('memory_panel.category.long_term')}`}
                      onChange={(event) => setEditingContent(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault()
                          saveMemoryEdit(memory.id)
                        }
                      }}
                      autoFocus
                    />
                    {editError ? (
                      <p className="memory-pill__error" role="alert" aria-live="assertive" aria-atomic="true">
                        {editError}
                      </p>
                    ) : null}
                    <div className="memory-pill__actions">
                      <button type="button" onClick={() => saveMemoryEdit(memory.id)}>
                        {ti('memory_panel.save')}
                      </button>
                      <button type="button" onClick={cancelEditing}>
                        {ti('memory_panel.cancel')}
                      </button>
                    </div>
                  </div>
                ) : deletingId === memory.id ? (
                  <div className="memory-pill__confirm">
                    <p>{ti('memory_panel.confirm_delete_memory')}</p>
                    <div className="memory-pill__actions">
                      <button
                        type="button"
                        aria-label={`${ti('memory_panel.delete')}: ${getActionSnippet(memory.content)}`}
                        title={`${ti('memory_panel.delete')}: ${getActionSnippet(memory.content)}`}
                        onClick={() => {
                          onRemove(memory.id)
                          cancelDelete()
                        }}
                      >
                        {ti('memory_panel.delete')}
                      </button>
                      <button type="button" onClick={cancelDelete}>
                        {ti('memory_panel.cancel')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p>{memory.content}</p>
                    <div className="memory-pill__actions">
                      <button
                        type="button"
                        aria-label={`${ti('memory_panel.edit')}: ${getActionSnippet(memory.content)}`}
                        title={`${ti('memory_panel.edit')}: ${getActionSnippet(memory.content)}`}
                        onClick={() => startEditing(memory.id, memory.content)}
                      >
                        {ti('memory_panel.edit')}
                      </button>
                      <button
                        type="button"
                        aria-label={`${memoryEnabled ? ti('memory_panel.pause') : ti('memory_panel.resume')}: ${getActionSnippet(memory.content)}`}
                        title={`${memoryEnabled ? ti('memory_panel.pause') : ti('memory_panel.resume')}: ${getActionSnippet(memory.content)}`}
                        onClick={() => onSetMemoryEnabled(memory.id, !memoryEnabled)}
                      >
                        {memoryEnabled ? ti('memory_panel.pause') : ti('memory_panel.resume')}
                      </button>
                      <button
                        type="button"
                        aria-label={`${ti('memory_panel.delete')}: ${getActionSnippet(memory.content)}`}
                        title={`${ti('memory_panel.delete')}: ${getActionSnippet(memory.content)}`}
                        onClick={() => confirmDelete(memory.id)}
                      >
                        {ti('memory_panel.delete')}
                      </button>
                    </div>
                  </>
                )}
              </article>
            )
          })
        ) : (
          <div className="memory-empty">
            {ti('memory_panel.empty_long_term')}
          </div>
        )}
      </div>

      <div className="memory-card__daily">
        <div className="settings-section__title-row">
          <div>
            <h4>{ti('memory_panel.diary_preview_title')}</h4>
            <p className="settings-drawer__hint">
              {ti('memory_panel.diary_hint')}
            </p>
          </div>
        </div>

        <div className="memory-list">
          {dailyEntries.length ? (
            dailyEntries.map((entry) => {
              const entryFocused = focusedDailyIds.has(entry.id)
              return (
                <article
                  key={entry.id}
                  className={`memory-pill memory-pill--daily ${entryFocused ? 'is-focused' : ''}`.trim()}
                  data-memory-focus={entryFocused ? 'true' : undefined}
                >
                  <div className="memory-pill__meta-row">
                    <span className="memory-pill__category">
                      {entry.role === 'user'
                        ? ti('memory_panel.user_label')
                        : assistantName}
                    </span>
                    {entryFocused ? (
                      <span className="memory-pill__category memory-pill__category--focus">
                        {ti('memory_panel.focused_badge')}
                      </span>
                    ) : null}
                  </div>

                  {editingId === entry.id ? (
                    <div className="memory-pill__edit">
                      <textarea
                        rows={2}
                        value={editingContent}
                        aria-label={`${ti('memory_panel.edit')} ${ti('memory_panel.category.diary')}`}
                        onChange={(event) => setEditingContent(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' && !event.shiftKey) {
                            event.preventDefault()
                            saveDailyEdit(entry.id, entry.day)
                          }
                        }}
                        autoFocus
                      />
                      {editError ? (
                        <p className="memory-pill__error" role="alert" aria-live="assertive" aria-atomic="true">
                          {editError}
                        </p>
                      ) : null}
                      <div className="memory-pill__actions">
                        <button type="button" onClick={() => saveDailyEdit(entry.id, entry.day)}>
                          {ti('memory_panel.save')}
                        </button>
                        <button type="button" onClick={cancelEditing}>
                          {ti('memory_panel.cancel')}
                        </button>
                      </div>
                    </div>
                  ) : deletingId === entry.id ? (
                    <div className="memory-pill__confirm">
                      <p>{ti('memory_panel.confirm_delete_diary')}</p>
                      <div className="memory-pill__actions">
                        <button
                          type="button"
                          aria-label={`${ti('memory_panel.delete')}: ${entry.day} ${getActionSnippet(entry.content)}`}
                          title={`${ti('memory_panel.delete')}: ${entry.day} ${getActionSnippet(entry.content)}`}
                          onClick={() => {
                            onRemoveDailyEntry?.(entry.id, entry.day)
                            cancelDelete()
                          }}
                        >
                          {ti('memory_panel.delete')}
                        </button>
                        <button type="button" onClick={cancelDelete}>
                          {ti('memory_panel.cancel')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p>{entry.content}</p>
                      {(onUpdateDailyEntry || onRemoveDailyEntry) && (
                        <div className="memory-pill__actions">
                          {onUpdateDailyEntry && (
                            <button
                              type="button"
                              aria-label={`${ti('memory_panel.edit')}: ${entry.day} ${getActionSnippet(entry.content)}`}
                              title={`${ti('memory_panel.edit')}: ${entry.day} ${getActionSnippet(entry.content)}`}
                              onClick={() => startEditing(entry.id, entry.content)}
                            >
                              {ti('memory_panel.edit')}
                            </button>
                          )}
                          {onRemoveDailyEntry && (
                            <button
                              type="button"
                              aria-label={`${ti('memory_panel.delete')}: ${entry.day} ${getActionSnippet(entry.content)}`}
                              title={`${ti('memory_panel.delete')}: ${entry.day} ${getActionSnippet(entry.content)}`}
                              onClick={() => confirmDelete(entry.id)}
                            >
                              {ti('memory_panel.delete')}
                            </button>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </article>
              )
            })
          ) : (
            <div className="memory-empty">
              {ti('memory_panel.diary_empty')}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
