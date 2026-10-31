/**
 * Renderer-side backchannel runtime.
 *
 * `backchannelPolicy.ts` decides *whether* a pause earns a tiny acknowledgement.
 * This module owns the pre-synthesized clips, the low-gain playback path, and
 * the echo cooldown so the VAD never mistakes her own "mm-hm" for the user.
 *
 * Clips are synthesized once per provider/voice/language/mood-tempo combination
 * with the same provider, voice, character id, rate and pitch as her normal
 * replies, then cached across turns in memory. They are never appended to chat
 * history, memory, or an LLM request.
 */

import { createId } from '../../lib/storage.ts'
import type { AppSettings, SegmentVoiceStyle, TtsStreamEvent } from '../../types/index.ts'
import type { InterruptMicPolicyInput } from '../../features/voice/autoRestartPolicy.ts'
import {
  decideBackchannel,
  getBackchannelTokenSet,
  type BackchannelDecision,
} from '../../features/voice/backchannelPolicy.ts'
import type { TurnEndAction } from '../../features/hearing/turnEnd.ts'
import type { StreamAudioPlayer } from '../../features/voice/streamAudioPlayer.ts'

export type BackchannelClip = {
  samples: Float32Array
  sampleRate: number
}

export type BackchannelTurnSignal = {
  partialTranscript: string
  silenceMs: number
  spokenMs: number
  turnEndAction: TurnEndAction
  /** Smart Turn p(complete), or null when the model is unavailable. */
  modelProbability?: number | null
  /** True while a probe is in flight or the model is warming up. */
  modelPending?: boolean
}

export type BackchannelSession = {
  /** Begin the session, cache clips, and reset the rate-limit clock. */
  start: () => void
  /** End the microphone session; cached clips survive for the next turn. */
  stop: () => void
  /** Called on silence frames; plays only when the policy says yes. */
  maybeFire: (signal: BackchannelTurnSignal) => void
}

export type BackchannelSessionDeps = {
  getSettings: () => AppSettings
  getPlayer: () => Pick<StreamAudioPlayer, 'appendBackchannelPcmChunk'>
  voiceEchoCooldownUntilRef: { current: number }
  micPolicy: InterruptMicPolicyInput
  /**
   * Current mood's speech tempo, so an acknowledgement follows the same pace
   * as a normal reply. Defaults to natural speed when not wired.
   */
  getMoodSpeechTempo?: () => number
  /** Test seam; production uses the streaming TTS IPC below. */
  synthesizeClip?: (
    settings: AppSettings,
    text: string,
    speechTempo: number,
    synthesisTimeoutMs: number,
  ) => Promise<BackchannelClip | null>
  /** Test seam for the abort-on-timeout path. */
  synthesisTimeoutMs?: number
}

const CLIP_SYNTHESIS_TIMEOUT_MS = 5_000
const ECHO_TAIL_MS = 250

// Backchannels are UI glue, not reply content: keeping the three clips across
// turns stops a local model from re-synthesizing them while it is busy with the
// actual reply. The cache is replaced whenever the rendered audio would change.
let clipCacheKey: string | null = null
let clipCache = new Map<string, BackchannelClip>()
const pendingClipCache = new Map<string, Promise<BackchannelClip | null>>()

/** Drop cached clips. Used when the cached key changes and by tests. */
export function clearBackchannelClipCache() {
  clipCacheKey = null
  clipCache = new Map()
  pendingClipCache.clear()
}

function selectClipCache(key: string) {
  if (clipCacheKey === key) return clipCache
  clipCacheKey = key
  clipCache = new Map()
  pendingClipCache.clear()
  return clipCache
}

/**
 * Everything that changes the synthesized audio. `speechRate` is included
 * because the main stream multiplies it into `speechTempo`.
 */
function backchannelClipCacheKey(settings: AppSettings, speechTempo: number) {
  return JSON.stringify([
    settings.speechOutputProviderId,
    settings.speechOutputVoice,
    settings.speechSynthesisLang,
    speechTempo,
    settings.speechRate,
  ])
}

