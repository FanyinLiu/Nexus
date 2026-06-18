import { useEffect, useMemo, useState } from 'react'
import { loadRelationshipHistory } from '../../autonomy/stateTimeline.ts'
import { buildMemoryMapViewModel, type MemoryGraphNodeKind } from '../memoryMap.ts'
import { parseMemorySourceRef } from '../sourceRefs.ts'
import type { ParsedMemorySourceRef } from '../sourceRefs.ts'
import { pickTranslatedUiText } from '../../../lib/uiLanguage.ts'
import type {
  DailyMemoryEntry,
  MemoryItem,
  MemorySearchMode,
  TranslationKey,
  UiLanguage,
} from '../../../types/index.ts'

const UI_LOCALE_BY_LANGUAGE: Record<UiLanguage, string> = {
  'zh-CN': 'zh-CN',
  'zh-TW': 'zh-TW',
  'en-US': 'en-US',
  ja: 'ja-JP',
  ko: 'ko-KR',
}

const MEMORY_MAP_COPY: Record<UiLanguage, {
  title: string
  hint: string
  nodes: string
  edges: string
  sources: string
  paused: string
  pinned: string
  relationshipSamples: string
  relationshipTitle: string
  relationshipEmpty: string
  sourceRef: string
}> = {
  'zh-CN': {
    title: '记忆地图',
    hint: '把长期记忆、日志、类别和来源引用整理成可检查的关系图；这里不新建记忆，只展示现有记忆如何连接。',
    nodes: '节点',
    edges: '连接',
    sources: '来源',
    paused: '暂停召回',
    pinned: '置顶',
    relationshipSamples: '关系样本',
    relationshipTitle: '关系时间线',
    relationshipEmpty: '还没有足够的关系片段形成时间线。',
    sourceRef: '来源',
  },
  'zh-TW': {
    title: '記憶地圖',
    hint: '把長期記憶、日誌、類別和來源引用整理成可檢查的關係圖；這裡不新增記憶，只展示現有記憶如何連接。',
    nodes: '節點',
    edges: '連接',
    sources: '來源',
    paused: '暫停召回',
    pinned: '置頂',
    relationshipSamples: '關係樣本',
    relationshipTitle: '關係時間線',
    relationshipEmpty: '還沒有足夠的關係片段形成時間線。',
    sourceRef: '來源',
  },
  'en-US': {
    title: 'Memory map',
    hint: 'Long-term memories, diary notes, categories, and source references are derived into an inspectable graph. Nothing new is stored here.',
    nodes: 'Nodes',
    edges: 'Links',
    sources: 'Sources',
    paused: 'Recall paused',
    pinned: 'Pinned',
    relationshipSamples: 'Relationship samples',
    relationshipTitle: 'Relationship timeline',
    relationshipEmpty: 'Not enough relationship-shaped moments yet.',
    sourceRef: 'Source',
  },
  ja: {
    title: 'メモリーマップ',
    hint: '長期記憶、日誌、カテゴリ、参照元を確認しやすい関係図に整理します。ここでは新しい記憶は保存しません。',
    nodes: 'ノード',
    edges: 'リンク',
    sources: '参照元',
    paused: '想起停止',
    pinned: '固定',
    relationshipSamples: '関係サンプル',
    relationshipTitle: '関係タイムライン',
    relationshipEmpty: '関係として表示できる断片はまだ十分ではありません。',
    sourceRef: '参照元',
  },
  ko: {
    title: '메모리 맵',
    hint: '장기 기억, 일지, 카테고리, 출처 참조를 점검 가능한 관계도로 정리합니다. 여기서는 새 기억을 저장하지 않습니다.',
    nodes: '노드',
    edges: '연결',
    sources: '출처',
    paused: '회상 중지',
    pinned: '고정',
    relationshipSamples: '관계 샘플',
    relationshipTitle: '관계 타임라인',
    relationshipEmpty: '관계 흐름으로 보여줄 만한 조각이 아직 충분하지 않습니다.',
    sourceRef: '출처',
  },
}

