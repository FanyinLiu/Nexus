import { memo } from 'react'
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import {
  isVoiceCloneDisabled,
  VOICE_CLONE_PROVIDER_PRESETS,
} from '../../lib/audioProviders'
import type {
  AppSettings,
  ServiceConnectionCapability,
} from '../../types'

type StatusMessage = {
  ok: boolean
  message: string
} | null

type CloneSectionProps = {
  active: boolean
  draft: AppSettings
  setDraft: Dispatch<SetStateAction<AppSettings>>
  testingTarget: ServiceConnectionCapability | null
  cloneFiles: File[]
  cloneName: string
  cloneDescription: string
  removeBackgroundNoise: boolean
  cloningVoice: boolean
  cloneStatus: StatusMessage
  voiceCloneProvider: {
    notes: string
    baseUrl?: string
  }
  applyVoiceClonePreset: (providerId: string) => void
  setCloneFiles: Dispatch<SetStateAction<File[]>>
  setCloneName: Dispatch<SetStateAction<string>>
  setCloneDescription: Dispatch<SetStateAction<string>>
  setRemoveBackgroundNoise: Dispatch<SetStateAction<boolean>>
  onRunVoiceCloneConnectionTest: () => void
  onCloneVoice: () => void
  renderVoiceCloneTestResult: () => ReactNode
}

export const CloneSection = memo(function CloneSection({
  active,
  draft,
  setDraft,
  testingTarget,
  cloneFiles,
  cloneName,
  cloneDescription,
  removeBackgroundNoise,
  cloningVoice,
  cloneStatus,
  voiceCloneProvider,
  applyVoiceClonePreset,
  setCloneFiles,
  setCloneName,
  setCloneDescription,
  setRemoveBackgroundNoise,
  onRunVoiceCloneConnectionTest,
  onCloneVoice,
  renderVoiceCloneTestResult,
}: CloneSectionProps) {
  return (
    <section className={`settings-section ${active ? 'is-active' : 'is-hidden'}`}>
      <div className="settings-section__title-row">
        <div>
          <h4>语音克隆</h4>
          <p className="settings-drawer__hint">
            当前内置接通的是 ElevenLabs 克隆接口，成功后会自动写入音色 ID。
          </p>
        </div>
        <button
          type="button"
          className="ghost-button"
          onClick={onRunVoiceCloneConnectionTest}
          disabled={testingTarget === 'voice-clone'}
        >
          {testingTarget === 'voice-clone' ? '测试中...' : '测试克隆接口'}
        </button>
      </div>

      <label>
        <span>语音克隆提供商</span>
        <select
          value={draft.voiceCloneProviderId}
          onChange={(event) => applyVoiceClonePreset(event.target.value)}
        >
          {VOICE_CLONE_PROVIDER_PRESETS.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.label}
            </option>
          ))}
        </select>
      </label>

      <p className="settings-drawer__hint">
        {voiceCloneProvider.notes}
        {voiceCloneProvider.baseUrl ? ` 默认地址：${voiceCloneProvider.baseUrl}` : ''}
      </p>

      {!isVoiceCloneDisabled(draft.voiceCloneProviderId) ? (
        <>
          <label>
            <span>语音克隆接口地址</span>
            <input
              value={draft.voiceCloneApiBaseUrl}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  voiceCloneApiBaseUrl: event.target.value,
                }))
              }
            />
          </label>

          <label>
            <span>语音克隆密钥</span>
            <input
              type="password"
              value={draft.voiceCloneApiKey}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  voiceCloneApiKey: event.target.value,
                }))
              }
            />
          </label>

          <label>
            <span>克隆音色名称</span>
            <input
              value={cloneName}
              onChange={(event) => setCloneName(event.target.value)}
            />
          </label>

          <label>
            <span>克隆说明</span>
            <textarea
              rows={3}
              value={cloneDescription}
              onChange={(event) => setCloneDescription(event.target.value)}
            />
          </label>

          <label>
            <span>上传语音样本</span>
            <input
              type="file"
              accept="audio/*,.wav,.mp3,.m4a,.ogg,.webm"
              multiple
              onChange={(event) =>
                setCloneFiles(Array.from(event.target.files ?? []))
              }
            />
          </label>

          {cloneFiles.length ? (
            <div className="settings-file-list">
              {cloneFiles.map((file) => (
                <span key={`${file.name}-${file.size}`}>{file.name}</span>
              ))}
            </div>
          ) : null}

          <label className="settings-toggle">
            <span>自动降噪</span>
            <input
              type="checkbox"
              checked={removeBackgroundNoise}
              onChange={(event) => setRemoveBackgroundNoise(event.target.checked)}
            />
          </label>

          <button
            type="button"
            className="primary-button"
            onClick={onCloneVoice}
            disabled={cloningVoice}
          >
            {cloningVoice ? '上传并克隆中...' : '上传样本并克隆'}
          </button>
        </>
      ) : null}

      <label>
        <span>当前克隆音色 ID</span>
        <input
          value={draft.clonedVoiceId}
          onChange={(event) =>
            setDraft((prev) => ({
              ...prev,
              clonedVoiceId: event.target.value,
            }))
          }
        />
      </label>

      {renderVoiceCloneTestResult()}

      {cloneStatus ? (
        <div className={cloneStatus.ok ? 'settings-test-result is-success' : 'settings-test-result is-error'}>
          {cloneStatus.message}
        </div>
      ) : null}
    </section>
  )
})
