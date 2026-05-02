import { memo } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { MemoryPanel } from '../../features/memory/components'
import { MEMORY_EMBEDDING_MODEL_OPTIONS, SCREEN_VLM_MODEL_OPTIONS } from '../../features/memory/constants'
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
  onRemoveMemory,
  onClearDailyMemory,
  onUpdateDailyEntry,
  onRemoveDailyEntry,
}: MemorySectionProps) {
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
  const selectedMemoryEmbeddingModel = MEMORY_EMBEDDING_MODEL_OPTIONS.find((option) => (
    option.value === draft.memoryEmbeddingModel
  ))

  return (
    <section className={`settings-section ${active ? 'is-active' : 'is-hidden'}`}>
      <div className="settings-section__title-row">
        <div>
          <h4>{ti('settings.memory.context.title')}</h4>
          <p className="settings-drawer__hint">
            {ti('settings.memory.context.note')}
          </p>
        </div>
      </div>

      <ToggleField
        label={ti('settings.memory.context.enable')}
        field="contextAwarenessEnabled"
        disabled={!contextAwarenessAvailable}
        draft={draft}
        setDraft={setDraft}
      />
      <ToggleField
        label={ti('settings.memory.context.clipboard')}
        field="clipboardContextEnabled"
        disabled={!draft.contextAwarenessEnabled || !clipboardContextAvailable}
        draft={draft}
        setDraft={setDraft}
      />
      <ToggleField
        label={ti('settings.memory.context.active_window')}
        field="activeWindowContextEnabled"
        disabled={!draft.contextAwarenessEnabled || !activeWindowContextAvailable}
        draft={draft}
        setDraft={setDraft}
      />
      <ToggleField
        label={ti('settings.memory.context.screen_ocr')}
        field="screenContextEnabled"
        disabled={!draft.contextAwarenessEnabled || !screenContextAvailable}
        draft={draft}
        setDraft={setDraft}
      />

      {clipboardPlatformHint ? (
        <p className="settings-drawer__hint">
          {ti('settings.memory.context.clipboard')}: {clipboardPlatformHint}
        </p>
      ) : null}

      {activeWindowPlatformHint ? (
        <p className="settings-drawer__hint">
          {ti('settings.memory.context.active_window')}: {activeWindowPlatformHint}
        </p>
      ) : null}

      {screenPlatformHint ? (
        <p className="settings-drawer__hint">
          {ti('settings.memory.context.screen_ocr')}: {screenPlatformHint}
        </p>
      ) : null}

      {draft.contextAwarenessEnabled && draft.screenContextEnabled ? (
        <>
          <TextField
            label={ti('settings.memory.context.ocr_language')}
            field="screenOcrLanguage"
            placeholder="chi_sim+eng"
            draft={draft}
            setDraft={setDraft}
          />

          <ToggleField
            label={ti('settings.memory.context.vlm_enable')}
            field="screenVlmEnabled"
            draft={draft}
            setDraft={setDraft}
          />

          <p className="settings-drawer__hint">
            {ti('settings.memory.context.vlm_note')}
          </p>

          {draft.screenVlmEnabled ? (
            <>
              <TextField
                label={ti('settings.memory.context.vlm_base_url')}
                field="screenVlmBaseUrl"
                placeholder="https://api.openai.com/v1"
                draft={draft}
                setDraft={setDraft}
              />

              <TextField
                label={ti('settings.memory.context.vlm_api_key')}
                field="screenVlmApiKey"
                type="password"
                placeholder={ti('settings.memory.context.vlm_api_key_placeholder')}
                draft={draft}
                setDraft={setDraft}
              />

              <label>
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

              <p className="settings-drawer__hint">
                {(() => {
                  const vlmHint = SCREEN_VLM_MODEL_OPTIONS.find((option) => option.value === draft.screenVlmModel)?.hint
                  return vlmHint ? ti(vlmHint) : ti('settings.memory.context.vlm_custom_hint')
                })()}
              </p>

              <TextField
                label={ti('settings.memory.context.vlm_custom_model')}
                field="screenVlmModel"
                placeholder="gpt-4o-mini"
                draft={draft}
                setDraft={setDraft}
              />
            </>
          ) : null}
        </>
      ) : null}

      <div className="settings-section__title-row">
        <div>
          <h4>{ti('settings.memory.long_term.title')}</h4>
          <p className="settings-drawer__hint">
            {ti('settings.memory.long_term.note')}
          </p>
        </div>
      </div>

      <label>
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

      <p className="settings-drawer__hint">
        {selectedMemorySearchMode.hint}
      </p>

      <label>
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

      <p className="settings-drawer__hint">
        {selectedMemoryEmbeddingModel?.hint
          ? ti(selectedMemoryEmbeddingModel.hint)
          : ti('settings.memory.long_term.embedding_custom_hint')}
      </p>

      <TextField
        label={ti('settings.memory.long_term.embedding_custom_model')}
        field="memoryEmbeddingModel"
        draft={draft}
        setDraft={setDraft}
      />

      <div className="settings-grid">
        <NumberField
          label={ti('settings.memory.long_term.recall_long_term')}
          field="memoryLongTermRecallCount"
          min={1} max={8} step={1}
          draft={draft}
          setDraft={setDraft}
        />
        <NumberField
          label={ti('settings.memory.long_term.recall_diary')}
          field="memoryDailyRecallCount"
          min={1} max={8} step={1}
          draft={draft}
          setDraft={setDraft}
        />
        <NumberField
          label={ti('settings.memory.long_term.recall_semantic')}
          field="memorySemanticRecallCount"
          min={1} max={8} step={1}
          draft={draft}
          setDraft={setDraft}
        />
      </div>

      <NumberField
        label={ti('settings.memory.long_term.diary_retention')}
        field="memoryDiaryRetentionDays"
        min={1} max={30} step={1}
        draft={draft}
        setDraft={setDraft}
      />

      <p className="settings-drawer__hint">
        {ti('settings.memory.long_term.archive_note')}
      </p>

      <div className="settings-section__title-row">
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
        <div className={memoryArchiveStatus.ok ? 'settings-test-result is-success' : 'settings-test-result is-error'}>
          {memoryArchiveStatus.message}
        </div>
      ) : null}

      <MemoryPanel
        assistantName={draft.companionName}
        memories={memories}
        dailyEntries={dailyMemoryEntries}
        searchMode={draft.memorySearchMode}
        embeddingModel={draft.memoryEmbeddingModel}
        uiLanguage={uiLanguage}
        onAddMemory={onAddManualMemory}
        onUpdateMemory={onUpdateMemory}
        onRemove={onRemoveMemory}
        onClearDaily={onClearDailyMemory}
        onUpdateDailyEntry={onUpdateDailyEntry}
        onRemoveDailyEntry={onRemoveDailyEntry}
      />
    </section>
  )
})
