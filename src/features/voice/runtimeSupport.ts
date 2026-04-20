import type { AppSettings, AudioSynthesisRequest, TranslationKey, TranslationParams } from '../../types'
import { t } from '../../i18n/runtime.ts'

type Translator = (key: TranslationKey, params?: TranslationParams) => string

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
        lastError = new Error(t('voice.mic.no_audio_track'))
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
      : new Error(t('voice.mic.open_failed_generic'))
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

export function mapMicrophoneDiagnosticError(error: unknown, localMode = false, ti: Translator = t) {
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError':
      case 'PermissionDeniedError':
      case 'SecurityError':
        return ti('voice.mic.permission_denied')
      case 'NotFoundError':
      case 'DevicesNotFoundError':
        return ti('voice.mic.not_found')
      case 'NotReadableError':
      case 'TrackStartError':
        return ti('voice.mic.busy')
      case 'AbortError':
        return ti('voice.mic.aborted')
      default:
        break
    }
  }

  if (error instanceof Error) {
    const message = error.message.trim()
    if (message) {
      return localMode
        ? ti('voice.mic.local_readiness_failed_with_detail', { detail: message })
        : ti('voice.mic.readiness_failed_with_detail', { detail: message })
    }
  }

  return localMode
    ? ti('voice.mic.local_readiness_failed_generic')
    : ti('voice.mic.readiness_failed_generic')
}

export function buildSpeechOutputSmokeText(draftSettings: AppSettings, ti: Translator = t) {
  const companionName = draftSettings.companionName.trim() || ti('voice.smoke.companion_fallback')
  return ti('voice.smoke.output_text', { companionName })
}
