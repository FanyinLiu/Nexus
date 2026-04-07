import { memo } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { MemoryPanel } from '../../features/memory/components'
import { MEMORY_EMBEDDING_MODEL_OPTIONS } from '../../features/memory/constants'
import { parseNumberInput } from '../settingsDrawerSupport'
import type {
  AppSettings,
  DailyMemoryEntry,
  MemoryItem,
  MemorySearchMode,
  UiLanguage,
} from '../../types'

type MemorySearchModeOption = {
  value: MemorySearchMode
  label: string
  hint: string
}

type EmbeddingModelOption = {
  value: string
  hint?: string
}

type StatusMessage = {
  ok: boolean
  message: string
} | null

type MemorySectionProps = {
  active: boolean
  draft: AppSettings
  setDraft: Dispatch<SetStateAction<AppSettings>>
  memories: MemoryItem[]
  dailyMemoryEntries: DailyMemoryEntry[]
  uiLanguage: UiLanguage
  memorySearchModeOptions: MemorySearchModeOption[]
  selectedMemorySearchMode: MemorySearchModeOption
  selectedMemoryEmbeddingModel?: EmbeddingModelOption
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
  setDraft,
  memories,
  dailyMemoryEntries,
  uiLanguage,
  memorySearchModeOptions,
  selectedMemorySearchMode,
  selectedMemoryEmbeddingModel,
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
  return (
    <section className={`settings-section ${active ? 'is-active' : 'is-hidden'}`}>
      <div className="settings-section__title-row">
        <div>
          <h4>上下文感知</h4>
          <p className="settings-drawer__hint">
            桌面感知能力。建议先稳定开启前台窗口和剪贴板，OCR 只在确实需要时打开。
          </p>
        </div>
      </div>

      <label className="settings-toggle">
        <span>启用上下文感知</span>
        <input
          type="checkbox"
          checked={draft.contextAwarenessEnabled}
          onChange={(event) =>
            setDraft((prev) => ({
              ...prev,
              contextAwarenessEnabled: event.target.checked,
            }))
          }
        />
      </label>

      <label className="settings-toggle">
        <span>读取剪贴板上下文</span>
        <input
          type="checkbox"
          checked={draft.clipboardContextEnabled}
          onChange={(event) =>
            setDraft((prev) => ({
              ...prev,
              clipboardContextEnabled: event.target.checked,
            }))
          }
          disabled={!draft.contextAwarenessEnabled}
        />
      </label>

      <label className="settings-toggle">
        <span>读取当前窗口上下文</span>
        <input
          type="checkbox"
          checked={draft.activeWindowContextEnabled}
          onChange={(event) =>
            setDraft((prev) => ({
              ...prev,
              activeWindowContextEnabled: event.target.checked,
            }))
          }
          disabled={!draft.contextAwarenessEnabled}
        />
      </label>

      <label className="settings-toggle">
        <span>读取屏幕文字（OCR）</span>
        <input
          type="checkbox"
          checked={draft.screenContextEnabled}
          onChange={(event) =>
            setDraft((prev) => ({
              ...prev,
              screenContextEnabled: event.target.checked,
            }))
          }
          disabled={!draft.contextAwarenessEnabled}
        />
      </label>

      {draft.contextAwarenessEnabled && draft.screenContextEnabled ? (
        <>
          <label>
            <span>屏幕 OCR 语言</span>
            <input
              value={draft.screenOcrLanguage}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  screenOcrLanguage: event.target.value,
                }))
              }
              placeholder="chi_sim+eng"
            />
          </label>

          <label className="settings-toggle">
            <span>启用 VLM 屏幕理解</span>
            <input
              type="checkbox"
              checked={draft.screenVlmEnabled}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  screenVlmEnabled: event.target.checked,
                }))
              }
            />
          </label>

          <p className="settings-drawer__hint">
            使用视觉语言模型（VLM）分析屏幕截图，获得比 OCR 更丰富的画面理解。需要支持视觉的模型（如 GPT-4o、Qwen-VL 等）。
          </p>

          {draft.screenVlmEnabled ? (
            <>
              <label>
                <span>VLM API 地址</span>
                <input
                  value={draft.screenVlmBaseUrl}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      screenVlmBaseUrl: event.target.value,
                    }))
                  }
                  placeholder="https://api.openai.com/v1"
                />
              </label>

              <label>
                <span>VLM API Key</span>
                <input
                  type="password"
                  value={draft.screenVlmApiKey}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      screenVlmApiKey: event.target.value,
                    }))
                  }
                  placeholder="留空则不使用鉴权"
                />
              </label>

              <label>
                <span>VLM 模型</span>
                <input
                  value={draft.screenVlmModel}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      screenVlmModel: event.target.value,
                    }))
                  }
                  placeholder="gpt-4o-mini"
                />
              </label>
            </>
          ) : null}
        </>
      ) : null}

      <div className="settings-section__title-row">
        <div>
          <h4>长期记忆</h4>
          <p className="settings-drawer__hint">
            这里把记忆拆成当前会话、每日日志和长期记忆三层，并支持可配置的向量检索。
          </p>
        </div>
      </div>

      <label>
        <span>记忆检索模式</span>
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
        <span>向量模型预设</span>
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
              {option.label}
            </option>
          ))}
          <option value="__custom__">保留自定义值</option>
        </select>
      </label>

      <p className="settings-drawer__hint">
        {selectedMemoryEmbeddingModel?.hint ?? '也可以直接在下面填写自定义向量模型 ID。'}
      </p>

      <label>
        <span>自定义向量模型 ID</span>
        <input
          value={draft.memoryEmbeddingModel}
          onChange={(event) =>
            setDraft((prev) => ({
              ...prev,
              memoryEmbeddingModel: event.target.value,
            }))
          }
        />
      </label>

      <div className="settings-grid">
        <label>
          <span>长期记忆召回数</span>
          <input
            type="number"
            min="1"
            max="8"
            step="1"
            value={draft.memoryLongTermRecallCount}
            onChange={(event) =>
              setDraft((prev) => ({
                ...prev,
                memoryLongTermRecallCount: parseNumberInput(event.target.value, prev.memoryLongTermRecallCount),
              }))
            }
          />
        </label>

        <label>
          <span>日记召回数</span>
          <input
            type="number"
            min="1"
            max="8"
            step="1"
            value={draft.memoryDailyRecallCount}
            onChange={(event) =>
              setDraft((prev) => ({
                ...prev,
                memoryDailyRecallCount: parseNumberInput(event.target.value, prev.memoryDailyRecallCount),
              }))
            }
          />
        </label>

        <label>
          <span>语义命中数</span>
          <input
            type="number"
            min="1"
            max="8"
            step="1"
            value={draft.memorySemanticRecallCount}
            onChange={(event) =>
              setDraft((prev) => ({
                ...prev,
                memorySemanticRecallCount: parseNumberInput(event.target.value, prev.memorySemanticRecallCount),
              }))
            }
          />
        </label>
      </div>

      <label>
        <span>每日日志保留天数</span>
        <input
          type="number"
          min="1"
          max="30"
          step="1"
          value={draft.memoryDiaryRetentionDays}
          onChange={(event) =>
            setDraft((prev) => ({
              ...prev,
              memoryDiaryRetentionDays: parseNumberInput(event.target.value, prev.memoryDiaryRetentionDays),
            }))
          }
        />
      </label>

      <p className="settings-drawer__hint">
        记忆导入会替换当前长期记忆和每日日志；手动编辑可以直接改单条长期记忆内容。
      </p>

      <div className="settings-section__title-row">
        <button
          type="button"
          className="ghost-button"
          onClick={onExportMemoryArchive}
          disabled={exportingMemoryArchive}
        >
          {exportingMemoryArchive ? '导出中...' : '导出记忆 JSON'}
        </button>

        <button
          type="button"
          className="ghost-button"
          onClick={onImportMemoryArchive}
          disabled={importingMemoryArchive || chatBusy}
        >
          {importingMemoryArchive ? '导入中...' : '导入记忆 JSON'}
        </button>

        <button
          type="button"
          className="ghost-button"
          onClick={onClearMemoryArchive}
          disabled={clearingMemoryArchive || chatBusy}
        >
          {clearingMemoryArchive ? '清空中...' : '清空记忆库'}
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