type MemoryPanelProps = {
  assistantName: string
  dailyEntries: DailyMemoryEntry[]
  embeddingModel: string
  memories: MemoryItem[]
  onAddMemory: (content: string) => void
  onClearDaily: () => void
  onRemove: (id: string) => void
  onRemoveDailyEntry?: (id: string, day: string) => void
  onSetMemoryEnabled?: (id: string, enabled: boolean) => void
  onOpenSourceRef?: (sourceRef: ParsedMemorySourceRef) => void
  onUpdateDailyEntry?: (id: string, day: string, content: string) => void
  onUpdateMemory: (id: string, content: string) => void
  onToggleMemoryPinned: (id: string) => void
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

const MEMORY_IMPORTANCE_KEY: Record<NonNullable<MemoryItem['importance']>, TranslationKey> = {
  low: 'memory_panel.importance.low',
  normal: 'memory_panel.importance.normal',
  high: 'memory_panel.importance.high',
  pinned: 'memory_panel.importance.pinned',
  reflection: 'memory_panel.importance.reflection',
}

const DAILY_SOURCE_KEY: Record<DailyMemoryEntry['source'], TranslationKey> = {
  chat: 'memory_panel.source.chat',
  voice: 'memory_panel.source.voice',
}

function isReflectionMemory(memory: MemoryItem): boolean {
  return memory.importance === 'reflection'
}

function isRelationshipMemory(memory: MemoryItem): boolean {
  return memory.kind === 'relationship'
    || memory.category === 'feedback'
    || memory.category === 'manual'
}

function isRelationshipInsightMemory(memory: MemoryItem): boolean {
  return isReflectionMemory(memory) || isRelationshipMemory(memory)
}

function formatNodeKind(kind: MemoryGraphNodeKind): string {
  return kind.replace(/_/g, ' ')
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

function formatMemoryTimestamp(value: string | undefined, uiLanguage: UiLanguage): string | null {
  const timestamp = Date.parse(value ?? '')
  if (!Number.isFinite(timestamp)) return null
  return new Intl.DateTimeFormat(UI_LOCALE_BY_LANGUAGE[uiLanguage], {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

function formatLongTermMemoryMeta(
  memory: MemoryItem,
  uiLanguage: UiLanguage,
  ti: (key: TranslationKey, params?: Parameters<typeof pickTranslatedUiText>[2]) => string,
): string[] {
  const meta = [
    ti('memory_panel.source', { value: memory.source || ti('common.none') }),
  ]

  if (memory.sourceRef) {
    meta.push(ti('memory_panel.source_ref', { value: memory.sourceRef }))
  }

  const createdAt = formatMemoryTimestamp(memory.createdAt, uiLanguage)
  if (createdAt) {
    meta.push(ti('memory_panel.created_at', { value: createdAt }))
  }

  if (memory.importance) {
    meta.push(ti('memory_panel.importance', { value: ti(MEMORY_IMPORTANCE_KEY[memory.importance]) }))
  }

  if (memory.reflectionTopic) {
    meta.push(ti('memory_panel.reflection_topic', { value: memory.reflectionTopic }))
  }

  if (typeof memory.reflectionConfidence === 'number') {
    meta.push(ti('memory_panel.reflection_confidence', {
      value: Math.round(memory.reflectionConfidence * 100),
    }))
  }

  if (typeof memory.recallCount === 'number' && memory.recallCount > 0) {
    meta.push(ti('memory_panel.recall_count', { count: memory.recallCount }))
  }

  if (memory.enabled === false) {
    meta.push(ti('memory_panel.recall_paused'))
  }

  const lastRecalledAt = formatMemoryTimestamp(memory.lastRecalledAt, uiLanguage)
  if (lastRecalledAt) {
    meta.push(ti('memory_panel.last_recalled_at', { value: lastRecalledAt }))
  }

  return meta
}

function formatDailyMemoryMeta(
  entry: DailyMemoryEntry,
  uiLanguage: UiLanguage,
  ti: (key: TranslationKey, params?: Parameters<typeof pickTranslatedUiText>[2]) => string,
): string[] {
  const createdAt = formatMemoryTimestamp(entry.createdAt, uiLanguage)
  return [
    ti('memory_panel.source', { value: ti(DAILY_SOURCE_KEY[entry.source]) }),
    ...(entry.sourceRef ? [ti('memory_panel.source_ref', { value: entry.sourceRef })] : []),
    ...(createdAt ? [ti('memory_panel.created_at', { value: createdAt })] : []),
  ]
}

export function MemoryPanel({
  assistantName,
  dailyEntries,
  embeddingModel,
  memories,
  onAddMemory,
  onClearDaily,
  onRemove,
  onRemoveDailyEntry,
  onSetMemoryEnabled,
  onOpenSourceRef,
  onUpdateDailyEntry,
  onUpdateMemory,
  onToggleMemoryPinned,
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
  const memoryMap = useMemo(
    () => buildMemoryMapViewModel(memories, dailyEntries, loadRelationshipHistory()),
    [dailyEntries, memories],
  )
  const memoryMapCopy = MEMORY_MAP_COPY[uiLanguage]
  const sourceNodes = memoryMap.nodes.filter((node) => node.kind === 'source')
  const topGraphNodes = memoryMap.nodes
    .filter((node) => (
      node.kind === 'category'
      || node.kind === 'source'
      || node.kind === 'relationship'
      || node.kind === 'relationship_state'
    ))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
  const relationshipInsightMemories = memories.filter(isRelationshipInsightMemory)
  const longTermMemories = memories.filter((memory) => !isRelationshipInsightMemory(memory))

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

  function renderSourceRefAction(sourceRef: string | undefined, content: string) {
    const parsed = parseMemorySourceRef(sourceRef)
    if (!parsed || (!parsed.canOpenHistory && !parsed.canOpenAutonomy) || !onOpenSourceRef) return null

    return (
      <button
        type="button"
        aria-label={`${ti('memory_panel.open_source')}: ${getActionSnippet(content)}`}
        title={`${ti('memory_panel.open_source')}: ${parsed.raw}`}
        onClick={() => onOpenSourceRef(parsed)}
      >
        {ti('memory_panel.open_source')}
      </button>
    )
  }

  function getMemoryBadge(memory: MemoryItem): string {
    if (isReflectionMemory(memory)) return ti('memory_panel.reflection_badge')
    if (isRelationshipMemory(memory)) return ti('memory_panel.relationship_badge')
    return getCategoryLabel(memory.category, uiLanguage)
  }

  function renderMemoryArticle(memory: MemoryItem) {
    const recallPaused = memory.enabled === false
    const recallToggleLabel = recallPaused
      ? ti('memory_panel.restore_recall')
      : ti('memory_panel.pause_recall')

    return (
      <article key={memory.id} className={`memory-pill${recallPaused ? ' is-disabled' : ''}`}>
        <span className="memory-pill__category">{getMemoryBadge(memory)}</span>

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
            <div className="memory-pill__meta-row" aria-label={ti('memory_panel.source_trace')}>
              {formatLongTermMemoryMeta(memory, uiLanguage, ti).map((value) => (
                <span key={value} className="memory-pill__meta">
                  {value}
                </span>
              ))}
            </div>
            <div className="memory-pill__actions">
              <button
                type="button"
                aria-label={`${memory.importance === 'pinned' ? ti('memory_panel.unpin') : ti('memory_panel.pin')}: ${getActionSnippet(memory.content)}`}
                title={`${memory.importance === 'pinned' ? ti('memory_panel.unpin') : ti('memory_panel.pin')}: ${getActionSnippet(memory.content)}`}
                onClick={() => onToggleMemoryPinned(memory.id)}
              >
                {memory.importance === 'pinned' ? ti('memory_panel.unpin') : ti('memory_panel.pin')}
              </button>
              {onSetMemoryEnabled ? (
                <button
                  type="button"
                  aria-label={`${recallToggleLabel}: ${getActionSnippet(memory.content)}`}
                  title={`${recallToggleLabel}: ${getActionSnippet(memory.content)}`}
                  onClick={() => onSetMemoryEnabled(memory.id, recallPaused)}
                >
                  {recallToggleLabel}
                </button>
              ) : null}
              {renderSourceRefAction(memory.sourceRef, memory.content)}
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
          {ti('memory_panel.category.long_term')} {longTermMemories.length}
        </span>
        <span className="memory-pill__category">
          {ti('memory_panel.relationship_reflection_count')} {relationshipInsightMemories.length}
        </span>
        <span className="memory-pill__category">
          {ti('memory_panel.category.diary')} {dailyEntries.length}
        </span>
        <span className="memory-pill__category">{embeddingModel}</span>
      </div>

      <div className="memory-card__insights">
        <div className="settings-section__title-row">
          <div>
            <h4>{memoryMapCopy.title}</h4>
            <p className="settings-drawer__hint">{memoryMapCopy.hint}</p>
          </div>
        </div>

        <div className="memory-card__meta">
          <span className="memory-pill__category">
            {memoryMapCopy.nodes} {memoryMap.nodes.length}
          </span>
          <span className="memory-pill__category">
            {memoryMapCopy.edges} {memoryMap.edges.length}
          </span>
          <span className="memory-pill__category">
            {memoryMapCopy.sources} {sourceNodes.length}
          </span>
          <span className="memory-pill__category">
            {memoryMapCopy.relationshipSamples} {memoryMap.summary.relationshipSampleCount}
          </span>
          <span className="memory-pill__category">
            {memoryMapCopy.paused} {memoryMap.summary.recallPausedCount}
          </span>
          <span className="memory-pill__category">
            {memoryMapCopy.pinned} {memoryMap.summary.pinnedCount}
          </span>
        </div>

        {topGraphNodes.length ? (
          <div className="memory-list">
            {topGraphNodes.map((node) => (
              <article key={node.id} className="memory-pill">
                <span className="memory-pill__category">{formatNodeKind(node.kind)}</span>
                <p>{node.label}</p>
                <div className="memory-pill__meta-row">
                  <span className="memory-pill__meta">{node.count} item(s)</span>
                  {node.sourceRef ? (
                    <span className="memory-pill__meta">{memoryMapCopy.sourceRef}: {node.sourceRef}</span>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        ) : null}

        <div className="settings-section__title-row">
          <div>
            <h4>{memoryMapCopy.relationshipTitle}</h4>
          </div>
        </div>
        <div className="memory-list">
          {memoryMap.relationshipTimeline.length ? (
            memoryMap.relationshipTimeline.map((item) => {
              const sourceAction = renderSourceRefAction(item.sourceRef, item.detail)
              return (
                <article key={item.id} className={`memory-pill${item.recallPaused ? ' is-disabled' : ''}`}>
                  <span className="memory-pill__category">{item.title}</span>
                  <p>{item.detail}</p>
                  <div className="memory-pill__meta-row">
                    <span className="memory-pill__meta">
                      {formatMemoryTimestamp(item.createdAt, uiLanguage) ?? item.createdAt}
                    </span>
                    {item.pinned ? <span className="memory-pill__meta">{memoryMapCopy.pinned}</span> : null}
                    {item.recallPaused ? <span className="memory-pill__meta">{memoryMapCopy.paused}</span> : null}
                    {item.sourceRef ? (
                      <span className="memory-pill__meta">{memoryMapCopy.sourceRef}: {item.sourceRef}</span>
                    ) : null}
                  </div>
                  {sourceAction ? (
                    <div className="memory-pill__actions">
                      {sourceAction}
                    </div>
                  ) : null}
                </article>
              )
            })
          ) : (
            <div className="memory-empty">
              {memoryMapCopy.relationshipEmpty}
            </div>
          )}
        </div>
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
          <button type="button" className="ghost-button" onClick={onClearDaily}>
            {ti('memory_panel.clear_diary')}
          </button>
        </div>
      </div>

      <div className="memory-card__insights">
        <div className="settings-section__title-row">
          <div>
            <h4>{ti('memory_panel.relationship_reflection_title')}</h4>
            <p className="settings-drawer__hint">
              {ti('memory_panel.relationship_reflection_hint')}
            </p>
          </div>
        </div>

        <div className="memory-list">
          {relationshipInsightMemories.length ? (
            relationshipInsightMemories.map(renderMemoryArticle)
          ) : (
            <div className="memory-empty">
              {ti('memory_panel.relationship_reflection_empty')}
            </div>
          )}
        </div>
      </div>

      <div className="memory-list">
        {longTermMemories.length ? (
          longTermMemories.map(renderMemoryArticle)
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
            dailyEntries.map((entry) => (
              <article key={entry.id} className="memory-pill memory-pill--daily">
                <span className="memory-pill__category">
                  {entry.role === 'user'
                    ? ti('memory_panel.user_label')
                    : assistantName}
                </span>

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
                    <div className="memory-pill__meta-row" aria-label={ti('memory_panel.source_trace')}>
                      {formatDailyMemoryMeta(entry, uiLanguage, ti).map((value) => (
                        <span key={value} className="memory-pill__meta">
                          {value}
                        </span>
                      ))}
                    </div>
                    {(onUpdateDailyEntry || onRemoveDailyEntry || (entry.sourceRef && onOpenSourceRef)) && (
                      <div className="memory-pill__actions">
                        {renderSourceRefAction(entry.sourceRef, entry.content)}
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
            ))
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
