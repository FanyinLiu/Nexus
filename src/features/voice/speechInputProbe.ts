/**
 * What the speech-input Test button is allowed to do, and how a short
 * local recognition buffer is judged. Cloud providers that have no
 * connection probe stay unavailable instead of failing after a click.
 */

import {
  isParaformerSpeechInputProvider,
  isSenseVoiceSpeechInputProvider,
  isTencentAsrSpeechInputProvider,
} from '../../lib/audioProviders.ts'

export const SPEECH_PROBE_SAMPLE_RATE = 16_000
export const SPEECH_PROBE_DURATION_MS = 320

export type SpeechInputTestPlan =
  | { mode: 'remote' }
  | { mode: 'sensevoice-recognition' }
  | { mode: 'paraformer-recognition' }
  | { mode: 'unavailable'; reasonKey: 'settings.speech_input.test_unavailable_tencent' }

export function planSpeechInputConnectionTest(providerId: string): SpeechInputTestPlan {
  if (isSenseVoiceSpeechInputProvider(providerId)) return { mode: 'sensevoice-recognition' }
  if (isParaformerSpeechInputProvider(providerId)) return { mode: 'paraformer-recognition' }
  if (isTencentAsrSpeechInputProvider(providerId)) {
    return { mode: 'unavailable', reasonKey: 'settings.speech_input.test_unavailable_tencent' }
  }
  return { mode: 'remote' }
}

/** A short non-silent buffer so the recognizer actually runs. */
export function buildSpeechRecognitionProbe(
  sampleRate = SPEECH_PROBE_SAMPLE_RATE,
  durationMs = SPEECH_PROBE_DURATION_MS,
): number[] {
  const length = Math.max(1, Math.round((sampleRate * durationMs) / 1000))
  const samples = new Array<number>(length)
  for (let index = 0; index < length; index += 1) {
    samples[index] = Math.sin((2 * Math.PI * 220 * index) / sampleRate) * 0.02
  }
  return samples
}

export function classifyRecognitionProbe(result: unknown): 'transcript' | 'silent' | 'invalid' {
  if (!result || typeof result !== 'object' || !Object.hasOwn(result, 'text')) return 'invalid'
  const text = (result as { text: unknown }).text
  if (typeof text !== 'string') return 'invalid'
  return text.trim() ? 'transcript' : 'silent'
}