function backchannelEnabled(settings: AppSettings) {
  return settings.voiceBackchannelEnabled === true && settings.speechOutputEnabled === true
}

async function synthesizeBackchannelClip(
  settings: AppSettings,
  text: string,
  speechTempo: number,
  synthesisTimeoutMs = CLIP_SYNTHESIS_TIMEOUT_MS,
): Promise<BackchannelClip | null> {
  const api = window.desktopPet
  if (
    !api?.ttsStreamStart
    || !api.ttsStreamPushText
    || !api.ttsStreamFinish
    || !api.subscribeTtsStream
  ) {
    return null
  }

  const requestId = createId('backchannel')
  const samples: number[] = []
  let sampleRate = 24_000
  let chunkCount = 0
  let aborted = false
  let resolveDone: (() => void) | null = null
  let rejectDone: ((reason: Error) => void) | null = null
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve
    rejectDone = reject
  })

  const abortRequest = () => {
    if (aborted) return
    aborted = true
    void api.ttsStreamAbort?.({ requestId })?.catch(() => undefined)
  }

  const unsubscribe = api.subscribeTtsStream((event: TtsStreamEvent) => {
    if (event.requestId !== requestId) return
    if (event.type === 'chunk') {
      sampleRate = event.sampleRate || sampleRate
      for (const sample of event.samples) samples.push(sample)
      chunkCount += 1
      return
    }
    if (event.type === 'end') {
      resolveDone?.()
      return
    }
    if (event.type === 'error') {
      rejectDone?.(new Error(event.message || 'Backchannel synthesis failed.'))
    }
  })

  const timeout = setTimeout(() => {
    // Aborting is what actually releases the local model for the reply; just
    // rejecting would leave the request running in the main process.
    abortRequest()
    rejectDone?.(new Error('Backchannel synthesis timed out.'))
  }, synthesisTimeoutMs)

  try {
    await api.ttsStreamStart({
      requestId,
      providerId: settings.speechOutputProviderId,
      baseUrl: settings.speechOutputApiBaseUrl,
      apiKey: settings.speechOutputApiKey,
      model: settings.speechOutputModel,
      voice: settings.speechOutputVoice,
      characterId: settings.activeCharacterProfileId,
      instructions: settings.speechOutputInstructions,
      language: settings.speechSynthesisLang,
      rate: settings.speechRate,
      pitch: settings.speechPitch,
      volume: settings.speechVolume,
    })
    const style: SegmentVoiceStyle | undefined = settings.speechOutputProviderId === 'qwen3-tts-local'
      && Number.isFinite(speechTempo)
      && speechTempo !== 1
      ? { instruction: '', rate: 1, pitch: 1, speechTempo }
      : undefined
    await api.ttsStreamPushText({ requestId, text, ...(style ? { style } : {}) })
    await api.ttsStreamFinish({ requestId })
    await done
  } catch {
    abortRequest()
    return null
  } finally {
    clearTimeout(timeout)
    unsubscribe()
  }

  if (chunkCount === 0 || samples.length === 0 || sampleRate <= 0) return null
  return {
    samples: Float32Array.from(samples),
    sampleRate,
  }
}

/**
 * Build one backchannel session for a voice turn. The caller creates it when
 * the user opens the mic, calls `start()` once, and feeds silence frames from
 * the provider's activity monitor into `maybeFire()`.
 */
