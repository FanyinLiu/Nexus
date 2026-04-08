import type { AppSettings, AudioSynthesisRequest } from '../../types'

export const AUDIO_SMOKE_PLAYBACK_TIMEOUT_MS = 15_000

export const MICROPHONE_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  channelCount: { ideal: 1 },
  sampleRate: { ideal: 16000 },
  sampleSize: { ideal: 16 },
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
}

export type VoiceInputPurpose = 'stt' | 'wakeword' | 'interrupt' | 'vad'

export type VoiceInputStreamHandle = {
  stream: MediaStream
  profileId: string
  trackSettings: MediaTrackSettings | null
}

type VoiceInputConstraintProfile = {
  id: string
  constraints: MediaTrackConstraints | true
}

function createMicrophoneConstraints(options: {
  preferredSampleRate?: number
  echoCancellation: boolean
  noiseSuppression: boolean
  autoGainControl: boolean
}): MediaTrackConstraints {
  const constraints: MediaTrackConstraints = {
    channelCount: { ideal: 1 },
    sampleSize: { ideal: 16 },
    echoCancellation: options.echoCancellation,
    noiseSuppression: options.noiseSuppression,
    autoGainControl: options.autoGainControl,
  }

  if (Number.isFinite(options.preferredSampleRate) && Number(options.preferredSampleRate) > 0) {
    constraints.sampleRate = { ideal: Math.round(Number(options.preferredSampleRate)) }
  }

  return constraints
}

function buildVoiceInputConstraintProfiles(
  preferredSampleRate?: number,
  purpose: VoiceInputPurpose = 'stt',
): VoiceInputConstraintProfile[] {
  const raw = {
    id: 'raw',
    constraints: createMicrophoneConstraints({
      preferredSampleRate,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    }),
  }
  const boosted = {
    id: 'boosted',
    constraints: createMicrophoneConstraints({
      preferredSampleRate,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: true,
    }),
  }
  const processed = {
    id: 'processed',
    constraints: createMicrophoneConstraints({
      preferredSampleRate,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    }),
  }

  switch (purpose) {
    case 'interrupt':
      return [
        processed,
        boosted,
        { id: 'default', constraints: true },
      ]
    case 'wakeword':
      return [
        processed,
        boosted,
        raw,
        { id: 'default', constraints: true },
      ]
    case 'vad':
      return [
        raw,
        processed,
        { id: 'default', constraints: true },
      ]
    case 'stt':
    default:
      return [
        raw,
        boosted,
        processed,
        { id: 'default', constraints: true },
      ]
  }
}

export async function requestVoiceInputStream(
  options: {
    preferredSampleRate?: number
    purpose?: VoiceInputPurpose
  } = {},
): Promise<VoiceInputStreamHandle> {
  const profiles = buildVoiceInputConstraintProfiles(
    options.preferredSampleRate,
    options.purpose ?? 'stt',
  )
  let lastError: unknown = null

  for (const profile of profiles) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: profile.constraints,
      })
      const track = stream.getAudioTracks()[0] ?? null

      if (!track) {
        stream.getTracks().forEach((item) => item.stop())
        lastError = new Error('已经拿到录音流，但没有发现可用的音频轨道。')
        continue
      }

      track.enabled = true

      return {
        stream,
        profileId: profile.id,
        trackSettings: typeof track.getSettings === 'function' ? track.getSettings() : null,
      }
    } catch (error) {
      lastError = error
    }
  }

  throw (
    lastError instanceof Error
      ? lastError
      : new Error('无法打开麦克风，请检查系统权限、设备占用和输入设备状态。')
  )
}

const SUPPORTED_RECORDING_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/ogg',
  'audio/mp4',
]

const TTS_CACHE_MAX_SIZE = 150
const ttsResultCache = new Map<string, { audioBase64: string; mimeType: string }>()

function buildTtsCacheKey(payload: AudioSynthesisRequest): string {
  return [
    payload.providerId,
    payload.model,
    payload.voice,
    payload.language ?? '',
    String(payload.rate ?? ''),
    String(payload.pitch ?? ''),
    String(payload.volume ?? ''),
    payload.instructions ?? '',
    payload.text,
  ].join('\x00')
}

export function getCachedTtsResult(payload: AudioSynthesisRequest) {
  const key = buildTtsCacheKey(payload)
  const entry = ttsResultCache.get(key)
  if (entry) {
    ttsResultCache.delete(key)
    ttsResultCache.set(key, entry)
  }

  return entry ?? null
}

export function setCachedTtsResult(
  payload: AudioSynthesisRequest,
  value: { audioBase64: string; mimeType: string },
) {
  const key = buildTtsCacheKey(payload)
  if (ttsResultCache.size >= TTS_CACHE_MAX_SIZE) {
    const firstKey = ttsResultCache.keys().next().value
    if (firstKey !== undefined) {
      ttsResultCache.delete(firstKey)
    }
  }

  ttsResultCache.set(key, value)
}

export function pickRecordingMimeType() {
  return SUPPORTED_RECORDING_MIME_TYPES.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? ''
}

export function getRecordingFileName(mimeType: string) {
  if (mimeType.includes('mp4')) return 'speech.m4a'
  if (mimeType.includes('ogg')) return 'speech.ogg'
  return 'speech.webm'
}

export function calculateAudioRms(samples: ArrayLike<number>) {
  let total = 0

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index] ?? 0
    total += sample * sample
  }

  return Math.sqrt(total / samples.length)
}

export function mapMicrophoneDiagnosticError(error: unknown, localMode = false) {
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError':
      case 'PermissionDeniedError':
      case 'SecurityError':
        return '没有拿到麦克风权限，请在系统和浏览器权限里允许 Nexus 使用麦克风。'
      case 'NotFoundError':
      case 'DevicesNotFoundError':
        return '没有检测到可用麦克风，请先连接或启用录音设备。'
      case 'NotReadableError':
      case 'TrackStartError':
        return '麦克风正在被其他应用独占，或者当前设备暂时无法读取。'
      case 'AbortError':
        return '麦克风测试被中断，请再试一次。'
      default:
        break
    }
  }

  if (error instanceof Error) {
    const message = error.message.trim()
    if (message) {
      return localMode
        ? `本地语音识别链路自检失败：${message}`
        : `语音输入链路自检失败：${message}`
    }
  }

  return localMode
    ? '本地语音识别链路自检失败，请检查麦克风权限和本地 Whisper 环境。'
    : '语音输入链路自检失败，请检查麦克风权限。'
}

export function buildSpeechOutputSmokeText(draftSettings: AppSettings) {
  const companionName = draftSettings.companionName.trim() || '桌宠'
  return `你好，我是${companionName}。这是一条语音链路自检播报。`
}
