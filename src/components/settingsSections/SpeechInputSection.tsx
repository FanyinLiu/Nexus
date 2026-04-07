import { memo } from 'react'
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import {
  buildVolcengineCredential,
  parseVolcengineCredentialParts,
  type VolcengineCredentialParts,
} from '../settingsDrawerSupport'
import {
  getSpeechInputModelOptions,
  getSpeechInputProviderPreset,
  isLocalSherpaSpeechInputProvider,
  isLocalWhisperSpeechInputProvider,
  isSenseVoiceSpeechInputProvider,
  isVolcengineSpeechInputProvider,
  USER_VISIBLE_SPEECH_INPUT_PROVIDER_PRESETS,
} from '../../lib/audioProviders'
import {
  switchSpeechInputProvider,
  updateCurrentSpeechInputProviderProfile,
} from '../../lib/speechProviderProfiles'
import { isBrowserSpeechRecognitionSupported } from '../../lib/voice'
import type { AppSettings, ServiceConnectionCapability } from '../../types'

type SpeechInputSectionProps = {
  active: boolean
  draft: AppSettings
  setDraft: Dispatch<SetStateAction<AppSettings>>
  testingTarget: ServiceConnectionCapability | null
  onRunSpeechInputConnectionTest: () => void
  renderSpeechInputTestResult: () => ReactNode
}

