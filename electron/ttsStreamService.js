import { randomUUID } from 'node:crypto'
import { decodePcm16LeBufferToFloat32, enhanceSpeechSamples } from './audioPostprocess.js'
import { getRedactedErrorMessage } from './services/errorRedaction.js'
import { computeTtsStageDurations, createTtsTimingMarks } from './services/ttsStreamTiming.js'

const STREAM_CHUNK_SIZE = 4096
const INITIAL_STREAM_CHUNK_SIZE = 1024
const DEFAULT_PCM_SAMPLE_RATE = 24000

function formatStreamTextLogMeta(text) {
  return `chars=${String(text ?? '').length}`
}

function chunkSamples(samples, chunkSize = STREAM_CHUNK_SIZE) {
  const chunks = []
  for (let offset = 0; offset < samples.length; offset += chunkSize) {
    chunks.push(samples.slice(offset, offset + chunkSize))
  }
  return chunks
}

function emitSampleChunk(session, samples, sampleRate, text, isFinal = false) {
  if (!session?.sender || session.sender.isDestroyed()) {
    // Sender is gone mid-stream (window reload / crash). Mark the session
    // closed so the main-process synthesis chain short-circuits on its next
    // await instead of consuming a PCM stream nobody is listening to. The
    // caller (emitStreamedPcmResult) reads session.closed to tear down.
    if (session) {
      session.closed = true
    }
    return
  }

  session.hasEmittedAudio = true
  session.sender.send('tts:stream-event', {
    type: 'chunk',
    requestId: session.requestId,
    chunkId: randomUUID(),
    format: 'f32le',
    sampleRate,
    channels: 1,
    text,
    isFinal,
    samples,
  })

  // The first chunk handed to the renderer is the earliest point main can
  // call "audible" (the renderer schedules it into the audio graph right
  // away). Report the stage durations once, in dev console only.
  if (session.timing && !session.latencyReported) {
    session.timing.mark('firstAudibleSample')
    session.latencyReported = true
    const latencyEvent = {
      type: 'latency',
      requestId: session.requestId,
      stages: computeTtsStageDurations(session.timing.snapshot()),
      firstSegmentChars: session.firstSegmentChars ?? null,
    }
    if (!session.sender.isDestroyed()) {
      session.sender.send('tts:stream-event', latencyEvent)
    }
  }
}

function takeBufferedSamples(bufferedChunks, sampleCount) {
  const output = new Float32Array(sampleCount)
  let offset = 0

  while (offset < sampleCount && bufferedChunks.length) {
    const chunk = bufferedChunks[0]
    const remaining = sampleCount - offset

    if (chunk.length <= remaining) {
      output.set(chunk, offset)
      offset += chunk.length
      bufferedChunks.shift()
      continue
    }

    output.set(chunk.subarray(0, remaining), offset)
    bufferedChunks[0] = chunk.subarray(remaining)
    offset += remaining
  }

  return output
}

function decodeWav(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  let offset = 12
  let sampleRate = DEFAULT_PCM_SAMPLE_RATE
  let bitsPerSample = 16
  let audioFormat = 1
  let dataOffset = 0
  let dataSize = 0

  while (offset < buffer.byteLength - 8) {
    const chunkId = String.fromCharCode(
      buffer[offset],
      buffer[offset + 1],
      buffer[offset + 2],
      buffer[offset + 3],
    )
    const chunkSize = view.getUint32(offset + 4, true)
    if (chunkId === 'fmt ') {
      audioFormat = view.getUint16(offset + 8, true)
      sampleRate = view.getUint32(offset + 12, true)
      bitsPerSample = view.getUint16(offset + 22, true)
    } else if (chunkId === 'data') {
      dataOffset = offset + 8
      dataSize = chunkSize
      break
    }
    offset += 8 + chunkSize
  }

  if (!dataOffset || !dataSize) {
    throw new Error('WAV 音频数据没能解析。')
  }

  const dataBuffer = buffer.slice(dataOffset, dataOffset + dataSize)

  if (audioFormat === 3 && bitsPerSample === 32) {
    const samples = new Float32Array(dataBuffer.byteLength / 4)
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = dataBuffer.readFloatLE(index * 4)
    }
    return {
      samples,
      sampleRate,
    }
  }

  return {
    samples: decodePcm16LeBufferToFloat32(dataBuffer),
    sampleRate,
  }
}

