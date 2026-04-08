import { memo } from 'react'
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import {
  buildVolcengineCredential,
  clampNumber,
  formatTtsAdjustmentValue,
  parseNumberInput,
  parseVolcengineCredentialParts,
  type ConnectionResult,
  type VolcengineCredentialParts,
} from '../settingsDrawerSupport'
import {
  getSpeechOutputAdjustmentSupport,
  getSpeechOutputModelOptions,
  getSpeechOutputProviderPreset,
  isEdgeTtsSpeechOutputProvider,
  isMiniMaxSpeechOutputProvider,
  isVolcengineSpeechOutputProvider,
  USER_VISIBLE_SPEECH_OUTPUT_PROVIDER_PRESETS,
} from '../../lib/audioProviders'
import { updateCurrentSpeechOutputProviderProfile } from '../../lib/speechProviderProfiles'
import type {
  AppSettings,
  ServiceConnectionCapability,
  SpeechVoiceOption,
} from '../../types'

type SpeechOutputSectionProps = {
  active: boolean
  draft: AppSettings
  setDraft: Dispatch<SetStateAction<AppSettings>>
  speechVoiceOptions: SpeechVoiceOption[]
  speechVoiceStatus: ConnectionResult | null
  loadingSpeechVoices: boolean
  speechPreviewText: string
  setSpeechPreviewText: Dispatch<SetStateAction<string>>
  speechPreviewStatus: ConnectionResult | null
  previewingSpeech: boolean
  testingTarget: ServiceConnectionCapability | null
  onApplySpeechOutputPreset: (providerId: string) => void
  onLoadSpeechVoices: () => void
  onPreviewSpeech: () => void
  onRunSpeechOutputConnectionTest: () => void
  renderSpeechOutputTestResult: () => ReactNode
}

