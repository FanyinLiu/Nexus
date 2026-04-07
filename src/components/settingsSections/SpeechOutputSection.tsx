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
  isBrowserSpeechOutputProvider,
  isCoquiSpeechOutputProvider,
  isEdgeTtsSpeechOutputProvider,
  isLocalSherpaSpeechOutputProvider,
  isMiniMaxSpeechOutputProvider,
  isPiperSpeechOutputProvider,
  isVolcengineSpeechOutputProvider,
  USER_VISIBLE_SPEECH_OUTPUT_PROVIDER_PRESETS,
} from '../../lib/audioProviders'
import { updateCurrentSpeechOutputProviderProfile } from '../../lib/speechProviderProfiles'
import type {
  AppSettings,
  ServiceConnectionCapability,
  SpeechVoiceOption,
} from '../../types'

type BrowserVoiceOption = {
  id: string
  name: string
  lang: string
  localService: boolean
  default: boolean
}

type SpeechOutputSectionProps = {
  active: boolean
  draft: AppSettings
  setDraft: Dispatch<SetStateAction<AppSettings>>
  localVoices: BrowserVoiceOption[]
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
  localVoices,
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
  const isLocalSherpaSpeechOutput = isLocalSherpaSpeechOutputProvider(draft.speechOutputProviderId)
  const isPiperSpeechOutput = isPiperSpeechOutputProvider(draft.speechOutputProviderId)
  const isCoquiSpeechOutput = isCoquiSpeechOutputProvider(draft.speechOutputProviderId)
  const isEdgeTtsSpeechOutput = isEdgeTtsSpeechOutputProvider(draft.speechOutputProviderId)
  const isLocalCliSpeechOutput = isPiperSpeechOutput || isCoquiSpeechOutput
  const isCosyVoiceSpeechOutput = draft.speechOutputProviderId === 'cosyvoice-tts'
  const hideApiCredentials = isEdgeTtsSpeechOutput || isLocalCliSpeechOutput
  const speechOutputVolcengineCredentials = parseVolcengineCredentialParts(draft.speechOutputApiKey)
  const speechOutputBaseUrlLabel = isPiperSpeechOutput
    ? 'Piper 可执行文件路径'
    : isCoquiSpeechOutput
      ? 'Coqui 命令路径'
      : '语音输出接口地址'
  const speechOutputBaseUrlHint = isPiperSpeechOutput
    ? '留空时会直接使用系统 PATH 里的 `piper` 命令；如果你是便携版或自定义安装目录，这里填写 `piper.exe` 的绝对路径即可。'
    : isCoquiSpeechOutput
      ? '留空时会直接使用系统 PATH 里的 `tts` 命令；如果你有独立环境或脚本包装器，这里填写实际可执行命令路径。'
      : ''
  const speechOutputModelLabel = isVolcengineSpeechOutput
    ? '语音业务集群'
    : isPiperSpeechOutput
      ? 'Piper 模型 (.onnx)'
      : isCoquiSpeechOutput
        ? 'Coqui model_name'
        : '语音输出模型'
  const speechOutputModelHint = isPiperSpeechOutput
    ? '这里填写本地 Piper `.onnx` 音色模型路径，例如 `F:\\models\\zh_CN-huayan-medium.onnx`。这是必填项。'
    : isCoquiSpeechOutput
      ? '这里填写 Coqui CLI 可识别的 `model_name`，例如 `tts_models/zh-CN/baker/tacotron2-DDC-GST`。这是必填项。'
      : ''
  const speechOutputVoiceLabel = isVolcengineSpeechOutput
    ? '播报音色类型'
    : isLocalSherpaSpeechOutput
      ? '本地 Speaker SID'
      : isPiperSpeechOutput
        ? 'Piper speaker id（可选）'
        : isCoquiSpeechOutput
          ? 'Coqui speaker_idx / speaker（可选）'
          : isCosyVoiceSpeechOutput
            ? 'CosyVoice2 音色 / spk_id'
            : '播报音色 / 音色 ID'
  const speechOutputVoiceHint = isLocalSherpaSpeechOutput
    ? '这里填写的是 Sherpa TTS 的 speaker sid。未填写或填错时会自动回退到 `0`。'
    : isPiperSpeechOutput
      ? '多说话人 Piper 模型可以在这里填 speaker id；单说话人模型留空即可，运行时会走模型默认 speaker。'
      : isCoquiSpeechOutput
        ? '多说话人 Coqui 模型可以在这里填 `speaker_idx` 或 speaker 名称；留空时会让 CLI 按模型默认值合成。'
        : ''

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

      {isBrowserSpeechOutputProvider(draft.speechOutputProviderId) ? (
        <>
          <label>
            <span>本地系统音色</span>
            <select
              value={draft.speechOutputVoice}
              onChange={(event) =>
                setDraft((prev) => updateCurrentSpeechOutputProviderProfile(prev, {
                  voice: event.target.value,
                }))
              }
            >
              <option value="">自动匹配当前语言</option>
              {localVoices.map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {voice.name} ({voice.lang})
                  {voice.default ? ' · 默认' : ''}
                  {voice.localService ? ' · 本地' : ''}
                </option>
              ))}
            </select>
          </label>

          <p className="settings-drawer__hint">
            本地系统语音不会走云端。若系统里安装了中文女声，这里可以直接选中使用。
          </p>
        </>
      ) : isEdgeTtsSpeechOutput ? (
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

          {isMiniMaxSpeechOutputProvider(draft.speechOutputProviderId) || isLocalSherpaSpeechOutput ? (
            <>
              <div className="settings-section__title-row">
                <div>
                  <p className="settings-drawer__hint">
                    {isLocalSherpaSpeechOutput
                      ? '本地 Sherpa TTS 会按当前模型实际支持的 speaker 数返回 sid 列表。切换模型后建议先刷新一次。'
                      : 'MiniMax 已接入在线音色列表。保存前可以先刷新一次，确认下拉选项和当前密钥都正常。'}
                  </p>
                </div>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={onLoadSpeechVoices}
                  disabled={loadingSpeechVoices}
                >
                  {loadingSpeechVoices ? '拉取中...' : (isLocalSherpaSpeechOutput ? '刷新本地 Speaker' : '刷新 MiniMax 音色')}
                </button>
              </div>

              <label>
                <span>{isLocalSherpaSpeechOutput ? '本地 Sherpa 可选 Speaker' : 'MiniMax 可选音色'}</span>
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
                      : (isLocalSherpaSpeechOutput ? '请选择一个本地 Speaker sid' : '请选择一个 MiniMax 音色')}
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
                    ?? (isLocalSherpaSpeechOutput
                      ? '已加载本地 Sherpa speaker 列表，也可以继续手动填写 sid。'
                      : '已加载 MiniMax 音色列表，也可以继续手动填写音色 ID。')}
                </p>
              ) : null}
            </>
          ) : null}

          {speechVoiceOptions.length
            && !isMiniMaxSpeechOutputProvider(draft.speechOutputProviderId)
            && !isLocalCliSpeechOutput ? (
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

          {!isLocalCliSpeechOutput ? (
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
          ) : null}
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
