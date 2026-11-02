/**
 * Records the owner's voice sample for the owner voice lock.
 *
 * Opens the microphone only on the user's click in settings, captures up to
 * OWNER_VOICE_RECORD_SECONDS of 16 kHz mono audio, and releases the mic as
 * soon as the recording stops. The samples go straight to the main process,
 * which keeps them on this machine.
 */

import { requestVoiceInputStream } from './runtimeSupport.ts'

export const OWNER_VOICE_SAMPLE_RATE = 16_000
/** VoxLock needs 3 s of voice; 8 s leaves room for pauses between words. */
export const OWNER_VOICE_RECORD_SECONDS = 8
const BUFFER_SIZE = 4096

export type OwnerVoiceRecording = {
  /** Resolves with everything captured so far once recording ends. */
  done: Promise<Float32Array>
  /** Stop early; `done` resolves with what was captured. */
  stop: () => void
}

/** Join captured chunks into one buffer, capped at `maxSamples`. */
export function joinSamples(chunks: readonly Float32Array[], maxSamples: number): Float32Array {
  const total = Math.min(
    chunks.reduce((sum, chunk) => sum + chunk.length, 0),
    maxSamples,
  )
  const joined = new Float32Array(total)
  let offset = 0
  for (const chunk of chunks) {
    if (offset >= total) break
    const take = Math.min(chunk.length, total - offset)
    joined.set(chunk.subarray(0, take), offset)
    offset += take
  }
  return joined
}

export async function recordOwnerVoiceSample(
  onProgress?: (seconds: number) => void,
): Promise<OwnerVoiceRecording> {
  const { stream } = await requestVoiceInputStream({
    preferredSampleRate: OWNER_VOICE_SAMPLE_RATE,
    purpose: 'enroll',
  })
  const audioContext = new AudioContext({ sampleRate: OWNER_VOICE_SAMPLE_RATE })
  const source = audioContext.createMediaStreamSource(stream)
  const processor = audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1)
  const mute = audioContext.createGain()
  mute.gain.value = 0
  source.connect(processor)
  processor.connect(mute)
  mute.connect(audioContext.destination)

  const maxSamples = OWNER_VOICE_SAMPLE_RATE * OWNER_VOICE_RECORD_SECONDS
  const chunks: Float32Array[] = []
  let captured = 0
  let finished = false
  let resolveDone!: (samples: Float32Array) => void
  const done = new Promise<Float32Array>((resolve) => { resolveDone = resolve })

  const finish = () => {
    if (finished) return
    finished = true
    processor.onaudioprocess = null
    try { source.disconnect() } catch { /* silent-catch-ok: the graph is closing anyway */ }
    try { processor.disconnect() } catch { /* silent-catch-ok: the graph is closing anyway */ }
    stream.getTracks().forEach((track) => track.stop())
    void audioContext.close().catch(() => undefined) // silent-catch-ok: a closed context needs no further cleanup
    resolveDone(joinSamples(chunks, maxSamples))
  }

  processor.onaudioprocess = (event) => {
    if (finished) return
    const chunk = new Float32Array(event.inputBuffer.getChannelData(0))
    chunks.push(chunk)
    captured += chunk.length
    onProgress?.(Math.min(captured, maxSamples) / OWNER_VOICE_SAMPLE_RATE)
    if (captured >= maxSamples) finish()
  }

  await audioContext.resume().catch(() => undefined) // silent-catch-ok: a suspended context surfaces as an empty recording

  return { done, stop: finish }
}