export const SpeechInputSection = memo(function SpeechInputSection({
  active,
  draft,
  setDraft,
  testingTarget,
  onRunSpeechInputConnectionTest,
  renderSpeechInputTestResult,
}: SpeechInputSectionProps) {
  const speechInputProvider = getSpeechInputProviderPreset(draft.speechInputProviderId)
  const speechInputModelOptions = getSpeechInputModelOptions(draft.speechInputProviderId)
  const isLocalSherpaSpeechInput = isLocalSherpaSpeechInputProvider(draft.speechInputProviderId)
  const isSenseVoiceSpeechInput = isSenseVoiceSpeechInputProvider(draft.speechInputProviderId)
  const isLocalWhisperSpeechInput = isLocalWhisperSpeechInputProvider(draft.speechInputProviderId)
  const isLocalSpeechInput = isLocalSherpaSpeechInput || isSenseVoiceSpeechInput || isLocalWhisperSpeechInput
  const isVolcengineSpeechInput = isVolcengineSpeechInputProvider(draft.speechInputProviderId)
  const speechInputVolcengineCredentials = parseVolcengineCredentialParts(draft.speechInputApiKey)
  const browserSpeechRecognitionSupported = isBrowserSpeechRecognitionSupported()
  const speechInputModelLabel = isLocalSherpaSpeechInput
    ? '本地流式模型'
    : isSenseVoiceSpeechInput
      ? 'SenseVoice 模型'
      : isLocalWhisperSpeechInput
        ? 'Whisper 模型'
        : '语音输入模型'
  const speechInputModelHint = isLocalSherpaSpeechInput
    ? 'Sherpa-onnx 需要你先把模型放进 `sherpa-models` 目录；推荐先用 Paraformer 中英双语流式模型。'
    : isSenseVoiceSpeechInput
      ? '需要先把 sherpa-onnx-sense-voice-zh-en-2024-07-17 目录放到 `sherpa-models` 下。10秒音频仅需70ms，中文识别准确率极高。'
      : isLocalWhisperSpeechInput
        ? '本地 Whisper 首次使用会自动下载所选模型，之后可以离线运行。`whisper-base` 更稳，`whisper-small` 更准但更慢。'
        : ''

  function applySpeechInputPreset(providerId: string) {
    setDraft((prev) => switchSpeechInputProvider(prev, providerId))
  }

  function updateSpeechInputVolcengineCredential(partial: Partial<VolcengineCredentialParts>) {
    setDraft((prev) => {
      const current = parseVolcengineCredentialParts(prev.speechInputApiKey)
      return updateCurrentSpeechInputProviderProfile(prev, {
        apiKey: buildVolcengineCredential({
          ...current,
          ...partial,
        }),
      })
    })
  }

  return (
    <section className={`settings-section ${active ? 'is-active' : 'is-hidden'}`}>
      <div className="settings-section__title-row">
        <div>
          <h4>语音输入 STT</h4>
          <p className="settings-drawer__hint">
            支持浏览器本地识别，也支持内置云端语音转文字。
          </p>
        </div>
        <button
          type="button"
          className="ghost-button"
          onClick={onRunSpeechInputConnectionTest}
          disabled={testingTarget === 'speech-input'}
        >
          {testingTarget === 'speech-input' ? '测试中...' : '测试语音输入'}
        </button>
      </div>

      <label>
        <span>语音输入提供商</span>
        <select
          value={draft.speechInputProviderId}
          onChange={(event) => applySpeechInputPreset(event.target.value)}
        >
          {USER_VISIBLE_SPEECH_INPUT_PROVIDER_PRESETS.map((provider) => (
            <option
              key={provider.id}
              value={provider.id}
              disabled={provider.id === 'browser' && !browserSpeechRecognitionSupported}
            >
              {provider.id === 'browser' && !browserSpeechRecognitionSupported
                ? `${provider.label}（当前不可用）`
                : provider.label}
            </option>
          ))}
        </select>
      </label>

      <p className="settings-drawer__hint">
        {speechInputProvider.notes}
        {speechInputProvider.baseUrl ? ` 默认地址：${speechInputProvider.baseUrl}` : ''}
        {speechInputProvider.defaultModel ? `，默认模型：${speechInputProvider.defaultModel}` : ''}
      </p>

      {!browserSpeechRecognitionSupported && draft.speechInputProviderId === 'browser' ? (
        <div className="settings-inline-note">
          当前 Electron 环境不支持浏览器原生语音识别，建议切换到“本地 Whisper 离线识别”。
        </div>
      ) : null}

      {!isLocalSpeechInput ? (
        <>
          <label>
            <span>语音输入接口地址</span>
            <input
              value={draft.speechInputApiBaseUrl}
              onChange={(event) =>
                setDraft((prev) => updateCurrentSpeechInputProviderProfile(prev, {
                  apiBaseUrl: event.target.value,
                }))
              }
            />
          </label>

          {isVolcengineSpeechInput ? (
            <>
              <div className="settings-grid settings-grid--two">
                <label>
                  <span>火山 App ID</span>
                  <input
                    value={speechInputVolcengineCredentials.appId}
                    onChange={(event) =>
                      updateSpeechInputVolcengineCredential({
                        appId: event.target.value,
                      })
                    }
                  />
                </label>

                <label>
                  <span>火山访问令牌</span>
                  <input
                    type="password"
                    value={speechInputVolcengineCredentials.accessToken}
                    onChange={(event) =>
                      updateSpeechInputVolcengineCredential({
                        accessToken: event.target.value,
                      })
                    }
                  />
                </label>
              </div>

              <p className="settings-drawer__hint">
                这里分开填写即可，保存时会自动拼成 `APP_ID:ACCESS_TOKEN`。如果你复制的是带标签的两行文本，也可以直接粘进“访问令牌”一栏试一下。
              </p>
            </>
          ) : (
            <label>
              <span>语音输入密钥</span>
              <input
                type="password"
                value={draft.speechInputApiKey}
                onChange={(event) =>
                  setDraft((prev) => updateCurrentSpeechInputProviderProfile(prev, {
                    apiKey: event.target.value,
                  }))
                }
              />
            </label>
          )}

          <label>
            <span>{speechInputModelLabel}</span>
            {speechInputModelOptions.length ? (
              <select
                value={draft.speechInputModel}
                onChange={(event) =>
                  setDraft((prev) => updateCurrentSpeechInputProviderProfile(prev, {
                    model: event.target.value,
                  }))
                }
              >
                {speechInputModelOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={draft.speechInputModel}
                onChange={(event) =>
                  setDraft((prev) => updateCurrentSpeechInputProviderProfile(prev, {
                    model: event.target.value,
                  }))
                }
              />
            )}
          </label>
        </>
      ) : (
        <>
          <label>
            <span>{speechInputModelLabel}</span>
            {speechInputModelOptions.length ? (
              <select
                value={draft.speechInputModel}
                onChange={(event) =>
                  setDraft((prev) => updateCurrentSpeechInputProviderProfile(prev, {
                    model: event.target.value,
                  }))
                }
              >
                {speechInputModelOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={draft.speechInputModel}
                onChange={(event) =>
                  setDraft((prev) => updateCurrentSpeechInputProviderProfile(prev, {
                    model: event.target.value,
                  }))
                }
              />
            )}
          </label>

          {speechInputModelHint ? (
            <p className="settings-drawer__hint">{speechInputModelHint}</p>
          ) : null}
        </>
      )}

      <label>
        <span>识别语言</span>
        <input
          value={draft.speechRecognitionLang}
          onChange={(event) =>
            setDraft((prev) => ({
              ...prev,
              speechRecognitionLang: event.target.value,
            }))
          }
        />
      </label>

      {renderSpeechInputTestResult()}
    </section>
  )
})
