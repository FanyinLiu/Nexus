import type { AppSettings, AudioSynthesisRequest, TranslationKey, TranslationParams } from '../../types'
import { t } from '../../i18n/runtime.ts'

type Translator = (key: TranslationKey, params?: TranslationParams) => string

export const AUDIO_SMOKE_PLAYBACK_TIMEOUT_MS = 15_000

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

/**
 * Normalize a platform token to the `process.platform` vocabulary used by
 * microphone permission copy (`darwin` / `win32` / `linux` / `unknown`).
 * Accepts both navigator platform strings (`MacIntel`, `Win32`) and already
 * normalized tokens. `darwin` MUST be checked before `win` because the macOS
 * token itself contains "win".
 */
function normalizeVoicePermissionPlatform(
  platform: string | null | undefined,
): 'darwin' | 'win32' | 'linux' | 'unknown' {
  const normalized = (platform ?? '').trim().toLowerCase()
  if (normalized === 'darwin' || normalized.includes('mac')) return 'darwin'
  if (normalized === 'win32' || normalized.includes('win')) return 'win32'
  if (normalized.includes('linux')) return 'linux'
  return 'unknown'
}

/**
 * Renderer-side platform token used to pick microphone permission copy.
 * Mirrors the `process.platform` vocabulary exposed by PlatformProfile
 * (`darwin` / `win32` / `linux`) so callers can inject a known value.
 */
export function detectVoicePermissionPlatform(): string {
  if (typeof navigator === 'undefined') return 'unknown'
  const userAgentData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
  const raw = userAgentData?.platform || navigator.platform || ''
  return normalizeVoicePermissionPlatform(raw)
}

/**
 * Append the platform suffix to any microphone-permission message key.
 * Every surface that reports a denied microphone shares the same three
 * sentences per locale, so the key differs only by suffix: macOS and Windows
 * point users at their own privacy panes; everything else keeps the generic
 * wording. Passing a platform keeps this testable without touching the
 * navigator.
 */
export function pickMicrophonePermissionKey(
  baseKey: TranslationKey,
  platform: string | null | undefined,
): TranslationKey {
  const normalized = normalizeVoicePermissionPlatform(platform)
  if (normalized === 'darwin') return `${baseKey}_mac` as TranslationKey
  if (normalized === 'win32') return `${baseKey}_windows` as TranslationKey
  return baseKey
}

/**
 * Pure platform-to-key decision for microphone permission copy. macOS and
 * Windows point users at their own privacy panes; everything else gets the
 * generic system-settings wording.
 */
export function pickMicrophonePermissionDeniedKey(
  platform: string | null | undefined,
): TranslationKey {
  return pickMicrophonePermissionKey('voice.mic.permission_denied', platform)
}

export function mapMicrophoneDiagnosticError(
  error: unknown,
  localMode = false,
  ti: Translator = t,
  platform: string | null | undefined = detectVoicePermissionPlatform(),
) {
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError':
      case 'PermissionDeniedError':
      case 'SecurityError':
        return ti(pickMicrophonePermissionDeniedKey(platform))
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