export const SpeechOutputSection = memo(function SpeechOutputSection({
  active,
  draft,
  setDraft,
  speechVoiceOptions,
  speechVoiceStatus,
  loadingSpeechVoices,
  speechPreviewText,
  setSpeechPreviewText,
  speechPreviewStatus,
  previewingSpeech,
  testingTarget,
  onApplySpeechOutputPreset,
  onLoadSpeechVoices,
  onPreviewSpeech,
  onRunSpeechOutputConnectionTest,
  renderSpeechOutputTestResult,
}: SpeechOutputSectionProps) {
  const speechOutputProvider = getSpeechOutputProviderPreset(draft.speechOutputProviderId)
  const speechOutputAdjustmentSupport = getSpeechOutputAdjustmentSupport(draft.speechOutputProviderId)
  const speechOutputModelOptions = getSpeechOutputModelOptions(draft.speechOutputProviderId)
  const isVolcengineSpeechOutput = isVolcengineSpeechOutputProvider(draft.speechOutputProviderId)
  const isEdgeTtsSpeechOutput = isEdgeTtsSpeechOutputProvider(draft.speechOutputProviderId)
  const isCosyVoiceSpeechOutput = draft.speechOutputProviderId === 'cosyvoice-tts'
  const hideApiCredentials = isEdgeTtsSpeechOutput
  const speechOutputVolcengineCredentials = parseVolcengineCredentialParts(draft.speechOutputApiKey)
  const speechOutputBaseUrlLabel = '语音输出接口地址'
  const speechOutputBaseUrlHint = ''
  const speechOutputModelLabel = isVolcengineSpeechOutput
    ? '语音业务集群'
    : '语音输出模型'
  const speechOutputModelHint = ''
  const speechOutputVoiceLabel = isVolcengineSpeechOutput
    ? '播报音色类型'
    : isCosyVoiceSpeechOutput
      ? 'CosyVoice2 音色 / spk_id'
      : '播报音色 / 音色 ID'
  const speechOutputVoiceHint = ''

  function updateSpeechOutputVolcengineCredential(partial: Partial<VolcengineCredentialParts>) {
    setDraft((prev) => {
      const current = parseVolcengineCredentialParts(prev.speechOutputApiKey)
      return updateCurrentSpeechOutputProviderProfile(prev, {
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
          <h4>语音输出 TTS</h4>
          <p className="settings-drawer__hint">
            浏览器本地播报是回退方案，云端 TTS 支持更稳定的内置声音。
          </p>
        </div>
        <button
          type="button"
          className="ghost-button"
          onClick={onRunSpeechOutputConnectionTest}
          disabled={testingTarget === 'speech-output'}
        >
          {testingTarget === 'speech-output' ? '测试中...' : '测试语音输出'}
        </button>
      </div>

      <label>
        <span>语音输出提供商</span>
        <select
          value={draft.speechOutputProviderId}
          onChange={(event) => onApplySpeechOutputPreset(event.target.value)}
        >
          {USER_VISIBLE_SPEECH_OUTPUT_PROVIDER_PRESETS.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.label}
            </option>
          ))}
        </select>
      </label>

      <p className="settings-drawer__hint">
        {speechOutputProvider.notes}
        {speechOutputProvider.baseUrl ? ` 默认地址：${speechOutputProvider.baseUrl}` : ''}
        {speechOutputProvider.defaultModel ? `，默认模型：${speechOutputProvider.defaultModel}` : ''}
      </p>

      {isEdgeTtsSpeechOutput ? (
        <>
          <label>
            <span>音色</span>
            {speechVoiceOptions.length ? (
              <select
                value={draft.speechOutputVoice}
                onChange={(event) =>
                  setDraft((prev) => updateCurrentSpeechOutputProviderProfile(prev, {
                    voice: event.target.value,
                  }))
                }
              >
                {speechVoiceOptions.map((voice) => (
                  <option key={voice.id} value={voice.id}>{voice.label}</option>
                ))}
              </select>
            ) : (
              <input
                value={draft.speechOutputVoice}
                placeholder="zh-CN-XiaoxiaoNeural"
                onChange={(event) =>
                  setDraft((prev) => updateCurrentSpeechOutputProviderProfile(prev, {
                    voice: event.target.value,
                  }))
                }
              />
            )}
          </label>
          <p className="settings-drawer__hint">
            Edge TTS 免费，无需 API key。音色名称形如 `zh-CN-XiaoxiaoNeural`，可在微软文档查看所有支持的音色。
          </p>
        </>
      ) : (
        <>
          <label>
            <span>{speechOutputBaseUrlLabel}</span>
            <input
              value={draft.speechOutputApiBaseUrl}
              onChange={(event) =>
                setDraft((prev) => updateCurrentSpeechOutputProviderProfile(prev, {
                  apiBaseUrl: event.target.value,
                }))
              }
            />
          </label>

          {speechOutputBaseUrlHint ? (
            <p className="settings-drawer__hint">{speechOutputBaseUrlHint}</p>
          ) : null}

          {isVolcengineSpeechOutput ? (
            <>
              <div className="settings-grid settings-grid--two">
                <label>
                  <span>火山 App ID</span>
                  <input
                    value={speechOutputVolcengineCredentials.appId}
                    onChange={(event) =>
                      updateSpeechOutputVolcengineCredential({
                        appId: event.target.value,
                      })
                    }
                  />
                </label>

                <label>
                  <span>火山访问令牌</span>
                  <input
                    type="password"
                    value={speechOutputVolcengineCredentials.accessToken}
                    onChange={(event) =>
                      updateSpeechOutputVolcengineCredential({
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
          ) : !hideApiCredentials ? (
            <label>
              <span>语音输出密钥</span>
              <input
                type="password"
                value={draft.speechOutputApiKey}
                onChange={(event) =>
                  setDraft((prev) => updateCurrentSpeechOutputProviderProfile(prev, {
                    apiKey: event.target.value,
                  }))
                }
              />
            </label>
          ) : null}

          <label>
            <span>{speechOutputModelLabel}</span>
            {speechOutputModelOptions.length ? (
              <select
                value={draft.speechOutputModel}
                onChange={(event) =>
                  setDraft((prev) => updateCurrentSpeechOutputProviderProfile(prev, {
                    model: event.target.value,
                  }))
                }
              >
                {speechOutputModelOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={draft.speechOutputModel}
                onChange={(event) =>
                  setDraft((prev) => updateCurrentSpeechOutputProviderProfile(prev, {
                    model: event.target.value,
                  }))
                }
              />
            )}
          </label>

          {speechOutputModelHint ? (
            <p className="settings-drawer__hint">{speechOutputModelHint}</p>
          ) : null}

          {isVolcengineSpeechOutput ? (
            <p className="settings-drawer__hint">
              火山 TTS 的“模型”这一栏实际填写的是业务集群，默认推荐 `volcano_tts`。如果你只是先验证能不能播报，音色先用 `BV001_streaming` 最稳；下拉里标了“需授权”的音色如果没有在控制台开通，程序会自动回退到 `BV001_streaming` 或 `BV002_streaming`。
            </p>
          ) : null}

          {isMiniMaxSpeechOutputProvider(draft.speechOutputProviderId) ? (
            <>
              <div className="settings-section__title-row">
                <div>
                  <p className="settings-drawer__hint">
                    MiniMax 已接入在线音色列表。保存前可以先刷新一次，确认下拉选项和当前密钥都正常。
                  </p>
                </div>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={onLoadSpeechVoices}
                  disabled={loadingSpeechVoices}
                >
                  {loadingSpeechVoices ? '拉取中...' : '刷新 MiniMax 音色'}
                </button>
              </div>

              <label>
                <span>MiniMax 可选音色</span>
                <select
                  value={speechVoiceOptions.some((voice) => voice.id === draft.speechOutputVoice)
                    ? draft.speechOutputVoice
                    : '__keep-current__'}
                  onChange={(event) => {
                    if (event.target.value === '__keep-current__') return
                    setDraft((prev) => updateCurrentSpeechOutputProviderProfile(prev, {
                      voice: event.target.value,
                    }))
                  }}
                >
                  <option value="__keep-current__">
                    {draft.speechOutputVoice
                      ? `保留当前值：${draft.speechOutputVoice}`
                      : '请选择一个 MiniMax 音色'}
                  </option>
                  {speechVoiceOptions.map((voice) => (
                    <option key={voice.id} value={voice.id}>
                      {voice.label === voice.id ? voice.id : `${voice.label} (${voice.id})`}
                    </option>
                  ))}
                </select>
              </label>

              {speechVoiceOptions.length ? (
                <p className="settings-drawer__hint">
                  {speechVoiceOptions.find((voice) => voice.id === draft.speechOutputVoice)?.description
                    ?? '已加载 MiniMax 音色列表，也可以继续手动填写音色 ID。'}
                </p>
              ) : null}
            </>
          ) : null}

          {speechVoiceOptions.length
            && !isMiniMaxSpeechOutputProvider(draft.speechOutputProviderId) ? (
            <>
              <label>
                <span>{
                  isVolcengineSpeechOutput
                    ? '火山推荐音色'
                    : isCosyVoiceSpeechOutput
                      ? 'CosyVoice2 预置音色'
                      : '推荐音色'
                }</span>
                <select
                  value={speechVoiceOptions.some((voice) => voice.id === draft.speechOutputVoice)
                    ? draft.speechOutputVoice
                    : '__keep-current__'}
                  onChange={(event) => {
                    if (event.target.value === '__keep-current__') return
                    setDraft((prev) => updateCurrentSpeechOutputProviderProfile(prev, {
                      voice: event.target.value,
                    }))
                  }}
                >
                  <option value="__keep-current__">
                    {draft.speechOutputVoice
                      ? `保留当前值：${draft.speechOutputVoice}`
                      : '请选择一个推荐音色'}
                  </option>
                  {speechVoiceOptions.map((voice) => (
                    <option key={voice.id} value={voice.id}>
                      {voice.label === voice.id ? voice.id : `${voice.label} (${voice.id})`}
                    </option>
                  ))}
                </select>
              </label>

              <p className="settings-drawer__hint">
                {speechVoiceOptions.find((voice) => voice.id === draft.speechOutputVoice)?.description
                  ?? '可以先从推荐音色里选一个，再按需手动填写音色 ID。'}
              </p>
            </>
          ) : null}

          <label>
            <span>{speechOutputVoiceLabel}</span>
            <input
              value={draft.speechOutputVoice}
              onChange={(event) =>
                setDraft((prev) => updateCurrentSpeechOutputProviderProfile(prev, {
                  voice: event.target.value,
                }))
              }
            />
          </label>

          {speechOutputVoiceHint ? (
            <p className="settings-drawer__hint">
              {speechOutputVoiceHint}
            </p>
          ) : null}

          {speechVoiceStatus ? (
            <div className={speechVoiceStatus.ok ? 'settings-test-result is-success' : 'settings-test-result is-error'}>
              {speechVoiceStatus.message}
            </div>
          ) : null}

          <label>
            <span>播报风格指令（OpenAI / CosyVoice2 可用）</span>
            <textarea
              rows={3}
              value={draft.speechOutputInstructions}
              onChange={(event) =>
                setDraft((prev) => updateCurrentSpeechOutputProviderProfile(prev, {
                  instructions: event.target.value,
                }))
              }
            />
          </label>
        </>
      )}

      <label>
        <span>播报语言</span>
        <input
          value={draft.speechSynthesisLang}
          onChange={(event) =>
            setDraft((prev) => ({
              ...prev,
              speechSynthesisLang: event.target.value,
            }))
          }
        />
      </label>

      <div className="settings-drawer__card">
        <div className="settings-section__title-row">
          <div>
            <h5>播报调校</h5>
            <p className="settings-drawer__hint">{speechOutputAdjustmentSupport.note}</p>
          </div>
          <button
            type="button"
            className="ghost-button"
            onClick={() =>
              setDraft((prev) => ({
                ...prev,
                speechRate: 1,
                speechPitch: 1.08,
                speechVolume: 1,
              }))
            }
          >
            恢复默认
          </button>
        </div>

        <div className="settings-tts-tuning">
          <div className={`settings-tts-tuning__item ${speechOutputAdjustmentSupport.rate ? '' : 'is-disabled'}`}>
            <div className="settings-tts-tuning__header">
              <strong>语速</strong>
              <span>{formatTtsAdjustmentValue('rate', draft.speechRate)}</span>
            </div>
            <div className="settings-tts-tuning__controls">
              <input
                className="settings-tts-tuning__range"
                type="range"
                min="0.5"
                max="2"
                step="0.05"
                value={draft.speechRate}
                disabled={!speechOutputAdjustmentSupport.rate}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    speechRate: clampNumber(parseNumberInput(event.target.value, prev.speechRate), 0.5, 2),
                  }))
                }
              />
              <input
                className="settings-tts-tuning__number"
                type="number"
                min="0.5"
                max="2"
                step="0.05"
                value={draft.speechRate}
                disabled={!speechOutputAdjustmentSupport.rate}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    speechRate: clampNumber(parseNumberInput(event.target.value, prev.speechRate), 0.5, 2),
                  }))
                }
              />
            </div>
            <p className="settings-drawer__hint">
              {speechOutputAdjustmentSupport.rate
                ? '值越大，说话越快。'
                : '当前提供商暂不直通语速调节。'}
            </p>
          </div>

          <div className={`settings-tts-tuning__item ${speechOutputAdjustmentSupport.pitch ? '' : 'is-disabled'}`}>
            <div className="settings-tts-tuning__header">
              <strong>语调</strong>
              <span>{formatTtsAdjustmentValue('pitch', draft.speechPitch)}</span>
            </div>
            <div className="settings-tts-tuning__controls">
              <input
                className="settings-tts-tuning__range"
                type="range"
                min="0.5"
                max="2"
                step="0.05"
                value={draft.speechPitch}
                disabled={!speechOutputAdjustmentSupport.pitch}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    speechPitch: clampNumber(parseNumberInput(event.target.value, prev.speechPitch), 0.5, 2),
                  }))
                }
              />
              <input
                className="settings-tts-tuning__number"
                type="number"
                min="0.5"
                max="2"
                step="0.05"
                value={draft.speechPitch}
                disabled={!speechOutputAdjustmentSupport.pitch}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    speechPitch: clampNumber(parseNumberInput(event.target.value, prev.speechPitch), 0.5, 2),
                  }))
                }
              />
            </div>
            <p className="settings-drawer__hint">
              {speechOutputAdjustmentSupport.pitch
                ? '值越大，整体音调越高。'
                : '当前提供商暂不支持直接调节语调。'}
            </p>
          </div>

          <div className={`settings-tts-tuning__item ${speechOutputAdjustmentSupport.volume ? '' : 'is-disabled'}`}>
            <div className="settings-tts-tuning__header">
              <strong>音量</strong>
              <span>{formatTtsAdjustmentValue('volume', draft.speechVolume)}</span>
            </div>
            <div className="settings-tts-tuning__controls">
              <input
                className="settings-tts-tuning__range"
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={draft.speechVolume}
                disabled={!speechOutputAdjustmentSupport.volume}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    speechVolume: clampNumber(parseNumberInput(event.target.value, prev.speechVolume), 0, 1),
                  }))
                }
              />
              <input
                className="settings-tts-tuning__number"
                type="number"
                min="0"
                max="1"
                step="0.05"
                value={draft.speechVolume}
                disabled={!speechOutputAdjustmentSupport.volume}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    speechVolume: clampNumber(parseNumberInput(event.target.value, prev.speechVolume), 0, 1),
                  }))
                }
              />
            </div>
            <p className="settings-drawer__hint">
              {speechOutputAdjustmentSupport.volume
                ? '这里只调 TTS 输出响度，不会改系统总音量。'
                : '当前提供商暂不支持直接调节音量。'}
            </p>
          </div>
        </div>
      </div>

      <label>
        <span>试听文本</span>
        <textarea
          rows={3}
          value={speechPreviewText}
          onChange={(event) => setSpeechPreviewText(event.target.value)}
        />
      </label>

      <button
        type="button"
        className="ghost-button"
        onClick={onPreviewSpeech}
        disabled={previewingSpeech}
      >
        {previewingSpeech ? '试听中...' : '试听当前音色'}
      </button>

      {speechPreviewStatus ? (
        <div className={speechPreviewStatus.ok ? 'settings-test-result is-success' : 'settings-test-result is-error'}>
          {speechPreviewStatus.message}
        </div>
      ) : null}

      {renderSpeechOutputTestResult()}
    </section>
  )
})
