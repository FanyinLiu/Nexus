import { memo, useEffect, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { MemoryPanel } from '../../features/memory/components'
import { MEMORY_EMBEDDING_MODEL_OPTIONS, SCREEN_VLM_MODEL_OPTIONS } from '../../features/memory/constants'
import { resolveMemoryTransparencySummary } from '../../features/memory/memorySettingsView'
import {
  clearRecentCompanionSummary,
  loadRecentCompanionSummary,
  recentCompanionSummaryToQuietObservation,
} from '../../features/context'
import type { ChatMemoryTraceFocusTarget } from '../../features/memory/traceDetails.ts'
import {
  getPlatformDependencyHint,
  isDesktopContextActiveWindowAvailable,
  isDesktopContextClipboardAvailable,
  isDesktopContextScreenshotAvailable,
} from '../../lib/platformProfile'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import { NumberField, TextField, ToggleField } from '../settingsFields'
import type {
  AppSettings,
  DailyMemoryEntry,
  MemoryItem,
  MemorySearchMode,
  PlatformProfile,
  UiLanguage,
} from '../../types'

type MemorySearchModeOption = {
  value: MemorySearchMode
  label: string
  hint: string
}

type StatusMessage = {
  ok: boolean
  message: string
} | null

type MemorySectionProps = {
  active: boolean
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

export const MemorySection = memo(function MemorySection({
  active,
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
}: MemorySectionProps) {
  const [recentCompanionSummary, setRecentCompanionSummary] = useState(() => loadRecentCompanionSummary())
  useEffect(() => {
    if (draft.contextAwarenessEnabled && !draft.companionAwarenessPaused) return
    clearRecentCompanionSummary()
  }, [draft.companionAwarenessPaused, draft.contextAwarenessEnabled])

  const effectiveRecentCompanionSummary = draft.contextAwarenessEnabled && !draft.companionAwarenessPaused
    ? recentCompanionSummary
    : null
  const clearCompanionSummaryState = () => {
    clearRecentCompanionSummary()
    setRecentCompanionSummary(null)
  }
  const ti = (key: Parameters<typeof pickTranslatedUiText>[1]) => pickTranslatedUiText(uiLanguage, key)
  const tiParam = (
    key: Parameters<typeof pickTranslatedUiText>[1],
    params: Parameters<typeof pickTranslatedUiText>[2],
  ) => pickTranslatedUiText(uiLanguage, key, params)
  const formatPlatformHint = (reason: string | null) => {
    if (!reason) return null
    if (reason === 'unsupported') return ti('settings.platform.unsupported')
    if (reason === 'unavailable') return ti('settings.platform.unavailable')
    return tiParam('settings.platform.unavailable_dependency', { dependency: reason })
  }
  const activeWindowContextAvailable = isDesktopContextActiveWindowAvailable(platformProfile)
  const clipboardContextAvailable = isDesktopContextClipboardAvailable(platformProfile)
  const screenContextAvailable = isDesktopContextScreenshotAvailable(platformProfile)
  const contextAwarenessAvailable = activeWindowContextAvailable
    || clipboardContextAvailable
    || screenContextAvailable
  const activeWindowPlatformHint = formatPlatformHint(getPlatformDependencyHint(
    platformProfile,
    platformProfile.desktopContext.activeWindowSupported,
    platformProfile.desktopContext.activeWindowAvailable,
    platformProfile.desktopContext.activeWindowDependencyHint,
  ))
  const clipboardPlatformHint = formatPlatformHint(getPlatformDependencyHint(
    platformProfile,
    platformProfile.desktopContext.clipboardSupported,
    platformProfile.desktopContext.clipboardAvailable,
    null,
  ))
  const screenPlatformHint = formatPlatformHint(getPlatformDependencyHint(
    platformProfile,
    platformProfile.desktopContext.screenshotSupported,
    platformProfile.desktopContext.screenshotAvailable,
    platformProfile.desktopContext.screenshotDependencyHint,
  ))
  const resolveContextStatusLabel = (available: boolean, enabled: boolean) => {
    if (!available) return ti('settings.memory.context.status_unavailable')
    if (enabled) return ti('settings.memory.context.status_enabled')
    if (draft.contextAwarenessEnabled) return ti('settings.memory.context.status_ready')
    return ti('settings.memory.context.status_off')
  }
  const contextStatusItems = [
    {
      id: 'companion-continuity',
      label: ti('settings.memory.context.companion_awareness'),
      status: draft.contextAwarenessEnabled && !draft.companionAwarenessPaused
        ? ti('settings.memory.context.status_enabled')
        : draft.contextAwarenessEnabled
          ? ti('settings.memory.context.status_paused')
          : ti('settings.memory.context.status_off'),
      hint: ti('settings.memory.context.companion_awareness_hint'),
      active: draft.contextAwarenessEnabled && !draft.companionAwarenessPaused,
      available: contextAwarenessAvailable,
    },
    {
      id: 'active-window',
      label: ti('settings.memory.context.active_window'),
      status: resolveContextStatusLabel(
        activeWindowContextAvailable,
        draft.contextAwarenessEnabled && draft.activeWindowContextEnabled && activeWindowContextAvailable,
      ),
      hint: activeWindowPlatformHint ?? ti('settings.memory.context.active_window_hint'),
      active: draft.contextAwarenessEnabled && draft.activeWindowContextEnabled && activeWindowContextAvailable,
      available: activeWindowContextAvailable,
    },
    {
      id: 'clipboard',
      label: ti('settings.memory.context.clipboard'),
      status: resolveContextStatusLabel(
        clipboardContextAvailable,
        draft.contextAwarenessEnabled && draft.clipboardContextEnabled && clipboardContextAvailable,
      ),
      hint: clipboardPlatformHint ?? ti('settings.memory.context.clipboard_hint'),
      active: draft.contextAwarenessEnabled && draft.clipboardContextEnabled && clipboardContextAvailable,
      available: clipboardContextAvailable,
    },
    {
      id: 'screen-ocr',
      label: ti('settings.memory.context.screen_ocr'),
      status: resolveContextStatusLabel(
        screenContextAvailable,
        draft.contextAwarenessEnabled && draft.screenContextEnabled && screenContextAvailable,
      ),
      hint: screenPlatformHint ?? ti('settings.memory.context.screen_ocr_hint'),
      active: draft.contextAwarenessEnabled && draft.screenContextEnabled && screenContextAvailable,
      available: screenContextAvailable,
    },
  ]
  const selectedMemoryEmbeddingModel = MEMORY_EMBEDDING_MODEL_OPTIONS.find((option) => (
    option.value === draft.memoryEmbeddingModel
  ))
  const memoryTransparencySummary = resolveMemoryTransparencySummary({
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
    companionSummary: recentCompanionSummaryToQuietObservation(effectiveRecentCompanionSummary),
  })
  const companionTransparency = memoryTransparencySummary.companionAwareness
  const companionTransparencyStatusText = (() => {
    switch (companionTransparency.status) {
      case 'paused':
        return ti('settings.memory.context.transparency_status_paused')
      case 'watching_for_away_activity':
        return ti('settings.memory.context.transparency_status_waiting')
      case 'summarizing_quietly':
        return ti('settings.memory.context.transparency_status_summarizing')
      case 'off':
      default:
        return ti('settings.memory.context.transparency_status_off')
    }
  })()

  return (
    <section className={`settings-section settings-memory-section ${active ? 'is-active' : 'is-hidden'}`}>
      <div className="settings-mini-group settings-memory-group settings-memory-transparency">
        <div className="settings-mini-group__head">
          <h5>{ti('settings.memory.transparency.title')}</h5>
          <span>{ti('settings.memory.transparency.note')}</span>
        </div>

        <div className="settings-memory-transparency__grid">
          <div className="settings-control-card settings-memory-transparency__card">
            <strong>
              {memoryTransparencySummary.memoryPaused
                ? ti('settings.memory.transparency.status_paused')
                : ti('settings.memory.transparency.status_active')}
            </strong>
            <span>
              {memoryTransparencySummary.memoryPaused
                ? ti('settings.memory.transparency.paused_effect')
                : ti('settings.memory.transparency.active_effect')}
            </span>
          </div>
          <div className="settings-control-card settings-memory-transparency__card">
            <strong>{memoryTransparencySummary.activeLongTermCount}</strong>
            <span>{ti('settings.memory.transparency.active_long_term')}</span>
          </div>
          <div className="settings-control-card settings-memory-transparency__card">
            <strong>{memoryTransparencySummary.dailyEntryCount}</strong>
            <span>{ti('settings.memory.transparency.daily_entries')}</span>
          </div>
          <div className="settings-control-card settings-memory-transparency__card">
            <strong>
              {memoryTransparencySummary.contextReadEnabled
                ? ti('settings.memory.transparency.context_on')
                : ti('settings.memory.transparency.context_off')}
            </strong>
            <span>{ti('settings.memory.transparency.context_status')}</span>
          </div>
        </div>

        <div className="settings-control-card settings-memory-control">
          <ToggleField
            label={ti('settings.memory.transparency.pause')}
            field="memoryPaused"
            draft={draft}
            setDraft={setDraft}
          />
        </div>

        <p className="settings-mini-group__note settings-memory-note">
          {ti('settings.memory.transparency.storage_note')}
        </p>
      </div>

      <div className="settings-mini-group settings-memory-group">
        <div className="settings-mini-group__head">
          <h5>{ti('settings.memory.context.title')}</h5>
          <span>{ti('settings.memory.context.note')}</span>
        </div>

        <div className="settings-memory-context-status-grid">
          {contextStatusItems.map((item) => (
            <div
              key={item.id}
              className={
                'settings-control-card settings-memory-context-status'
                + (item.active ? ' is-active' : '')
                + (!item.available ? ' is-unavailable' : '')
              }
            >
              <div className="settings-memory-context-status__head">
                <strong>{item.label}</strong>
                <span>{item.status}</span>
              </div>
              <p>{item.hint}</p>
            </div>
          ))}
        </div>

        <p className="settings-mini-group__note settings-memory-note">
          {ti('settings.memory.context.privacy_note')}
        </p>

        <div className="settings-control-card settings-memory-context-transparency">
          <div className="settings-memory-context-status__head">
            <strong>{ti('settings.memory.context.transparency_title')}</strong>
            <span>{companionTransparencyStatusText}</span>
          </div>
          <p>{ti('settings.memory.context.transparency_observes')}</p>
          <p>{ti('settings.memory.context.transparency_model')}</p>
          <p>{ti('settings.memory.context.transparency_storage')}</p>
          <div className="settings-action-row settings-memory-context-actions">
            <button
              type="button"
              className="ghost-button"
              disabled={!companionTransparency.canClearRecentSummary}
              title={ti('settings.memory.context.clear_recent_summary')}
              onClick={() => {
                clearRecentCompanionSummary()
                setRecentCompanionSummary(null)
              }}
            >
              {ti('settings.memory.context.clear_recent_summary')}
            </button>
          </div>
        </div>

        <div className="settings-control-card settings-memory-control">
          <label className="settings-toggle">
            <span>{ti('settings.memory.context.enable')}</span>
            <input
              type="checkbox"
              checked={draft.contextAwarenessEnabled}
              disabled={!contextAwarenessAvailable}
              onChange={(event) => {
                const enabled = event.target.checked
                if (!enabled) clearCompanionSummaryState()
                setDraft((prev) => ({ ...prev, contextAwarenessEnabled: enabled }))
              }}
            />
          </label>
        </div>
        <div className="settings-control-card settings-memory-control">
          <label className="settings-toggle">
            <span>{ti('settings.memory.context.companion_pause')}</span>
            <input
              type="checkbox"
              checked={draft.companionAwarenessPaused}
              disabled={!draft.contextAwarenessEnabled}
              onChange={(event) => {
                const paused = event.target.checked
                if (paused) clearCompanionSummaryState()
                setDraft((prev) => ({ ...prev, companionAwarenessPaused: paused }))
              }}
            />
          </label>
        </div>
        <div className="settings-control-card settings-memory-control">
          <ToggleField
            label={ti('settings.memory.context.clipboard')}
            field="clipboardContextEnabled"
            disabled={!draft.contextAwarenessEnabled || !clipboardContextAvailable}
            draft={draft}
            setDraft={setDraft}
          />
        </div>
        <div className="settings-control-card settings-memory-control">
          <ToggleField
            label={ti('settings.memory.context.active_window')}
            field="activeWindowContextEnabled"
            disabled={!draft.contextAwarenessEnabled || !activeWindowContextAvailable}
            draft={draft}
            setDraft={setDraft}
          />
        </div>
        <div className="settings-control-card settings-memory-control">
          <ToggleField
            label={ti('settings.memory.context.screen_ocr')}
            field="screenContextEnabled"
            disabled={!draft.contextAwarenessEnabled || !screenContextAvailable}
            draft={draft}
            setDraft={setDraft}
          />
        </div>

        {clipboardPlatformHint ? (
          <p className="settings-mini-group__note settings-memory-note">
            {ti('settings.memory.context.clipboard')}: {clipboardPlatformHint}
          </p>
        ) : null}

        {activeWindowPlatformHint ? (
          <p className="settings-mini-group__note settings-memory-note">
            {ti('settings.memory.context.active_window')}: {activeWindowPlatformHint}
          </p>
        ) : null}

        {screenPlatformHint ? (
          <p className="settings-mini-group__note settings-memory-note">
            {ti('settings.memory.context.screen_ocr')}: {screenPlatformHint}
          </p>
        ) : null}

        {draft.contextAwarenessEnabled && draft.screenContextEnabled ? (
          <>
            <div className="settings-control-card settings-memory-field">
              <TextField
                label={ti('settings.memory.context.ocr_language')}
                field="screenOcrLanguage"
                placeholder="chi_sim+eng"
                draft={draft}
                setDraft={setDraft}
              />
            </div>

            <div className="settings-control-card settings-memory-control">
              <ToggleField
                label={ti('settings.memory.context.vlm_enable')}
                field="screenVlmEnabled"
                draft={draft}
                setDraft={setDraft}
              />
            </div>

            <p className="settings-mini-group__note settings-memory-note">
              {ti('settings.memory.context.vlm_note')}
            </p>

            {draft.screenVlmEnabled ? (
              <>
                <div className="settings-control-card settings-memory-field">
                  <TextField
                    label={ti('settings.memory.context.vlm_base_url')}
                    field="screenVlmBaseUrl"
                    placeholder="https://api.openai.com/v1"
                    draft={draft}
                    setDraft={setDraft}
                  />
                </div>

                <div className="settings-control-card settings-memory-field">
                  <TextField
                    label={ti('settings.memory.context.vlm_api_key')}
                    field="screenVlmApiKey"
                    type="password"
                    placeholder={ti('settings.memory.context.vlm_api_key_placeholder')}
                    draft={draft}
                    setDraft={setDraft}
                  />
                </div>

                <label className="settings-control-card settings-memory-field">
                  <span>{ti('settings.memory.context.vlm_model_preset')}</span>
                  <select
                    value={SCREEN_VLM_MODEL_OPTIONS.some((option) => option.value === draft.screenVlmModel)
                      ? draft.screenVlmModel
                      : '__custom__'}
                    onChange={(event) => {
                      if (event.target.value === '__custom__') return
                      setDraft((prev) => ({
                        ...prev,
                        screenVlmModel: event.target.value,
                      }))
                    }}
                  >
                    {SCREEN_VLM_MODEL_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {ti(option.label)}
                      </option>
                    ))}
                    <option value="__custom__">{ti('settings.memory.custom_option')}</option>
                  </select>
                </label>

                <p className="settings-mini-group__note settings-memory-note">
                  {(() => {
                    const vlmHint = SCREEN_VLM_MODEL_OPTIONS.find((option) => option.value === draft.screenVlmModel)?.hint
                    return vlmHint ? ti(vlmHint) : ti('settings.memory.context.vlm_custom_hint')
                  })()}
                </p>

                <div className="settings-control-card settings-memory-field">
                  <TextField
                    label={ti('settings.memory.context.vlm_custom_model')}
                    field="screenVlmModel"
                    placeholder="gpt-4o-mini"
                    draft={draft}
                    setDraft={setDraft}
                  />
                </div>
              </>
            ) : null}
          </>
        ) : null}
      </div>

      <div className="settings-mini-group settings-memory-group">
        <div className="settings-mini-group__head">
          <h5>{ti('settings.memory.long_term.title')}</h5>
          <span>{ti('settings.memory.long_term.note')}</span>
        </div>

        <label className="settings-control-card settings-memory-field">
          <span>{ti('settings.memory.long_term.search_mode')}</span>
          <select
            value={draft.memorySearchMode}
            onChange={(event) =>
              setDraft((prev) => ({
                ...prev,
                memorySearchMode: event.target.value as MemorySearchMode,
              }))
            }
          >
            {memorySearchModeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <p className="settings-mini-group__note settings-memory-note">
          {selectedMemorySearchMode.hint}
        </p>

        <label className="settings-control-card settings-memory-field">
          <span>{ti('settings.memory.long_term.embedding_preset')}</span>
          <select
            value={selectedMemoryEmbeddingModel?.value ?? '__custom__'}
            onChange={(event) => {
              if (event.target.value === '__custom__') return

              setDraft((prev) => ({
                ...prev,
                memoryEmbeddingModel: event.target.value,
              }))
            }}
          >
            {MEMORY_EMBEDDING_MODEL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {ti(option.label)}
              </option>
            ))}
            <option value="__custom__">{ti('settings.memory.custom_option')}</option>
          </select>
        </label>

        <p className="settings-mini-group__note settings-memory-note">
          {selectedMemoryEmbeddingModel?.hint
            ? ti(selectedMemoryEmbeddingModel.hint)
            : ti('settings.memory.long_term.embedding_custom_hint')}
        </p>

        <div className="settings-control-card settings-memory-field">
          <TextField
            label={ti('settings.memory.long_term.embedding_custom_model')}
            field="memoryEmbeddingModel"
            draft={draft}
            setDraft={setDraft}
          />
        </div>

        <div className="settings-grid settings-grid--two settings-memory-recall-grid">
          <div className="settings-control-card settings-memory-field">
            <NumberField
              label={ti('settings.memory.long_term.recall_long_term')}
              field="memoryLongTermRecallCount"
              min={1} max={8} step={1}
              draft={draft}
              setDraft={setDraft}
            />
          </div>
          <div className="settings-control-card settings-memory-field">
            <NumberField
              label={ti('settings.memory.long_term.recall_diary')}
              field="memoryDailyRecallCount"
              min={1} max={8} step={1}
              draft={draft}
              setDraft={setDraft}
            />
          </div>
          <div className="settings-control-card settings-memory-field">
            <NumberField
              label={ti('settings.memory.long_term.recall_semantic')}
              field="memorySemanticRecallCount"
              min={1} max={8} step={1}
              draft={draft}
              setDraft={setDraft}
            />
          </div>
          <div className="settings-control-card settings-memory-field">
            <NumberField
              label={ti('settings.memory.long_term.diary_retention')}
              field="memoryDiaryRetentionDays"
              min={1} max={30} step={1}
              draft={draft}
              setDraft={setDraft}
            />
          </div>
        </div>

        <p className="settings-mini-group__note settings-memory-note">
          {ti('settings.memory.long_term.archive_note')}
        </p>

        <div className="settings-action-row settings-memory-archive-actions">
          <button
            type="button"
            className="ghost-button"
            onClick={onExportMemoryArchive}
            disabled={exportingMemoryArchive}
          >
            {exportingMemoryArchive ? ti('settings.memory.long_term.exporting') : ti('settings.memory.long_term.export')}
          </button>

          <button
            type="button"
            className="ghost-button"
            onClick={onImportMemoryArchive}
            disabled={importingMemoryArchive || chatBusy}
          >
            {importingMemoryArchive ? ti('settings.memory.long_term.importing') : ti('settings.memory.long_term.import')}
          </button>

          <button
            type="button"
            className="ghost-button"
            onClick={onClearMemoryArchive}
            disabled={clearingMemoryArchive || chatBusy}
          >
            {clearingMemoryArchive ? ti('settings.memory.long_term.clearing') : ti('settings.memory.long_term.clear')}
          </button>
        </div>

        {memoryArchiveStatus ? (
          <div
            className={memoryArchiveStatus.ok ? 'settings-test-result is-success' : 'settings-test-result is-error'}
            role={memoryArchiveStatus.ok ? 'status' : 'alert'}
            aria-live={memoryArchiveStatus.ok ? 'polite' : 'assertive'}
            aria-atomic="true"
          >
            {memoryArchiveStatus.message}
          </div>
        ) : null}
      </div>

      <MemoryPanel
        assistantName={draft.companionName}
        memories={memories}
        dailyEntries={dailyMemoryEntries}
        focus={memoryFocus}
        searchMode={draft.memorySearchMode}
        embeddingModel={draft.memoryEmbeddingModel}
        uiLanguage={uiLanguage}
        onAddMemory={onAddManualMemory}
        onUpdateMemory={onUpdateMemory}
        onSetMemoryEnabled={onSetMemoryEnabled}
        onRemove={onRemoveMemory}
        onClearDaily={onClearDailyMemory}
        onUpdateDailyEntry={onUpdateDailyEntry}
        onRemoveDailyEntry={onRemoveDailyEntry}
      />
    </section>
  )
})
