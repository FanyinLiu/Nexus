/**
 * Unified provider catalog.
 *
 * Every speech-input, speech-output, text, and web-search provider is registered
 * here with its full metadata. The rest of the codebase queries the catalog
 * instead of using scattered if-checks and switch statements.
 *
 * User-facing text (`label`, `notes`, `description`, `note`) is stored as
 * TranslationKey literals. Consumers are responsible for resolving them via
 * `pickTranslatedUiText` / `ti()` at display time.
 *
 * To add a new provider:
 *   1. Append an entry to the relevant array below.
 *   2. If the provider uses a new protocol, add the protocol literal.
 *   3. Register the new translation keys in `src/i18n/keys.ts`,
 *      `src/types/i18n.ts`, and every locale file under `src/i18n/locales/`.
 */

import type { TranslationKey } from '../types/i18n'


// ── Shared types ──

export type SpeechModelOption = {
  value: string
  label: TranslationKey
}

export type SpeechVoiceOption = {
  id: string
  label: TranslationKey
  description?: TranslationKey
  /**
   * Volcengine: when true, the voice requires console authorization. Consumers
   * should append `provider.tts.voice.volcengine.needs_auth_suffix` to the
   * resolved label and swap the description with
   * `provider.tts.voice.volcengine.needs_auth_fallback` at display time.
   */
  needsAuth?: boolean
}

export type SpeechStyleOption = {
  value: string
  label: TranslationKey
  description?: TranslationKey
}

export type SpeechOutputAdjustmentSupport = {
  rate: boolean
  pitch: boolean
  volume: boolean
  note: TranslationKey
}

// ── Speech input provider catalog ──

export type SpeechInputProtocol =
  | 'sensevoice'
  | 'paraformer'
  | 'openai-compatible'
  | 'elevenlabs'
  | 'volcengine'
  | 'tencent'

export type SpeechInputProviderEntry = {
  id: string
  label: TranslationKey
  baseUrl: string
  defaultModel: string
  notes: TranslationKey
  protocol: SpeechInputProtocol
  kind: 'local' | 'remote' | 'browser'
  hidden: boolean
  modelOptions: SpeechModelOption[]
}