/**
 * Normalize the renderer's per-sentence style. Returns null for "nothing to
 * change" so the provider receives its original payload untouched.
 */
function normalizeSegmentStyle(raw) {
  if (!raw || typeof raw !== 'object') return null

  const instruction = typeof raw.instruction === 'string' ? raw.instruction.trim() : ''
  const rate = Number.isFinite(raw.rate) ? Math.min(Math.max(raw.rate, 0.5), 2) : 1
  const pitch = Number.isFinite(raw.pitch) ? Math.min(Math.max(raw.pitch, 0.5), 2) : 1
  const emotion = typeof raw.emotion === 'string' ? raw.emotion.trim() : ''

  if (!instruction && rate === 1 && pitch === 1 && !emotion) return null
  return { instruction, rate, pitch, emotion }
}

/**
 * Fold one sentence's emotion into a COPY of the pinned session payload.
 * The speaker/model stay exactly as started (so timbre cannot drift); only
 * tone/pace fields change. The user's base instructions lead, the sentence
 * clause follows.
 */
function applySegmentStyle(payload, style) {
  if (!style) return payload

  const baseInstructions = String(payload.instructions ?? '').trim()
  const instructions = [baseInstructions, style.instruction].filter(Boolean).join(' ')
  const baseRate = Number.isFinite(payload.rate) ? payload.rate : 1
  const basePitch = Number.isFinite(payload.pitch) ? payload.pitch : 1

  return {
    ...payload,
    ...(instructions ? { instructions } : {}),
    rate: Math.min(Math.max(baseRate * style.rate, 0.5), 2),
    pitch: Math.min(Math.max(basePitch * style.pitch, 0.5), 2),
    ...(style.emotion ? { emotion: style.emotion } : {}),
  }
}

function buildLeadInOptions(session, options = {}) {
  // Only the very first segment gets prepended silence + fade-in to avoid a
  // click at playback start. Subsequent segments pass through raw so the
  // sentence flows without audible attenuation at every punctuation boundary.
  //
  // Fade-out is disabled unconditionally — we don't know which segment is the
  // terminal one until finish() runs, and applying a 6 ms fade to every mid-
  // utterance segment end stacks into audible word swallow.
  const isFirstSegment = !session.hasEmittedAudio
  return {
    prependSilenceMs: isFirstSegment ? 18 : 0,
    fadeInMs: isFirstSegment ? 12 : 0,
    fadeOutMs: Number.isFinite(options.fadeOutMs) ? options.fadeOutMs : 0,
    normalizePeak: options.normalizePeak !== false,
  }
}

