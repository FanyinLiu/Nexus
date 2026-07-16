import { memo, useEffect, useMemo, useReducer, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { PetControlIcon } from '../../components/PetControlIcon'
import type { ConfirmFn } from '../../components/useConfirm'
import {
  clearRecentCompanionCheckInDecision,
  clearRecentCompanionSummary,
  loadRecentCompanionCheckInDecision,
  loadRecentCompanionSummary,
  recentCompanionCheckInDecisionToDecision,
  recentCompanionSummaryToQuietObservation,
  resolveDesktopContextDiagnostics,
  type DesktopContextDiagnosticText,
} from '../../features/context'
import {
  MEMORY_EMBEDDING_MODEL_OPTIONS,
  SCREEN_VLM_MODEL_OPTIONS,
} from '../../features/memory/constants'
import { resolveMemoryTransparencySummary } from '../../features/memory/memorySettingsView'
import type { ChatMemoryTraceFocusTarget } from '../../features/memory/traceDetails'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import type {
  AppSettings,
  DailyMemoryEntry,
  MemoryItem,
  MemorySearchMode,
  PlatformProfile,
  TranslationKey,
  UiLanguage,
} from '../../types'
import {
  SettingsV3Disclosure,
  SettingsV3Empty,
  SettingsV3Field,
  SettingsV3Notice,
  SettingsV3Page,
  SettingsV3Row,
  SettingsV3Section,
  SettingsV3Switch,
  SettingsV3Toolbar,
} from './SettingsV3Primitives'
import { CompanionMigrationAdapterV3, MemoryMigrationAdapterV3 } from './MemoryMigrationAdaptersV3'
import './settings-v3-collection.css'

type MemorySearchModeOption = {
  value: MemorySearchMode
  label: string
  hint: string
}

type StatusMessage = { ok: boolean; message: string } | null

export type MemorySectionV3Props = {
  active: boolean
  confirm: ConfirmFn
  draft: AppSettings
  platformProfile: PlatformProfile
  setDraft: Dispatch<SetStateAction<AppSettings>>
  memories: MemoryItem[]
  dailyMemoryEntries: DailyMemoryEntry[]
  memoryFocus?: ChatMemoryTraceFocusTarget | null
  uiLanguage: UiLanguage
  memorySearchModeOptions: MemorySearchModeOption[]
  selectedMemorySearchMode: MemorySearchModeOption
  exportingMemoryArchive: boolean
  importingMemoryArchive: boolean
  clearingMemoryArchive: boolean
  chatBusy: boolean
  memoryArchiveStatus: StatusMessage
  onExportMemoryArchive: () => void
  onImportMemoryArchive: () => void
  onClearMemoryArchive: () => void
  onAddManualMemory: (content: string) => void
  onUpdateMemory: (id: string, content: string) => void
  onSetMemoryEnabled: (id: string, enabled: boolean) => void
  onRemoveMemory: (id: string) => void
  onClearDailyMemory: () => void
  onUpdateDailyEntry?: (id: string, day: string, content: string) => void
  onRemoveDailyEntry?: (id: string, day: string) => void
}

const CATEGORY_KEYS: Record<MemoryItem['category'], TranslationKey> = {
  profile: 'memory_panel.category.profile',
  preference: 'memory_panel.category.preference',
  goal: 'memory_panel.category.goal',
  habit: 'memory_panel.category.habit',
  manual: 'memory_panel.category.manual',
  feedback: 'memory_panel.category.feedback',
  project: 'memory_panel.category.project',
  reference: 'memory_panel.category.reference',
}

function snippet(value: string) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > 76 ? `${normalized.slice(0, 76)}…` : normalized
}