export const SPEECH_INPUT_PROVIDERS: SpeechInputProviderEntry[] = [
  {
    id: 'local-sensevoice',
    label: 'provider.stt.local-sensevoice.label',
    baseUrl: '',
    defaultModel: 'sensevoice-zh-en',
    notes: 'provider.stt.local-sensevoice.notes',
    protocol: 'sensevoice',
    kind: 'local',
    hidden: false,
    modelOptions: [
      { value: 'sensevoice-zh-en', label: 'provider.stt.local-sensevoice.model.sensevoice-zh-en.label' },
    ],
  },
  {
    id: 'local-paraformer',
    label: 'provider.stt.local-paraformer.label',
    baseUrl: '',
    defaultModel: 'paraformer-trilingual',
    notes: 'provider.stt.local-paraformer.notes',
    protocol: 'paraformer',
    kind: 'local',
    hidden: false,
    modelOptions: [
      { value: 'paraformer-trilingual', label: 'provider.stt.local-paraformer.model.paraformer-trilingual.label' },
      { value: 'paraformer-zh-en', label: 'provider.stt.local-paraformer.model.paraformer-zh-en.label' },
    ],
  },
  {
    id: 'volcengine-stt',
    label: 'provider.stt.volcengine-stt.label',
    baseUrl: 'https://openspeech.bytedance.com/api/v3/auc/bigmodel',
    defaultModel: 'bigmodel',
    notes: 'provider.stt.volcengine-stt.notes',
    protocol: 'volcengine',
    kind: 'remote',
    hidden: false,
    modelOptions: [
      { value: 'bigmodel', label: 'provider.stt.volcengine-stt.model.bigmodel.label' },
    ],
  },
  {
    id: 'openai-stt',
    label: 'provider.stt.openai-stt.label',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini-transcribe',
    notes: 'provider.stt.openai-stt.notes',
    protocol: 'openai-compatible',
    kind: 'remote',
    hidden: false,
    modelOptions: [
      { value: 'gpt-4o-mini-transcribe', label: 'provider.stt.openai-stt.model.gpt-4o-mini-transcribe.label' },
      { value: 'gpt-4o-transcribe', label: 'provider.stt.openai-stt.model.gpt-4o-transcribe.label' },
      { value: 'whisper-1', label: 'provider.stt.openai-stt.model.whisper-1.label' },
    ],
  },
  {
    id: 'elevenlabs-stt',
    label: 'provider.stt.elevenlabs-stt.label',
    baseUrl: 'https://api.elevenlabs.io/v1',
    defaultModel: 'scribe_v1',
    notes: 'provider.stt.elevenlabs-stt.notes',
    protocol: 'elevenlabs',
    kind: 'remote',
    hidden: false,
    modelOptions: [
      { value: 'scribe_v1', label: 'provider.stt.elevenlabs-stt.model.scribe_v1.label' },
    ],
  },
  {
    id: 'zhipu-stt',
    label: 'provider.stt.zhipu-stt.label',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-asr-2512',
    notes: 'provider.stt.zhipu-stt.notes',
    protocol: 'openai-compatible',
    kind: 'remote',
    hidden: false,
    modelOptions: [
      { value: 'glm-asr-2512', label: 'provider.stt.zhipu-stt.model.glm-asr-2512.label' },
      { value: 'glm-asr', label: 'provider.stt.zhipu-stt.model.glm-asr.label' },
    ],
  },
  {
    id: 'glm-asr-local',
    label: 'provider.stt.glm-asr-local.label',
    baseUrl: 'http://127.0.0.1:8001/v1',
    defaultModel: 'glm-asr-nano',
    notes: 'provider.stt.glm-asr-local.notes',
    protocol: 'openai-compatible',
    kind: 'local',
    hidden: false,
    modelOptions: [
      { value: 'glm-asr-nano', label: 'provider.stt.glm-asr-local.model.glm-asr-nano.label' },
    ],
  },
  {
    id: 'custom-openai-stt',
    label: 'provider.stt.custom-openai-stt.label',
    baseUrl: '',
    defaultModel: 'gpt-4o-mini-transcribe',
    notes: 'provider.stt.custom-openai-stt.notes',
    protocol: 'openai-compatible',
    kind: 'remote',
    hidden: false,
    modelOptions: [],
  },
  {
    id: 'tencent-asr',
    label: 'provider.stt.tencent-asr.label',
    baseUrl: '',
    defaultModel: '16k_zh',
    notes: 'provider.stt.tencent-asr.notes',
    protocol: 'tencent',
    kind: 'remote',
    hidden: false,
    modelOptions: [
      { value: '16k_zh', label: 'provider.stt.tencent-asr.model.16k_zh.label' },
      { value: '16k_zh_large', label: 'provider.stt.tencent-asr.model.16k_zh_large.label' },
      { value: '16k_en', label: 'provider.stt.tencent-asr.model.16k_en.label' },
      { value: '16k_zh_en', label: 'provider.stt.tencent-asr.model.16k_zh_en.label' },
      { value: '16k_ja', label: 'provider.stt.tencent-asr.model.16k_ja.label' },
      { value: '16k_ko', label: 'provider.stt.tencent-asr.model.16k_ko.label' },
    ],
  },
]

// ── Speech output provider catalog ──

export type SpeechOutputProtocol =
  | 'openai-compatible'
  | 'minimax'
  | 'volcengine'
  | 'dashscope'
  | 'elevenlabs'
  | 'edge-tts'

export type SpeechOutputProviderEntry = {
  id: string
  label: TranslationKey
  baseUrl: string
  defaultModel: string
  defaultVoice: string
  notes: TranslationKey
  protocol: SpeechOutputProtocol
  kind: 'local' | 'remote' | 'browser'
  hidden: boolean
  supportsStreaming: boolean
  supportsCustomVoiceId: boolean
  modelOptions: SpeechModelOption[]
  fallbackVoiceOptions: SpeechVoiceOption[]
  styleOptions: SpeechStyleOption[]
  adjustmentSupport: SpeechOutputAdjustmentSupport
}