export function createTtsStreamService({ synthesizeRemote, warmupRemote }) {
  const sessions = new Map()

  function emit(sender, event) {
    if (!sender.isDestroyed()) {
      sender.send('tts:stream-event', event)
    }
  }

  // Session lookup that returns null instead of throwing.
  // pushText/finish/abort must use this because an earlier synthesize failure
  // (or an out-of-order IPC arriving after `end`/`error`) can clear the
  // session before the renderer's next call lands — throwing surfaces to the
  // renderer as an unhandled IPC rejection for a path we deliberately want
  // to be idempotent.
  function getSessionOrNull(requestId) {
    return sessions.get(String(requestId ?? '')) ?? null
  }

  function clearSession(requestId) {
    sessions.delete(requestId)
  }

  function detachSenderListener(session) {
    if (session?.onSenderDestroyed && session.sender && !session.sender.isDestroyed()) {
      session.sender.removeListener('destroyed', session.onSenderDestroyed)
    }
    if (session) {
      session.onSenderDestroyed = null
    }
  }

  function emitSamples(session, samples, sampleRate, text) {
    const chunks = chunkSamples(samples)
    chunks.forEach((chunk, index) => {
      emitSampleChunk(session, chunk, sampleRate, text, index === chunks.length - 1)
    })
  }

  async function emitStreamedPcmResult(session, text, result) {
    const sampleRate = result.pcmSampleRate || DEFAULT_PCM_SAMPLE_RATE
    let residual = Buffer.alloc(0)
    const bufferedChunks = []
    let bufferedSampleCount = 0
    let emittedChunkInThisPass = false
    let preparedLeadInForThisPass = false

    await new Promise((resolve) => {
      const stream = result.pcmStream
      // Pass-local flag so we can distinguish "provider returned an empty
      // stream" from "provider streamed some audio". Observed after long
      // plays where the upstream socket is half-closed by the time the next
      // segment lands — the stream fires `end` immediately without `data`,
      // and the renderer ends up silently 'finishing without playback'.
      let streamYieldedData = false

      const flushBufferedSamples = (force = false) => {
        while (bufferedSampleCount > 0) {
          const minimumSamples = emittedChunkInThisPass ? STREAM_CHUNK_SIZE : INITIAL_STREAM_CHUNK_SIZE
          if (!force && bufferedSampleCount < minimumSamples) {
            return
          }

          const emitCount = force
            ? bufferedSampleCount
            : Math.min(bufferedSampleCount, STREAM_CHUNK_SIZE)
          const emittedSamples = takeBufferedSamples(bufferedChunks, emitCount)
          bufferedSampleCount -= emittedSamples.length
          emittedChunkInThisPass = true
          emitSampleChunk(session, emittedSamples, sampleRate, text, false)
        }
      }

      const bufferSamples = (samples) => {
        if (!samples.length) {
          return
        }

        const nextSamples = preparedLeadInForThisPass
          ? samples
          : enhanceSpeechSamples(
              samples,
              sampleRate,
              {
                ...buildLeadInOptions(session, { fadeOutMs: 0, normalizePeak: false }),
                fadeOutMs: 0,
                normalizePeak: false,
              },
            )

        if (!preparedLeadInForThisPass) {
          preparedLeadInForThisPass = true
        }

        bufferedChunks.push(nextSamples)
        bufferedSampleCount += nextSamples.length
        flushBufferedSamples(false)
      }

      stream.on('data', (chunk) => {
        if (session.closed) {
          stream.destroy()
          resolve()
          return
        }

        streamYieldedData = true
        session.timing?.mark('firstPcmChunk')
        const merged = residual.length > 0 ? Buffer.concat([residual, chunk]) : chunk
        const usableLength = merged.length - (merged.length % 2)
        if (usableLength > 0) {
          const samples = decodePcm16LeBufferToFloat32(merged.slice(0, usableLength))
          bufferSamples(samples)
        }
        residual = usableLength < merged.length ? merged.slice(usableLength) : Buffer.alloc(0)
      })

      stream.on('end', () => {
        if (residual.length >= 2) {
          const usableLength = residual.length - (residual.length % 2)
          if (usableLength > 0) {
            const samples = decodePcm16LeBufferToFloat32(residual.slice(0, usableLength))
            bufferSamples(samples)
          }
        }
        flushBufferedSamples(true)

        if (!streamYieldedData && !session.closed) {
          // Empty PCM stream — surface it as an explicit error so the
          // renderer controller fails fast and upstream can fall back to
          // direct-speech instead of silently 'finishing without playback'.
          console.warn(
            '[TTS-Stream] remote pcmStream ended without emitting any data:',
            formatStreamTextLogMeta(text),
          )
          emit(session.sender, {
            type: 'error',
            requestId: session.requestId,
            message: 'TTS 远端未返回任何音频数据。',
          })
        }
        resolve()
      })

      stream.on('error', (err) => {
        // A user barge-in / teardown destroys the stream through the abort
        // signal. That is a clean stop, not a synthesis failure — surfacing
        // it would paint an error after the user already moved on.
        if (session.closed) {
          resolve()
          return
        }
        const message = getRedactedErrorMessage(err) || '流式音频传输中断。'
        console.error('[TTS-Stream] PCM stream error:', message)
        emit(session.sender, {
          type: 'error',
          requestId: session.requestId,
          message,
        })
        resolve()
      })
    })
  }

  function decodeRemoteResult(result) {
    if (result.pcmBuffer) {
      return {
        samples: decodePcm16LeBufferToFloat32(result.pcmBuffer),
        sampleRate: result.pcmSampleRate || DEFAULT_PCM_SAMPLE_RATE,
      }
    }

    const rawBuffer = Buffer.from(result.audioBase64, 'base64')
    const mime = (result.mimeType || '').toLowerCase()

    if (mime.includes('wav') || mime.includes('wave') || mime.includes('pcm')) {
      return decodeWav(rawBuffer)
    }

    if (mime && !mime.includes('octet-stream')) {
      throw new Error(
        `远程 TTS 返回了不支持的音频格式 (${result.mimeType})，流式解码仅支持 WAV 或 PCM 格式。`
        + '请将语音输出格式配置为 WAV 或 PCM。',
      )
    }

    // Unknown or octet-stream MIME — attempt WAV decode as last resort.
    try {
      return decodeWav(rawBuffer)
    } catch {
      throw new Error('远程 TTS 返回的音频格式不支持流式解码，请将输出格式配置为 WAV 或 PCM。')
    }
  }

  async function emitRemoteResult(session, text, result) {
    if (session.closed) {
      return
    }

    if (result.pcmStream) {
      await emitStreamedPcmResult(session, text, result)
      return
    }

    const decoded = decodeRemoteResult(result)
    // Non-streaming provider: the whole clip arrived at once, so "first PCM
    // chunk" and "synthesis finished" are the same instant.
    session.timing?.mark('firstPcmChunk')
    emitSamples(
      session,
      enhanceSpeechSamples(decoded.samples, decoded.sampleRate, buildLeadInOptions(session)),
      decoded.sampleRate,
      text,
    )
  }

  async function warmupRemoteSession(session) {
    await session.remoteWarmup?.catch(() => undefined)
  }

  async function synthesizeSegment(session, text, style) {
    await warmupRemoteSession(session)
    if (session.closed) return null
    // `session.payload` stays the pinned voice/speaker. Only this sentence's
    // copy carries its own tone instruction and pace nudge.
    session.timing?.mark('firstSegmentSynthStart')
    const styledPayload = applySegmentStyle(session.payload, style)
    const result = await synthesizeRemote(styledPayload, text, session.abortController?.signal)
    if (session.closed) {
      destroyResultStream(result)
      return null
    }
    // Pin the resolved voice/cluster after the first chunk so subsequent
    // chunks reuse the exact same combo instead of re-walking the fallback
    // chain (which otherwise stitches chunks together with different voices).
    // With one-segment-ahead pipelining the next request may already be in
    // flight; it resolves this same pin when its own result lands.
    if (result?.resolvedVoice && session.payload.voice !== result.resolvedVoice) {
      // Loud warning: an in-session voice swap is the exact mechanism behind
      // the "timbre changes when the pet speaks" reports. Pair this with the
      // renderer-side [Voice] TTS dispatch log to see what the user asked for
      // versus what the provider actually used.
      console.warn('[TTS-Stream] provider swapped voice mid-session', {
        requestId: session.requestId,
        requestedVoice: session.payload.voice,
        resolvedVoice: result.resolvedVoice,
        usedFallback: Boolean(result.usedFallback),
      })
      session.payload = { ...session.payload, voice: result.resolvedVoice }
    } else if (result?.usedFallback) {
      console.warn('[TTS-Stream] provider used fallback attempt', {
        requestId: session.requestId,
        voice: session.payload.voice,
      })
    }
    if (result?.resolvedCluster && session.payload.model !== result.resolvedCluster) {
      session.payload = { ...session.payload, model: result.resolvedCluster }
    }
    return result
  }

  async function emitSegmentResult(session, text, result) {
    if (!result || session.closed) {
      destroyResultStream(result)
      return
    }
    await emitRemoteResult(session, text, result)
  }

  function destroyResultStream(result) {
    try {
      result?.pcmStream?.destroy?.()
    } catch {
      // Already torn down by the provider or the abort signal.
    }
  }

  /**
   * Synthesize the queue one segment at a time, but start segment N+1's
   * synthesis as soon as N's synthesis resolves — while N is still emitting
   * PCM. Emission order stays strictly N, N+1, N+2 because only the emission
   * is awaited serially.
   */
  async function runSynthesisQueue(session) {
    while (!session.closed) {
      const entry = session.queue.shift()
      if (!entry) break

      const result = await (entry.synthesis ?? beginSynthesis(session, entry))
      if (session.closed) {
        destroyResultStream(result)
        break
      }
      if (!result) break

      const next = session.queue[0]
      if (next && !next.synthesis) {
        next.synthesis = beginSynthesis(session, next)
      }

      await emitSegmentResult(session, entry.text, result)
    }
  }

  function beginSynthesis(session, entry) {
    const promise = synthesizeSegment(session, entry.text, entry.style)
    // The lookahead promise is awaited one iteration later; it may also reject
    // on abort before anyone awaits it, so keep a no-op observer attached.
    promise.catch(() => undefined)
    return promise
  }

  function scheduleQueue(session) {
    if (session.driver || session.closed) return
    session.driver = runSynthesisQueue(session)
      .catch((error) => {
        closeSessionWithError(session, error)
      })
      .finally(() => {
        session.driver = null
        // A pushText that landed while the loop was finishing needs its own
        // driver, otherwise its audio would never be synthesized.
        if (!session.closed && session.queue.length) {
          scheduleQueue(session)
        }
      })
  }

  async function waitForQueue(session) {
    while (session.driver) {
      await session.driver.catch(() => undefined)
      if (!session.driver) break
    }
  }

  function closeSessionWithError(session, error) {
    if (session.closed) {
      // Abort/teardown already owns the session; a late AbortError from the
      // cancelled lookahead synthesis is a clean stop, not a failure.
      return
    }

    session.closed = true
    // Cancels both in-flight syntheses: the segment that failed and the
    // lookahead started for the segment after it.
    session.abortController?.abort()
    detachSenderListener(session)
    clearSession(session.requestId)
    emit(session.sender, {
      type: 'error',
      requestId: session.requestId,
      message: error instanceof Error ? error.message : '语音合成好像没接上。',
    })
  }

  return {
    async start(sender, payload) {
      const requestId = String(payload?.requestId ?? '').trim()
      if (!requestId) {
        throw new Error('缺少流式 TTS requestId。')
      }

      if (sessions.has(requestId)) {
        throw new Error('流式 TTS requestId 已存在，请重新发起会话。')
      }

      if (!synthesizeRemote) {
        throw new Error('远程流式 TTS 未配置。')
      }

      const abortController = new AbortController()
      // A cold local model can take over a minute to load. Resolve the start
      // call only after that warm-up, so the renderer's first-audio watchdog
      // measures synthesis latency instead of checkpoint loading.
      if (warmupRemote) {
        const onDestroyedDuringWarmup = () => abortController.abort()
        sender.once('destroyed', onDestroyedDuringWarmup)
        try {
          await warmupRemote(payload, abortController.signal)
        } finally {
          if (!sender.isDestroyed()) {
            sender.removeListener('destroyed', onDestroyedDuringWarmup)
          }
        }
      }

      if (sender.isDestroyed()) {
        return { ok: false }
      }

      const session = {
        requestId,
        sender,
        payload,
        queue: [],
        driver: null,
        closed: false,
        hasEmittedAudio: false,
        remoteWarmup: Promise.resolve(),
        abortController,
        // Marks start after warm-up so a cold local checkpoint is not charged
        // to synthesis latency.
        timing: createTtsTimingMarks(),
        firstSegmentChars: null,
        latencyReported: false,
      }

      // If the renderer tears down mid-stream, mark the session closed and
      // drop it from the map. The push_text chain short-circuits on
      // session.closed so any in-flight synthesize calls stop consuming their
      // PCM streams on the next boundary, releasing the socket.
      const onSenderDestroyed = () => {
        session.closed = true
        session.queue.length = 0
        session.abortController?.abort()
        sessions.delete(requestId)
      }
      sender.once('destroyed', onSenderDestroyed)
      session.onSenderDestroyed = onSenderDestroyed

      sessions.set(requestId, session)

      return { ok: true }
    },

    pushText(sender, payload) {
      const session = getSessionOrNull(payload?.requestId)
      if (!session || session.sender !== sender || session.closed) {
        return { ok: false }
      }

      const text = String(payload?.text ?? '').trim()
      if (!text) {
        return { ok: true }
      }

      const style = normalizeSegmentStyle(payload?.style)

      if (session.firstSegmentChars === null) {
        session.firstSegmentChars = text.length
      }
      session.timing?.mark('firstSegmentQueued')
      session.queue.push({ text, style })
      scheduleQueue(session)

      return { ok: true }
    },

    async finish(sender, payload) {
      const session = getSessionOrNull(payload?.requestId)
      if (!session || session.sender !== sender) {
        return { ok: false }
      }

      await waitForQueue(session)
      if (!session.closed) {
        session.closed = true
        emit(session.sender, {
          type: 'end',
          requestId: session.requestId,
        })
      }
      detachSenderListener(session)
      clearSession(session.requestId)
      return { ok: true }
    },

    abort(sender, payload) {
      const session = getSessionOrNull(payload?.requestId)
      if (!session || session.sender !== sender) {
        return { ok: false }
      }

      session.closed = true
      // Drop anything not yet started; the abort signal tears down the
      // in-flight synthesis and the one-ahead lookahead synthesis together.
      session.queue.length = 0
      session.abortController?.abort()
      detachSenderListener(session)
      clearSession(session.requestId)
      return { ok: true }
    },
  }
}