export function createBackchannelSession(deps: BackchannelSessionDeps): BackchannelSession {
  const recentBackchannels: number[] = []
  let started = false
  let lastBackchannelAt: number | null = null

  const synthesize = deps.synthesizeClip ?? synthesizeBackchannelClip
  const synthesisTimeoutMs = deps.synthesisTimeoutMs ?? CLIP_SYNTHESIS_TIMEOUT_MS
  const getMoodSpeechTempo = deps.getMoodSpeechTempo ?? (() => 1)

  function currentTempo(settings: AppSettings): number {
    // Only the local Qwen3 path carries a client-side tempo; every other
    // provider speaks at its own natural rate.
    if (settings.speechOutputProviderId !== 'qwen3-tts-local') return 1
    const tempo = getMoodSpeechTempo()
    return Number.isFinite(tempo) && tempo > 0 ? tempo : 1
  }

  async function ensureClip(
    settings: AppSettings,
    token: string,
    speechTempo: number,
    cacheKey: string,
  ) {
    const clips = selectClipCache(cacheKey)
    const cached = clips.get(token)
    if (cached) return cached

    const pendingKey = `${cacheKey}\u0000${token}`
    const pending = pendingClipCache.get(pendingKey)
    if (pending) return pending

    const next = synthesize(settings, token, speechTempo, synthesisTimeoutMs)
      .then((clip) => {
        // A mood/provider change while this request was in flight clears the
        // cache; never write a stale clip into the replacement cache.
        if (clip && clipCacheKey === cacheKey) clips.set(token, clip)
        return clip
      })
      .finally(() => {
        pendingClipCache.delete(pendingKey)
      })
    pendingClipCache.set(pendingKey, next)
    return next
  }

  function start() {
    if (started) return
    started = true
    recentBackchannels.length = 0
    lastBackchannelAt = null

    const settings = deps.getSettings()
    if (!backchannelEnabled(settings)) return

    const speechTempo = currentTempo(settings)
    const cacheKey = backchannelClipCacheKey(settings, speechTempo)
    selectClipCache(cacheKey)

    const tokens = new Set(Object.values(getBackchannelTokenSet(settings.speechRecognitionLang)))
    void (async () => {
      for (const token of tokens) {
        // Sequential so a local provider is not asked for three simultaneous
        // synthesis sessions during its first, slow warm-up.
        await ensureClip(settings, token, speechTempo, cacheKey)
      }
    })()
  }

  function stop() {
    started = false
    // Clips survive the turn so the next one replays them instead of asking a
    // busy local model for the same three acknowledgements again.
    recentBackchannels.length = 0
    lastBackchannelAt = null
  }

  function maybeFire(signal: BackchannelTurnSignal) {
    if (!started) return

    const settings = deps.getSettings()
    const speechTempo = currentTempo(settings)
    const cacheKey = backchannelClipCacheKey(settings, speechTempo)
    const clips = selectClipCache(cacheKey)
    const now = Date.now()
    while (
      recentBackchannels.length > 0
      && now - (recentBackchannels[0] ?? now) >= 10_000
    ) {
      recentBackchannels.shift()
    }

    const decision: BackchannelDecision = decideBackchannel({
      enabled: backchannelEnabled(settings),
      micPolicy: deps.micPolicy,
      spokenMs: signal.spokenMs,
      pauseMs: signal.silenceMs,
      turnEndAction: signal.turnEndAction,
      modelProbability: signal.modelProbability ?? null,
      modelPending: signal.modelPending === true,
      msSinceLastBackchannel: lastBackchannelAt === null ? null : now - lastBackchannelAt,
      backchannelsInLast10s: recentBackchannels.length,
      partialTranscript: signal.partialTranscript,
      locale: settings.speechRecognitionLang,
    })
    if (!decision.fire) return

    const clip = clips.get(decision.token)
    if (!clip) {
      // The speaker may still be warming up. Do not block the user's turn on
      // a missing clip; the next pause can try again.
      void ensureClip(settings, decision.token, speechTempo, cacheKey)
      return
    }

    recentBackchannels.push(now)
    lastBackchannelAt = now
    deps.voiceEchoCooldownUntilRef.current = Math.max(
      deps.voiceEchoCooldownUntilRef.current,
      now + 900,
    )
    try {
      const player = deps.getPlayer()
      const durationMs = player.appendBackchannelPcmChunk(clip.samples, clip.sampleRate)
      if (durationMs > 0) {
        deps.voiceEchoCooldownUntilRef.current = Math.max(
          deps.voiceEchoCooldownUntilRef.current,
          Date.now() + durationMs + ECHO_TAIL_MS,
        )
      }
    } catch {
      // Best-effort acknowledgement; a failed clip must never disturb the turn.
    }
  }

  return { start, stop, maybeFire }
}