const OPENAI_TTS_VOICE_OPTIONS: SpeechVoiceOption[] = [
  { id: 'alloy', label: 'provider.tts.voice.openai.alloy.label', description: 'provider.tts.voice.openai.alloy.description' },
  { id: 'ash', label: 'provider.tts.voice.openai.ash.label', description: 'provider.tts.voice.openai.ash.description' },
  { id: 'ballad', label: 'provider.tts.voice.openai.ballad.label', description: 'provider.tts.voice.openai.ballad.description' },
  { id: 'coral', label: 'provider.tts.voice.openai.coral.label', description: 'provider.tts.voice.openai.coral.description' },
  { id: 'echo', label: 'provider.tts.voice.openai.echo.label', description: 'provider.tts.voice.openai.echo.description' },
  { id: 'fable', label: 'provider.tts.voice.openai.fable.label', description: 'provider.tts.voice.openai.fable.description' },
  { id: 'onyx', label: 'provider.tts.voice.openai.onyx.label', description: 'provider.tts.voice.openai.onyx.description' },
  { id: 'nova', label: 'provider.tts.voice.openai.nova.label', description: 'provider.tts.voice.openai.nova.description' },
  { id: 'sage', label: 'provider.tts.voice.openai.sage.label', description: 'provider.tts.voice.openai.sage.description' },
  { id: 'shimmer', label: 'provider.tts.voice.openai.shimmer.label', description: 'provider.tts.voice.openai.shimmer.description' },
]

const OPENAI_TTS_STYLE_OPTIONS: SpeechStyleOption[] = [
  { value: '', label: 'provider.tts.style.openai.0.label', description: 'provider.tts.style.openai.0.description' },
  { value: 'Speak in a warm, gentle tone like a caring companion. Keep the pacing natural and smile softly through the words.', label: 'provider.tts.style.openai.1.label', description: 'provider.tts.style.openai.1.description' },
  { value: 'Speak in a bright, cheerful, energetic tone with crisp articulation.', label: 'provider.tts.style.openai.2.label', description: 'provider.tts.style.openai.2.description' },
  { value: 'Speak in a calm, steady narrator voice with thoughtful pacing.', label: 'provider.tts.style.openai.3.label', description: 'provider.tts.style.openai.3.description' },
  { value: 'Speak as if reading a bedtime story — warm, slow, full of emotion.', label: 'provider.tts.style.openai.4.label', description: 'provider.tts.style.openai.4.description' },
  { value: 'Speak in a relaxed, casual conversational tone like chatting with a friend.', label: 'provider.tts.style.openai.5.label', description: 'provider.tts.style.openai.5.description' },
]

const ELEVENLABS_PRESET_VOICE_OPTIONS: SpeechVoiceOption[] = [
  { id: '21m00Tcm4TlvDq8ikWAM', label: 'provider.tts.voice.elevenlabs.21m00Tcm4TlvDq8ikWAM.label', description: 'provider.tts.voice.elevenlabs.21m00Tcm4TlvDq8ikWAM.description' },
  { id: 'EXAVITQu4vr4xnSDxMaL', label: 'provider.tts.voice.elevenlabs.EXAVITQu4vr4xnSDxMaL.label', description: 'provider.tts.voice.elevenlabs.EXAVITQu4vr4xnSDxMaL.description' },
  { id: 'AZnzlk1XvdvUeBnXmlld', label: 'provider.tts.voice.elevenlabs.AZnzlk1XvdvUeBnXmlld.label', description: 'provider.tts.voice.elevenlabs.AZnzlk1XvdvUeBnXmlld.description' },
  { id: 'MF3mGyEYCl7XYWbV9V6O', label: 'provider.tts.voice.elevenlabs.MF3mGyEYCl7XYWbV9V6O.label', description: 'provider.tts.voice.elevenlabs.MF3mGyEYCl7XYWbV9V6O.description' },
  { id: 'pNInz6obpgDQGcFmaJgB', label: 'provider.tts.voice.elevenlabs.pNInz6obpgDQGcFmaJgB.label', description: 'provider.tts.voice.elevenlabs.pNInz6obpgDQGcFmaJgB.description' },
  { id: 'ErXwobaYiN019PkySvjV', label: 'provider.tts.voice.elevenlabs.ErXwobaYiN019PkySvjV.label', description: 'provider.tts.voice.elevenlabs.ErXwobaYiN019PkySvjV.description' },
  { id: 'TxGEqnHWrfWFTfGW9XjX', label: 'provider.tts.voice.elevenlabs.TxGEqnHWrfWFTfGW9XjX.label', description: 'provider.tts.voice.elevenlabs.TxGEqnHWrfWFTfGW9XjX.description' },
  { id: 'VR6AewLTigWG4xSOukaG', label: 'provider.tts.voice.elevenlabs.VR6AewLTigWG4xSOukaG.label', description: 'provider.tts.voice.elevenlabs.VR6AewLTigWG4xSOukaG.description' },
]