export const MemorySectionV3 = memo(function MemorySectionV3({
  active,
  confirm,
  draft,
  platformProfile,
  setDraft,
  memories,
  dailyMemoryEntries,
  memoryFocus,
  uiLanguage,
  memorySearchModeOptions,
  selectedMemorySearchMode,
  exportingMemoryArchive,
  importingMemoryArchive,
  clearingMemoryArchive,
  chatBusy,
  memoryArchiveStatus,
  onExportMemoryArchive,
  onImportMemoryArchive,
  onClearMemoryArchive,
  onAddManualMemory,
  onUpdateMemory,
  onSetMemoryEnabled,
  onRemoveMemory,
  onClearDailyMemory,
  onUpdateDailyEntry,
  onRemoveDailyEntry,
}: MemorySectionV3Props) {
  const ti = (key: TranslationKey, params?: Parameters<typeof pickTranslatedUiText>[2]) =>
    pickTranslatedUiText(uiLanguage, key, params)
  const [manualMemory, setManualMemory] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingContent, setEditingContent] = useState('')
  const [editError, setEditError] = useState<string | null>(null)
  const [recentRevision, refreshRecent] = useReducer((value: number) => value + 1, 0)

  const focusedLongTermIds = useMemo(() => new Set([
    ...(memoryFocus?.longTermIds ?? []),
    ...(memoryFocus?.semanticIds ?? []),
  ]), [memoryFocus])
  const focusedDailyIds = useMemo(() => new Set([
    ...(memoryFocus?.dailyEntryIds ?? []),
    ...(memoryFocus?.semanticIds ?? []),
  ]), [memoryFocus])
  const focusedCount = focusedLongTermIds.size + focusedDailyIds.size
  const recentSummary = useMemo(() => {
    void recentRevision
    return loadRecentCompanionSummary()
  }, [recentRevision])
  const recentDecision = useMemo(() => {
    void recentRevision
    return loadRecentCompanionCheckInDecision()
  }, [recentRevision])

  const diagnostics = resolveDesktopContextDiagnostics({
    activeWindowContextEnabled: draft.activeWindowContextEnabled,
    clipboardContextEnabled: draft.clipboardContextEnabled,
    companionAwarenessPaused: draft.companionAwarenessPaused,
    contextAwarenessEnabled: draft.contextAwarenessEnabled,
    platformProfile,
    screenContextEnabled: draft.screenContextEnabled,
  })
  const transparency = resolveMemoryTransparencySummary({
    activeWindowContextEnabled: draft.activeWindowContextEnabled,
    clipboardContextEnabled: draft.clipboardContextEnabled,
    companionAwarenessPaused: draft.companionAwarenessPaused,
    contextAwarenessEnabled: draft.contextAwarenessEnabled,
    dailyEntries: dailyMemoryEntries,
    memories,
    memoryDailyRecallCount: draft.memoryDailyRecallCount,
    memoryLongTermRecallCount: draft.memoryLongTermRecallCount,
    memoryPaused: draft.memoryPaused,
    memorySemanticRecallCount: draft.memorySemanticRecallCount,
    screenContextEnabled: draft.screenContextEnabled,
    searchMode: draft.memorySearchMode,
    companionSummary: recentCompanionSummaryToQuietObservation(recentSummary, uiLanguage),
    companionCheckInDecision: recentCompanionCheckInDecisionToDecision(recentDecision),
  })
  const companionTransparencyView = transparency.companionAwarenessView
  const recentSummaryActivityLabel = companionTransparencyView.recentSummary.activityLabelKey
    ? ti(companionTransparencyView.recentSummary.activityLabelKey)
    : ''
  const recentSummaryText = companionTransparencyView.recentSummary.bodyParams
    ? ti(companionTransparencyView.recentSummary.bodyKey, {
        ...companionTransparencyView.recentSummary.bodyParams,
        ...(recentSummaryActivityLabel ? { activityLabel: recentSummaryActivityLabel } : {}),
      })
    : ti(companionTransparencyView.recentSummary.bodyKey)
  const clearUnavailableReason = companionTransparencyView.clearRecentSummaryAction.unavailableReason
  const modelReachBlockedBodyKey: TranslationKey | null = transparency.companionAwareness.modelReachBlockedReason === 'off'
    ? 'settings.memory.context.transparency_model_blocked_off'
    : transparency.companionAwareness.modelReachBlockedReason === 'paused'
      ? 'settings.memory.context.transparency_model_blocked_paused'
      : transparency.companionAwareness.modelReachBlockedReason === 'no_observation'
        ? 'settings.memory.context.transparency_model_blocked_no_observation'
        : null
  const clearUnavailableText = clearUnavailableReason === 'off'
    ? `${ti('settings.memory.context.transparency_status_off')} · ${ti('settings.memory.context.recent_summary_body_empty')}`
    : clearUnavailableReason === 'paused'
      ? `${ti('settings.memory.context.transparency_status_paused')} · ${ti('settings.memory.context.recent_summary_body_empty')}`
      : clearUnavailableReason === 'no_summary'
        ? ti('settings.memory.context.recent_summary_body_empty')
        : undefined
  const selectedEmbedding = MEMORY_EMBEDDING_MODEL_OPTIONS.find(
    (option) => option.value === draft.memoryEmbeddingModel,
  )

  const translateDiagnostic = (value: DesktopContextDiagnosticText) =>
    value.params ? ti(value.key, value.params) : ti(value.key)
  const clearRecent = () => {
    clearRecentCompanionCheckInDecision()
    clearRecentCompanionSummary()
    refreshRecent()
  }

  useEffect(() => {
    if (!focusedCount) return undefined
    const prefersReducedMotion = typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const frame = window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('[data-settings-memory-focus="true"]')
        ?.scrollIntoView({
          block: 'center',
          behavior: prefersReducedMotion ? 'auto' : 'smooth',
        })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [focusedCount])

  const startEdit = (id: string, content: string) => {
    setEditingId(id)
    setEditingContent(content)
    setEditError(null)
  }
  const cancelEdit = () => {
    setEditingId(null)
    setEditingContent('')
    setEditError(null)
  }
  const saveEdit = (id: string, day?: string) => {
    const content = editingContent.trim()
    if (!content) {
      setEditError(ti(day ? 'memory_panel.empty_diary_content' : 'memory_panel.empty_memory_content'))
      return
    }
    try {
      if (day) onUpdateDailyEntry?.(id, day, content)
      else onUpdateMemory(id, content)
      cancelEdit()
    } catch (error) {
      setEditError(error instanceof Error ? error.message : ti(
        day ? 'memory_panel.edit_diary_failed' : 'memory_panel.edit_memory_failed',
      ))
    }
  }
  const removeItem = async (id: string, day?: string) => {
    const accepted = await confirm({
      message: ti(day ? 'memory_panel.confirm_delete_diary' : 'memory_panel.confirm_delete_memory'),
      tone: 'danger',
    })
    if (!accepted) return
    if (day) onRemoveDailyEntry?.(id, day)
    else onRemoveMemory(id)
  }

  return (
    <SettingsV3Page className={active ? 'settings-v3-memory' : 'settings-v3-memory is-hidden'}>
      <SettingsV3Section title={ti('settings.memory.transparency.title')} hideHeader>
        <SettingsV3Row
          icon="thought"
          label={draft.memoryPaused
            ? ti('settings.memory.transparency.status_paused')
            : ti('settings.memory.transparency.status_active')}
          hint={draft.memoryPaused
            ? ti('settings.memory.transparency.paused_effect')
            : ti('settings.memory.transparency.active_effect')}
        >
          <SettingsV3Switch
            checked={!draft.memoryPaused}
            label={ti('settings.memory.transparency.enabled_label')}
            onChange={(enabled) => setDraft((previous) => ({ ...previous, memoryPaused: !enabled }))}
          />
        </SettingsV3Row>
        <SettingsV3Row
          icon="sparkles"
          label={ti('settings.memory.transparency.active_long_term')}
          meta={transparency.activeLongTermCount.toLocaleString(uiLanguage)}
        />
        <SettingsV3Row
          icon="clipboard"
          label={ti('settings.memory.transparency.daily_entries')}
          meta={transparency.dailyEntryCount.toLocaleString(uiLanguage)}
        />
        <SettingsV3Row
          icon="continuous"
          label={ti('settings.memory.transparency.context_status')}
          meta={transparency.contextReadEnabled
            ? ti('settings.memory.transparency.context_on')
            : ti('settings.memory.transparency.context_off')}
        />
      </SettingsV3Section>

      <SettingsV3Notice title={ti('settings.memory.transparency.storage_note')}>
        {ti('settings.memory.long_term.archive_note')}
      </SettingsV3Notice>

      {focusedCount ? (
        <SettingsV3Notice tone="success" title={ti('memory_panel.focused_badge')} announce>
          {focusedCount.toLocaleString(uiLanguage)} · {selectedMemorySearchMode.label}
        </SettingsV3Notice>
      ) : null}

      <SettingsV3Disclosure
        title={ti('settings.memory.context.continuity_title')}
        description={ti('settings.memory.context.continuity_description')}
      >
        <SettingsV3Row
          icon="thought"
          label={ti('settings.memory.context.transparency_title')}
          meta={ti(companionTransparencyView.statusLabelKey)}
        />
        <SettingsV3Row
          label={ti(companionTransparencyView.recentSummary.labelKey)}
          hint={recentSummaryText}
          meta={ti(companionTransparencyView.recentSummary.statusKey)}
        />
        {companionTransparencyView.detailRows.map((row) => (
          <SettingsV3Row
            key={row.id}
            label={ti(row.labelKey)}
            hint={ti(row.id === 'reaches_model' && modelReachBlockedBodyKey
              ? modelReachBlockedBodyKey
              : row.bodyKey)}
          />
        ))}
        <SettingsV3Row
          label={ti(companionTransparencyView.privacyBoundary.labelKey)}
          hint={ti(companionTransparencyView.privacyBoundary.bodyKey)}
        />
        <SettingsV3Row
          label={ti(companionTransparencyView.checkInStatus.labelKey)}
          hint={ti(companionTransparencyView.checkInStatus.bodyKey)}
          meta={ti(companionTransparencyView.checkInStatus.statusKey)}
        />
        <SettingsV3Row
          label={ti(companionTransparencyView.clearRecentSummaryAction.labelKey)}
          hint={clearUnavailableText}
          disabled={!companionTransparencyView.clearRecentSummaryAction.enabled}
        >
          <button
            type="button"
            className="settings-v3-action"
            disabled={!companionTransparencyView.clearRecentSummaryAction.enabled}
            title={clearUnavailableText ?? ti(companionTransparencyView.clearRecentSummaryAction.labelKey)}
            onClick={clearRecent}
          >
            {ti(companionTransparencyView.clearRecentSummaryAction.labelKey)}
          </button>
        </SettingsV3Row>
        <SettingsV3Row label={ti('settings.memory.context.companion_pause')}>
          <SettingsV3Switch
            checked={draft.companionAwarenessPaused}
            disabled={!draft.contextAwarenessEnabled}
            label={ti('settings.memory.context.companion_pause')}
            onChange={(paused) => setDraft((previous) => ({ ...previous, companionAwarenessPaused: paused }))}
          />
        </SettingsV3Row>
      </SettingsV3Disclosure>

      <SettingsV3Disclosure
        title={ti('settings.memory.context.sources_title')}
        description={ti('settings.memory.context.sources_description')}
      >
        <SettingsV3Row
          label={ti('settings.memory.context.enable')}
          hint={ti('settings.memory.context.enable_hint')}
        >
          <SettingsV3Switch
            checked={draft.contextAwarenessEnabled}
            disabled={!diagnostics.contextAwarenessAvailable}
            label={ti('settings.memory.context.enable')}
            onChange={(enabled) => setDraft((previous) => ({ ...previous, contextAwarenessEnabled: enabled }))}
          />
        </SettingsV3Row>
        <SettingsV3Row
          label={ti('settings.memory.context.reads_label')}
          hint={ti('settings.memory.context.reads_body')}
        />
        <SettingsV3Row
          label={ti('settings.memory.context.reply_use_label')}
          hint={ti('settings.memory.context.reply_use_body')}
        />
        <SettingsV3Row
          label={ti('settings.memory.context.local_storage_label')}
          hint={ti('settings.memory.context.local_storage_body')}
        />
        <SettingsV3Row
          label={ti('settings.memory.context.external_boundary_label')}
          hint={ti('settings.memory.context.external_boundary_body')}
        />
        {diagnostics.items.map((item) => (
          <SettingsV3Row
            key={item.id}
            label={translateDiagnostic(item.label)}
            hint={translateDiagnostic(item.hint)}
            meta={translateDiagnostic(item.status)}
            disabled={!item.available}
          />
        ))}
        {([
          ['clipboardContextEnabled', 'settings.memory.context.clipboard', diagnostics.clipboardAvailable],
          ['activeWindowContextEnabled', 'settings.memory.context.active_window', diagnostics.activeWindowAvailable],
          ['screenContextEnabled', 'settings.memory.context.screen_ocr', diagnostics.screenContextAvailable],
        ] as const).map(([field, label, available]) => (
          <SettingsV3Row key={field} label={ti(label)} disabled={!available}>
            <SettingsV3Switch
              checked={draft[field]}
              disabled={!draft.contextAwarenessEnabled || !available}
              label={ti(label)}
              onChange={(checked) => setDraft((previous) => ({ ...previous, [field]: checked }))}
            />
          </SettingsV3Row>
        ))}
        {draft.contextAwarenessEnabled && draft.screenContextEnabled ? (
          <>
            <SettingsV3Field label={ti('settings.memory.context.ocr_language')}>
              <input value={draft.screenOcrLanguage} onChange={(event) => setDraft((previous) => ({ ...previous, screenOcrLanguage: event.target.value }))} />
            </SettingsV3Field>
            <SettingsV3Row label={ti('settings.memory.context.vlm_enable')} hint={ti('settings.memory.context.vlm_note')}>
              <SettingsV3Switch checked={draft.screenVlmEnabled} label={ti('settings.memory.context.vlm_enable')} onChange={(checked) => setDraft((previous) => ({ ...previous, screenVlmEnabled: checked }))} />
            </SettingsV3Row>
            {draft.screenVlmEnabled ? (
              <>
                <SettingsV3Field label={ti('settings.memory.context.vlm_base_url')}><input value={draft.screenVlmBaseUrl} onChange={(event) => setDraft((previous) => ({ ...previous, screenVlmBaseUrl: event.target.value }))} /></SettingsV3Field>
                <SettingsV3Field label={ti('settings.memory.context.vlm_api_key')}><input type="password" value={draft.screenVlmApiKey} onChange={(event) => setDraft((previous) => ({ ...previous, screenVlmApiKey: event.target.value }))} /></SettingsV3Field>
                <SettingsV3Field label={ti('settings.memory.context.vlm_model_preset')}>
                  <select value={SCREEN_VLM_MODEL_OPTIONS.some((option) => option.value === draft.screenVlmModel) ? draft.screenVlmModel : '__custom__'} onChange={(event) => event.target.value !== '__custom__' && setDraft((previous) => ({ ...previous, screenVlmModel: event.target.value }))}>
                    {SCREEN_VLM_MODEL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{ti(option.label)}</option>)}
                    <option value="__custom__">{ti('settings.memory.custom_option')}</option>
                  </select>
                </SettingsV3Field>
                <SettingsV3Field label={ti('settings.memory.context.vlm_custom_model')}><input value={draft.screenVlmModel} onChange={(event) => setDraft((previous) => ({ ...previous, screenVlmModel: event.target.value }))} /></SettingsV3Field>
              </>
            ) : null}
          </>
        ) : null}
      </SettingsV3Disclosure>

      <SettingsV3Section
        title={ti('memory_panel.category.long_term')}
        description={ti('settings.memory.long_term.note')}
      >
        <div className="settings-v3-editor">
          <SettingsV3Field label={ti('memory_panel.manual_placeholder')}>
            <textarea
              rows={3}
              value={manualMemory}
              onChange={(event) => setManualMemory(event.target.value)}
            />
          </SettingsV3Field>
          <SettingsV3Toolbar>
            <button
              type="button"
              disabled={!manualMemory.trim()}
              onClick={() => {
                const content = manualMemory.trim()
                if (!content) return
                onAddManualMemory(content)
                setManualMemory('')
              }}
            >
              {ti('memory_panel.save_to_long_term')}
            </button>
          </SettingsV3Toolbar>
        </div>
        {memories.length ? (
          <ul className="settings-v3-collection">
            {memories.map((memory) => {
              const focused = focusedLongTermIds.has(memory.id)
              const enabled = memory.enabled !== false
              return (
                <li
                  key={memory.id}
                  className="settings-v3-collection-row"
                  data-settings-memory-focus={focused ? 'true' : undefined}
                >
                  {editingId === memory.id ? (
                    <div className="settings-v3-editor" style={{ gridColumn: '1 / -1' }}>
                      <SettingsV3Field label={ti('memory_panel.edit')}>
                        <textarea
                          rows={3}
                          autoFocus
                          value={editingContent}
                          onChange={(event) => setEditingContent(event.target.value)}
                        />
                      </SettingsV3Field>
                      {editError ? <SettingsV3Notice tone="error" title={editError} /> : null}
                      <SettingsV3Toolbar>
                        <button type="button" onClick={() => saveEdit(memory.id)}>{ti('memory_panel.save')}</button>
                        <button type="button" onClick={cancelEdit}>{ti('memory_panel.cancel')}</button>
                      </SettingsV3Toolbar>
                    </div>
                  ) : (
                    <>
                      <div className="settings-v3-collection-row__main">
                        <span className="settings-v3-chip-line">
                          <span>{ti(CATEGORY_KEYS[memory.category])}</span>
                          {!enabled ? <span>{ti('memory_panel.paused_badge')}</span> : null}
                          {focused ? <span>{ti('memory_panel.focused_badge')}</span> : null}
                        </span>
                        <span className="settings-v3-collection-row__title">{memory.content}</span>
                        <span className="settings-v3-collection-row__meta">{memory.source}</span>
                      </div>
                      <SettingsV3Toolbar>
                        <button
                          type="button"
                          title={`${ti('memory_panel.edit')}: ${snippet(memory.content)}`}
                          aria-label={`${ti('memory_panel.edit')}: ${snippet(memory.content)}`}
                          onClick={() => startEdit(memory.id, memory.content)}
                        ><PetControlIcon name="tuning" aria-hidden="true" /></button>
                        <button
                          type="button"
                          title={`${enabled ? ti('memory_panel.pause') : ti('memory_panel.resume')}: ${snippet(memory.content)}`}
                          aria-label={`${enabled ? ti('memory_panel.pause') : ti('memory_panel.resume')}: ${snippet(memory.content)}`}
                          onClick={() => onSetMemoryEnabled(memory.id, !enabled)}
                        ><PetControlIcon name={enabled ? 'pause' : 'play'} aria-hidden="true" /></button>
                        <button
                          type="button"
                          className="is-danger"
                          title={`${ti('memory_panel.delete')}: ${snippet(memory.content)}`}
                          aria-label={`${ti('memory_panel.delete')}: ${snippet(memory.content)}`}
                          onClick={() => void removeItem(memory.id)}
                        ><PetControlIcon name="trash" aria-hidden="true" /></button>
                      </SettingsV3Toolbar>
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        ) : <SettingsV3Empty title={ti('memory_panel.empty_long_term')} />}
      </SettingsV3Section>

      <SettingsV3Disclosure
        title={ti('memory_panel.diary_preview_title')}
        description={`${dailyMemoryEntries.length.toLocaleString(uiLanguage)} · ${ti('memory_panel.diary_hint')}`}
      >
        {dailyMemoryEntries.length ? (
          <ul className="settings-v3-collection">
            {dailyMemoryEntries.map((entry) => {
              const focused = focusedDailyIds.has(entry.id)
              return (
                <li
                  key={entry.id}
                  className="settings-v3-collection-row"
                  data-settings-memory-focus={focused ? 'true' : undefined}
                >
                  {editingId === entry.id ? (
                    <div className="settings-v3-editor" style={{ gridColumn: '1 / -1' }}>
                      <SettingsV3Field label={ti('memory_panel.edit')}>
                        <textarea rows={3} autoFocus value={editingContent} onChange={(event) => setEditingContent(event.target.value)} />
                      </SettingsV3Field>
                      {editError ? <SettingsV3Notice tone="error" title={editError} /> : null}
                      <SettingsV3Toolbar>
                        <button type="button" onClick={() => saveEdit(entry.id, entry.day)}>{ti('memory_panel.save')}</button>
                        <button type="button" onClick={cancelEdit}>{ti('memory_panel.cancel')}</button>
                      </SettingsV3Toolbar>
                    </div>
                  ) : (
                    <>
                      <div className="settings-v3-collection-row__main">
                        <span className="settings-v3-chip-line">
                          <span>{entry.role === 'user' ? ti('memory_panel.user_label') : draft.companionName}</span>
                          {focused ? <span>{ti('memory_panel.focused_badge')}</span> : null}
                        </span>
                        <span className="settings-v3-collection-row__title">{entry.content}</span>
                        <span className="settings-v3-collection-row__meta">{entry.day} · {entry.source}</span>
                      </div>
                      <SettingsV3Toolbar>
                        {onUpdateDailyEntry ? <button type="button" aria-label={`${ti('memory_panel.edit')}: ${snippet(entry.content)}`} title={`${ti('memory_panel.edit')}: ${snippet(entry.content)}`} onClick={() => startEdit(entry.id, entry.content)}><PetControlIcon name="tuning" aria-hidden="true" /></button> : null}
                        {onRemoveDailyEntry ? <button type="button" className="is-danger" aria-label={`${ti('memory_panel.delete')}: ${snippet(entry.content)}`} title={`${ti('memory_panel.delete')}: ${snippet(entry.content)}`} onClick={() => void removeItem(entry.id, entry.day)}><PetControlIcon name="trash" aria-hidden="true" /></button> : null}
                      </SettingsV3Toolbar>
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        ) : <SettingsV3Empty title={ti('memory_panel.diary_empty')} />}
      </SettingsV3Disclosure>

      <SettingsV3Disclosure
        title={ti('settings.memory.long_term.search_mode')}
        description={selectedMemorySearchMode.hint}
      >
        <SettingsV3Field label={ti('settings.memory.long_term.search_mode')} hint={selectedMemorySearchMode.hint}>
          <select
            value={draft.memorySearchMode}
            onChange={(event) => setDraft((previous) => ({
              ...previous,
              memorySearchMode: event.target.value as MemorySearchMode,
            }))}
          >
            {memorySearchModeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </SettingsV3Field>
        <SettingsV3Field
          label={ti('settings.memory.long_term.embedding_preset')}
          hint={selectedEmbedding?.hint ? ti(selectedEmbedding.hint) : ti('settings.memory.long_term.embedding_custom_hint')}
        >
          <select
            value={selectedEmbedding?.value ?? '__custom__'}
            onChange={(event) => {
              if (event.target.value === '__custom__') return
              setDraft((previous) => ({ ...previous, memoryEmbeddingModel: event.target.value }))
            }}
          >
            {MEMORY_EMBEDDING_MODEL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{ti(option.label)}</option>)}
            <option value="__custom__">{ti('settings.memory.custom_option')}</option>
          </select>
        </SettingsV3Field>
        <SettingsV3Field label={ti('settings.memory.long_term.embedding_custom_model')}>
          <input value={draft.memoryEmbeddingModel} onChange={(event) => setDraft((previous) => ({ ...previous, memoryEmbeddingModel: event.target.value }))} />
        </SettingsV3Field>
        {([
          ['memoryLongTermRecallCount', 'settings.memory.long_term.recall_long_term', 8],
          ['memoryDailyRecallCount', 'settings.memory.long_term.recall_diary', 8],
          ['memorySemanticRecallCount', 'settings.memory.long_term.recall_semantic', 8],
          ['memoryDiaryRetentionDays', 'settings.memory.long_term.diary_retention', 30],
        ] as const).map(([field, label, max]) => (
          <SettingsV3Field key={field} label={ti(label)}>
            <input
              type="number"
              min={1}
              max={max}
              value={draft[field]}
              onChange={(event) => setDraft((previous) => ({ ...previous, [field]: Number(event.target.value) }))}
            />
          </SettingsV3Field>
        ))}
      </SettingsV3Disclosure>

      <SettingsV3Disclosure
        title={ti('settings.memory.long_term.archive_note')}
        description={ti('settings.memory.transparency.storage_note')}
      >
        <SettingsV3Toolbar>
          <button type="button" disabled={exportingMemoryArchive} onClick={onExportMemoryArchive}>{exportingMemoryArchive ? ti('settings.memory.long_term.exporting') : ti('settings.memory.long_term.export')}</button>
          <button type="button" disabled={importingMemoryArchive || chatBusy} onClick={onImportMemoryArchive}>{importingMemoryArchive ? ti('settings.memory.long_term.importing') : ti('settings.memory.long_term.import')}</button>
        </SettingsV3Toolbar>
        {memoryArchiveStatus ? <SettingsV3Notice tone={memoryArchiveStatus.ok ? 'success' : 'error'} title={memoryArchiveStatus.message} announce /> : null}
        <MemoryMigrationAdapterV3 uiLanguage={uiLanguage} confirm={confirm} />
        <CompanionMigrationAdapterV3 uiLanguage={uiLanguage} confirm={confirm} />
      </SettingsV3Disclosure>

      <SettingsV3Disclosure
        title={ti('settings.memory.long_term.clear')}
        description={ti('settings.memory.long_term.archive_note')}
      >
        <SettingsV3Notice tone="warning" title={ti('settings.memory.long_term.clear')}>
          {ti('settings.memory.long_term.archive_note')}
        </SettingsV3Notice>
        <SettingsV3Toolbar>
          <button type="button" className="is-danger" disabled={clearingMemoryArchive || chatBusy} onClick={onClearMemoryArchive}>{clearingMemoryArchive ? ti('settings.memory.long_term.clearing') : ti('settings.memory.long_term.clear')}</button>
          <button type="button" className="is-danger" disabled={!dailyMemoryEntries.length || chatBusy} onClick={onClearDailyMemory}>{ti('memory_panel.clear_diary')}</button>
        </SettingsV3Toolbar>
      </SettingsV3Disclosure>
    </SettingsV3Page>
  )
})
