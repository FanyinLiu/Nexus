import { memo, useMemo } from 'react'
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import { API_PROVIDER_PRESETS, getApiProviderPreset } from '../../lib/apiProviders'
import { ProviderChoiceGrid, type ProviderChoiceItem } from '../ProviderChoiceGrid'
import type { AppSettings, ServiceConnectionCapability } from '../../types'

type ModelSectionProps = {
  active: boolean
  draft: AppSettings
  setDraft: Dispatch<SetStateAction<AppSettings>>
  testingTarget: ServiceConnectionCapability | null
  textProvider: {
    notes: string
    baseUrl?: string
    defaultModel?: string
  }
  t: (zhCN: string, enUS: string) => string
  getProviderRegionLabel: (region: 'global' | 'china' | 'custom') => string
  onApplyTextProviderPreset: (providerId: string) => void
  onRunTextConnectionTest: () => void
  renderTextTestResult: () => ReactNode
}

export const ModelSection = memo(function ModelSection({
  active,
  draft,
  setDraft,
  testingTarget,
  textProvider,
  t,
  getProviderRegionLabel,
  onApplyTextProviderPreset,
  onRunTextConnectionTest,
  renderTextTestResult,
}: ModelSectionProps) {
  const currentPreset = getApiProviderPreset(draft.apiProviderId)
  const hasModelOptions = currentPreset.models.length > 0

  const textProviderItems: ProviderChoiceItem[] = useMemo(
    () => API_PROVIDER_PRESETS
      .filter((provider) => provider.defaultModel)
      .map((provider) => ({
        id: provider.id,
        label: provider.label,
        meta: getProviderRegionLabel(provider.region),
      })),
    [getProviderRegionLabel],
  )

  return (
    <section className={`settings-section ${active ? 'is-active' : 'is-hidden'}`}>
      <div className="settings-section__title-row">
        <div>
          <h4>模型与主链路</h4>
          <p className="settings-drawer__hint">
            这一页只处理文本模型提供商、模型名称、接口地址和主链路故障切换，不再混入角色基础配置。
          </p>
        </div>
        <button
          type="button"
          className="ghost-button"
          onClick={onRunTextConnectionTest}
          disabled={testingTarget === 'text'}
        >
          {testingTarget === 'text' ? '测试中...' : '测试文本接口'}
        </button>
      </div>

      <div className="settings-choice-field settings-choice-field--text-provider">
        <span className="settings-choice-field__label">
          {t('模型选择', 'Model selection')}
        </span>
        <ProviderChoiceGrid
          items={textProviderItems}
          selectedId={draft.apiProviderId}
          onSelect={onApplyTextProviderPreset}
        />
      </div>

      <label>
        <span>文本 API 提供商</span>
        <select
          value={draft.apiProviderId}
          onChange={(event) => onApplyTextProviderPreset(event.target.value)}
        >
          {API_PROVIDER_PRESETS.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.label}
            </option>
          ))}
        </select>
      </label>

      <p className="settings-drawer__hint">
        {textProvider.notes}
        {textProvider.baseUrl ? ` 默认地址：${textProvider.baseUrl}` : ''}
        {textProvider.defaultModel ? `，推荐模型：${textProvider.defaultModel}` : ''}
      </p>

      <label>
        <span>文本接口地址</span>
        <input
          value={draft.apiBaseUrl}
          onChange={(event) =>
            setDraft((prev) => ({ ...prev, apiBaseUrl: event.target.value }))
          }
        />
      </label>

      <label>
        <span>文本接口密钥</span>
        <input
          type="password"
          value={draft.apiKey}
          onChange={(event) =>
            setDraft((prev) => ({ ...prev, apiKey: event.target.value }))
          }
        />
      </label>

      <label>
        <span>文本模型</span>
        {hasModelOptions ? (
          <select
            value={draft.model}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, model: event.target.value }))
            }
          >
            {currentPreset.models.map((model) => (
              <option key={model} value={model}>{model}</option>
            ))}
            {!currentPreset.models.includes(draft.model) && draft.model && (
              <option value={draft.model}>{draft.model} (自定义)</option>
            )}
          </select>
        ) : (
          <input
            value={draft.model}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, model: event.target.value }))
            }
          />
        )}
      </label>

      <label className="settings-toggle">
        <span>启用聊天模型自动切换</span>
        <input
          type="checkbox"
          checked={draft.chatFailoverEnabled}
          onChange={(event) =>
            setDraft((prev) => ({
              ...prev,
              chatFailoverEnabled: event.target.checked,
            }))
          }
        />
      </label>

      <p className="settings-drawer__hint">
        当前主链路失败时，会自动尝试切换到备用 provider，并对故障 provider 做短时冷却。
      </p>

      {renderTextTestResult()}
    </section>
  )
})