const DASHSCOPE_VOICE_OPTIONS: SpeechVoiceOption[] = [
  { id: 'Cherry', label: 'provider.tts.voice.dashscope.Cherry.label', description: 'provider.tts.voice.dashscope.Cherry.description' },
]

const VOLCENGINE_DIRECTLY_AVAILABLE_VOICE_IDS = new Set([
  'BV001_streaming',
  'BV002_streaming',
])

function buildVolcengineVoiceOptions(): SpeechVoiceOption[] {
  const raw: SpeechVoiceOption[] = [
    { id: 'BV001_streaming', label: 'provider.tts.voice.volcengine.BV001_streaming.label', description: 'provider.tts.voice.volcengine.BV001_streaming.description' },
    { id: 'BV002_streaming', label: 'provider.tts.voice.volcengine.BV002_streaming.label', description: 'provider.tts.voice.volcengine.BV002_streaming.description' },
    { id: 'BV700_streaming', label: 'provider.tts.voice.volcengine.BV700_streaming.label', description: 'provider.tts.voice.volcengine.BV700_streaming.description' },
    { id: 'BV700_V2_streaming', label: 'provider.tts.voice.volcengine.BV700_V2_streaming.label', description: 'provider.tts.voice.volcengine.BV700_V2_streaming.description' },
    { id: 'BV405', label: 'provider.tts.voice.volcengine.BV405.label', description: 'provider.tts.voice.volcengine.BV405.description' },
    { id: 'BV418', label: 'provider.tts.voice.volcengine.BV418.label', description: 'provider.tts.voice.volcengine.BV418.description' },
    { id: 'BV419', label: 'provider.tts.voice.volcengine.BV419.label', description: 'provider.tts.voice.volcengine.BV419.description' },
    { id: 'BV009_DPE_ParaTaco', label: 'provider.tts.voice.volcengine.BV009_DPE_ParaTaco.label', description: 'provider.tts.voice.volcengine.BV009_DPE_ParaTaco.description' },
    { id: 'BV008_DPE_ParaTaco', label: 'provider.tts.voice.volcengine.BV008_DPE_ParaTaco.label', description: 'provider.tts.voice.volcengine.BV008_DPE_ParaTaco.description' },
    { id: 'BV005_ParaTaco', label: 'provider.tts.voice.volcengine.BV005_ParaTaco.label', description: 'provider.tts.voice.volcengine.BV005_ParaTaco.description' },
    { id: 'BV007_ParaTaco', label: 'provider.tts.voice.volcengine.BV007_ParaTaco.label', description: 'provider.tts.voice.volcengine.BV007_ParaTaco.description' },
    { id: 'BV057_ParaTaco', label: 'provider.tts.voice.volcengine.BV057_ParaTaco.label', description: 'provider.tts.voice.volcengine.BV057_ParaTaco.description' },
  ]

  return raw.map((voice) => {
    if (VOLCENGINE_DIRECTLY_AVAILABLE_VOICE_IDS.has(voice.id)) return voice

    return {
      ...voice,
      needsAuth: true,
    }
  })
}

export const SPEECH_OUTPUT_PROVIDERS: SpeechOutputProviderEntry[] = [
  {
    id: 'openai-tts',
    label: 'provider.tts.openai-tts.label',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini-tts',
    defaultVoice: 'alloy',
    notes: 'provider.tts.openai-tts.notes',
    protocol: 'openai-compatible',
    kind: 'remote',
    hidden: false,
    supportsStreaming: false,
    supportsCustomVoiceId: false,
    modelOptions: [
      { value: 'gpt-4o-mini-tts', label: 'provider.tts.openai-tts.model.gpt-4o-mini-tts.label' },
      { value: 'tts-1', label: 'provider.tts.openai-tts.model.tts-1.label' },
      { value: 'tts-1-hd', label: 'provider.tts.openai-tts.model.tts-1-hd.label' },
    ],
    fallbackVoiceOptions: OPENAI_TTS_VOICE_OPTIONS,
    styleOptions: OPENAI_TTS_STYLE_OPTIONS,
    adjustmentSupport: { rate: false, pitch: false, volume: false, note: 'provider.tts.openai-tts.adjustment.note' },
  },
  {
    id: 'minimax-tts',
    label: 'provider.tts.minimax-tts.label',
    baseUrl: 'https://api.minimaxi.com/v1',
    defaultModel: 'speech-2.8-turbo',
    defaultVoice: 'female-shaonv',
    notes: 'provider.tts.minimax-tts.notes',
    protocol: 'minimax',
    kind: 'remote',
    hidden: false,
    supportsStreaming: true,
    supportsCustomVoiceId: true,
    styleOptions: [],
    modelOptions: [
      { value: 'speech-2.8-turbo', label: 'provider.tts.minimax-tts.model.speech-2.8-turbo.label' },
      { value: 'speech-2.8-hd', label: 'provider.tts.minimax-tts.model.speech-2.8-hd.label' },
      { value: 'speech-2.6-turbo', label: 'provider.tts.minimax-tts.model.speech-2.6-turbo.label' },
      { value: 'speech-2.6-hd', label: 'provider.tts.minimax-tts.model.speech-2.6-hd.label' },
      { value: 'speech-02-turbo', label: 'provider.tts.minimax-tts.model.speech-02-turbo.label' },
      { value: 'speech-02-hd', label: 'provider.tts.minimax-tts.model.speech-02-hd.label' },
      { value: 'speech-01-turbo', label: 'provider.tts.minimax-tts.model.speech-01-turbo.label' },
      { value: 'speech-01-hd', label: 'provider.tts.minimax-tts.model.speech-01-hd.label' },
    ],
    fallbackVoiceOptions: [
      { id: 'female-shaonv', label: 'provider.tts.minimax-tts.voice.female-shaonv.label', description: 'provider.tts.minimax-tts.voice.female-shaonv.description' },
      { id: 'female-tianmei', label: 'provider.tts.minimax-tts.voice.female-tianmei.label', description: 'provider.tts.minimax-tts.voice.female-tianmei.description' },
      { id: 'female-yujie', label: 'provider.tts.minimax-tts.voice.female-yujie.label', description: 'provider.tts.minimax-tts.voice.female-yujie.description' },
      { id: 'female-chengshu', label: 'provider.tts.minimax-tts.voice.female-chengshu.label', description: 'provider.tts.minimax-tts.voice.female-chengshu.description' },
      { id: 'female-shaonv-jingpin', label: 'provider.tts.minimax-tts.voice.female-shaonv-jingpin.label', description: 'provider.tts.minimax-tts.voice.female-shaonv-jingpin.description' },
      { id: 'female-yujie-jingpin', label: 'provider.tts.minimax-tts.voice.female-yujie-jingpin.label', description: 'provider.tts.minimax-tts.voice.female-yujie-jingpin.description' },
      { id: 'female-chengshu-jingpin', label: 'provider.tts.minimax-tts.voice.female-chengshu-jingpin.label', description: 'provider.tts.minimax-tts.voice.female-chengshu-jingpin.description' },
      { id: 'male-qn-daxuesheng', label: 'provider.tts.minimax-tts.voice.male-qn-daxuesheng.label', description: 'provider.tts.minimax-tts.voice.male-qn-daxuesheng.description' },
    ],
    adjustmentSupport: { rate: true, pitch: true, volume: true, note: 'provider.tts.minimax-tts.adjustment.note' },
  },
  {
    id: 'volcengine-tts',
    label: 'provider.tts.volcengine-tts.label',
    baseUrl: 'https://openspeech.bytedance.com/api',
    defaultModel: 'volcano_tts',
    defaultVoice: 'BV001_streaming',
    notes: 'provider.tts.volcengine-tts.notes',
    protocol: 'volcengine',
    kind: 'remote',
    hidden: false,
    supportsStreaming: true,
    supportsCustomVoiceId: true,
    styleOptions: [],
    modelOptions: [],
    fallbackVoiceOptions: buildVolcengineVoiceOptions(),
    adjustmentSupport: { rate: true, pitch: true, volume: true, note: 'provider.tts.volcengine-tts.adjustment.note' },
  },
  {
    id: 'dashscope-tts',
    label: 'provider.tts.dashscope-tts.label',
    baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
    defaultModel: 'qwen3-tts-instruct-flash',
    defaultVoice: 'Cherry',
    notes: 'provider.tts.dashscope-tts.notes',
    protocol: 'dashscope',
    kind: 'remote',
    hidden: false,
    supportsStreaming: true,
    supportsCustomVoiceId: true,
    modelOptions: [
      { value: 'qwen3-tts-instruct-flash', label: 'provider.tts.dashscope-tts.model.qwen3-tts-instruct-flash.label' },
      { value: 'qwen3-tts-flash', label: 'provider.tts.dashscope-tts.model.qwen3-tts-flash.label' },
    ],
    fallbackVoiceOptions: DASHSCOPE_VOICE_OPTIONS,
    styleOptions: [],
    adjustmentSupport: { rate: false, pitch: false, volume: false, note: 'provider.tts.dashscope-tts.adjustment.note' },
  },
  {
    id: 'elevenlabs-tts',
    label: 'provider.tts.elevenlabs-tts.label',
    baseUrl: 'https://api.elevenlabs.io/v1',
    defaultModel: 'eleven_multilingual_v2',
    defaultVoice: '21m00Tcm4TlvDq8ikWAM',
    notes: 'provider.tts.elevenlabs-tts.notes',
    protocol: 'elevenlabs',
    kind: 'remote',
    hidden: false,
    supportsStreaming: true,
    supportsCustomVoiceId: true,
    modelOptions: [
      { value: 'eleven_multilingual_v2', label: 'provider.tts.elevenlabs-tts.model.eleven_multilingual_v2.label' },
      { value: 'eleven_turbo_v2_5', label: 'provider.tts.elevenlabs-tts.model.eleven_turbo_v2_5.label' },
      { value: 'eleven_flash_v2_5', label: 'provider.tts.elevenlabs-tts.model.eleven_flash_v2_5.label' },
    ],
    fallbackVoiceOptions: ELEVENLABS_PRESET_VOICE_OPTIONS,
    styleOptions: [],
    adjustmentSupport: { rate: false, pitch: false, volume: false, note: 'provider.tts.elevenlabs-tts.adjustment.note' },
  },
  {
    id: 'edge-tts',
    label: 'provider.tts.edge-tts.label',
    baseUrl: '',
    defaultModel: '',
    defaultVoice: 'zh-CN-XiaoxiaoNeural',
    notes: 'provider.tts.edge-tts.notes',
    protocol: 'edge-tts',
    kind: 'remote',
    hidden: false,
    supportsStreaming: true,
    supportsCustomVoiceId: false,
    styleOptions: [],
    modelOptions: [],
    fallbackVoiceOptions: [
      { id: 'zh-CN-XiaoxiaoNeural', label: 'provider.tts.edge-tts.voice.zh-CN-XiaoxiaoNeural.label', description: 'provider.tts.edge-tts.voice.zh-CN-XiaoxiaoNeural.description' },
      { id: 'zh-CN-XiaoyiNeural', label: 'provider.tts.edge-tts.voice.zh-CN-XiaoyiNeural.label', description: 'provider.tts.edge-tts.voice.zh-CN-XiaoyiNeural.description' },
      { id: 'zh-CN-YunjianNeural', label: 'provider.tts.edge-tts.voice.zh-CN-YunjianNeural.label', description: 'provider.tts.edge-tts.voice.zh-CN-YunjianNeural.description' },
      { id: 'zh-CN-YunxiNeural', label: 'provider.tts.edge-tts.voice.zh-CN-YunxiNeural.label', description: 'provider.tts.edge-tts.voice.zh-CN-YunxiNeural.description' },
      { id: 'zh-CN-YunyangNeural', label: 'provider.tts.edge-tts.voice.zh-CN-YunyangNeural.label', description: 'provider.tts.edge-tts.voice.zh-CN-YunyangNeural.description' },
      { id: 'en-US-AriaNeural', label: 'provider.tts.edge-tts.voice.en-US-AriaNeural.label', description: 'provider.tts.edge-tts.voice.en-US-AriaNeural.description' },
      { id: 'en-US-GuyNeural', label: 'provider.tts.edge-tts.voice.en-US-GuyNeural.label', description: 'provider.tts.edge-tts.voice.en-US-GuyNeural.description' },
      { id: 'ja-JP-NanamiNeural', label: 'provider.tts.edge-tts.voice.ja-JP-NanamiNeural.label', description: 'provider.tts.edge-tts.voice.ja-JP-NanamiNeural.description' },
    ],
    adjustmentSupport: { rate: true, pitch: true, volume: true, note: 'provider.tts.edge-tts.adjustment.note' },
  },
  {
    id: 'omnivoice-tts',
    label: 'provider.tts.omnivoice-tts.label',
    baseUrl: 'http://127.0.0.1:8000/v1',
    defaultModel: 'tts-1-hd',
    defaultVoice: 'female, young adult',
    notes: 'provider.tts.omnivoice-tts.notes',
    protocol: 'openai-compatible',
    kind: 'local',
    hidden: false,
    supportsStreaming: false,
    supportsCustomVoiceId: true,
    styleOptions: OPENAI_TTS_STYLE_OPTIONS,
    modelOptions: [
      { value: 'tts-1-hd', label: 'provider.tts.omnivoice-tts.model.tts-1-hd.label' },
      { value: 'tts-1', label: 'provider.tts.omnivoice-tts.model.tts-1.label' },
    ],
    fallbackVoiceOptions: [
      { id: 'female, young adult', label: 'provider.tts.omnivoice-tts.voice.female-young-adult.label', description: 'provider.tts.omnivoice-tts.voice.female-young-adult.description' },
      { id: 'female', label: 'provider.tts.omnivoice-tts.voice.female.label', description: 'provider.tts.omnivoice-tts.voice.female.description' },
      { id: 'female, child', label: 'provider.tts.omnivoice-tts.voice.female-child.label', description: 'provider.tts.omnivoice-tts.voice.female-child.description' },
      { id: 'female, teenager', label: 'provider.tts.omnivoice-tts.voice.female-teenager.label', description: 'provider.tts.omnivoice-tts.voice.female-teenager.description' },
      { id: 'female, middle-aged', label: 'provider.tts.omnivoice-tts.voice.female-middle-aged.label', description: 'provider.tts.omnivoice-tts.voice.female-middle-aged.description' },
      { id: 'female, elderly', label: 'provider.tts.omnivoice-tts.voice.female-elderly.label', description: 'provider.tts.omnivoice-tts.voice.female-elderly.description' },
      { id: 'male, young adult', label: 'provider.tts.omnivoice-tts.voice.male-young-adult.label', description: 'provider.tts.omnivoice-tts.voice.male-young-adult.description' },
      { id: 'male', label: 'provider.tts.omnivoice-tts.voice.male.label', description: 'provider.tts.omnivoice-tts.voice.male.description' },
      { id: 'male, child', label: 'provider.tts.omnivoice-tts.voice.male-child.label', description: 'provider.tts.omnivoice-tts.voice.male-child.description' },
      { id: 'male, teenager', label: 'provider.tts.omnivoice-tts.voice.male-teenager.label', description: 'provider.tts.omnivoice-tts.voice.male-teenager.description' },
      { id: 'male, middle-aged', label: 'provider.tts.omnivoice-tts.voice.male-middle-aged.label', description: 'provider.tts.omnivoice-tts.voice.male-middle-aged.description' },
      { id: 'male, elderly', label: 'provider.tts.omnivoice-tts.voice.male-elderly.label', description: 'provider.tts.omnivoice-tts.voice.male-elderly.description' },
      { id: 'female, whisper', label: 'provider.tts.omnivoice-tts.voice.female-whisper.label', description: 'provider.tts.omnivoice-tts.voice.female-whisper.description' },
      { id: 'male, whisper', label: 'provider.tts.omnivoice-tts.voice.male-whisper.label', description: 'provider.tts.omnivoice-tts.voice.male-whisper.description' },
      { id: 'female, high pitch', label: 'provider.tts.omnivoice-tts.voice.female-high-pitch.label', description: 'provider.tts.omnivoice-tts.voice.female-high-pitch.description' },
      { id: 'female, low pitch', label: 'provider.tts.omnivoice-tts.voice.female-low-pitch.label', description: 'provider.tts.omnivoice-tts.voice.female-low-pitch.description' },
      { id: 'male, high pitch', label: 'provider.tts.omnivoice-tts.voice.male-high-pitch.label', description: 'provider.tts.omnivoice-tts.voice.male-high-pitch.description' },
      { id: 'male, low pitch', label: 'provider.tts.omnivoice-tts.voice.male-low-pitch.label', description: 'provider.tts.omnivoice-tts.voice.male-low-pitch.description' },
    ],
    adjustmentSupport: { rate: true, pitch: false, volume: false, note: 'provider.tts.omnivoice-tts.adjustment.note' },
  },
  {
    id: 'custom-openai-tts',
    label: 'provider.tts.custom-openai-tts.label',
    baseUrl: '',
    defaultModel: 'gpt-4o-mini-tts',
    defaultVoice: 'alloy',
    notes: 'provider.tts.custom-openai-tts.notes',
    protocol: 'openai-compatible',
    kind: 'remote',
    hidden: false,
    supportsStreaming: false,
    supportsCustomVoiceId: true,
    modelOptions: [
      { value: 'gpt-4o-mini-tts', label: 'provider.tts.custom-openai-tts.model.gpt-4o-mini-tts.label' },
      { value: 'tts-1', label: 'provider.tts.custom-openai-tts.model.tts-1.label' },
      { value: 'tts-1-hd', label: 'provider.tts.custom-openai-tts.model.tts-1-hd.label' },
    ],
    fallbackVoiceOptions: OPENAI_TTS_VOICE_OPTIONS,
    styleOptions: OPENAI_TTS_STYLE_OPTIONS,
    adjustmentSupport: { rate: false, pitch: false, volume: false, note: 'provider.tts.custom-openai-tts.adjustment.note' },
  },
]

// ── Catalog query functions ──

const speechInputIndex = new Map(SPEECH_INPUT_PROVIDERS.map((p) => [p.id, p]))
const speechOutputIndex = new Map(SPEECH_OUTPUT_PROVIDERS.map((p) => [p.id, p]))

export function getSpeechInputProvider(id: string): SpeechInputProviderEntry {
  return speechInputIndex.get(id) ?? SPEECH_INPUT_PROVIDERS[0]
}

export function getSpeechOutputProvider(id: string): SpeechOutputProviderEntry {
  return speechOutputIndex.get(id) ?? SPEECH_OUTPUT_PROVIDERS[0]
}

export function getSpeechInputProtocol(id: string): SpeechInputProtocol {
  return getSpeechInputProvider(id).protocol
}

export function getSpeechOutputProtocol(id: string): SpeechOutputProtocol {
  return getSpeechOutputProvider(id).protocol
}

export function isSpeechProviderLocal(id: string): boolean {
  const input = speechInputIndex.get(id)
  if (input) return input.kind === 'local'

  const output = speechOutputIndex.get(id)
  if (output) return output.kind === 'local'

  return false
}

export function isElevenLabsProvider(id: string): boolean {
  const input = speechInputIndex.get(id)
  if (input) return input.protocol === 'elevenlabs'

  const output = speechOutputIndex.get(id)
  if (output) return output.protocol === 'elevenlabs'

  return false
}
