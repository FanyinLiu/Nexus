import { randomUUID } from 'node:crypto'
import { decodePcm16LeBufferToFloat32, enhanceSpeechSamples } from './audioPostprocess.js'

const STREAM_CHUNK_SIZE = 4096
const INITIAL_STREAM_CHUNK_SIZE = 1024
const DEFAULT_PCM_SAMPLE_RATE = 24000

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

  function getSession(requestId) {
    const session = sessions.get(requestId)
    if (!session) {
      throw new Error('流式 TTS 会话不存在或已结束。')
    }
    return session
  }

  // Same lookup as getSession but returns null instead of throwing.
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
            '[TTS-Stream] remote pcmStream ended without emitting any data for text:',
            text?.slice(0, 80),
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
        console.error('[TTS-Stream] PCM stream error:', err?.message)
        emit(session.sender, {
          type: 'error',
          requestId: session.requestId,
          message: err instanceof Error ? err.message : '流式音频传输中断。',
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

  async function synthesizeAndEmitRemote(session, text) {
    await warmupRemoteSession(session)
    if (session.closed) return
    const result = await synthesizeRemote(session.payload, text)
    if (session.closed) return
    // Pin the resolved voice/cluster after the first chunk so subsequent
    // chunks reuse the exact same combo instead of re-walking the fallback
    // chain (which otherwise stitches chunks together with different voices).
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
    await emitRemoteResult(session, text, result)
  }

  return {
    start(sender, payload) {
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

      const session = {
        requestId,
        sender,
        payload,
        chain: Promise.resolve(),
        closed: false,
        hasEmittedAudio: false,
        remoteWarmup: Promise.resolve(),
      }

      // If the renderer tears down mid-stream, mark the session closed and
      // drop it from the map. The push_text chain short-circuits on
      // session.closed so any in-flight synthesize calls stop consuming their
      // PCM streams on the next boundary, releasing the socket.
      const onSenderDestroyed = () => {
        session.closed = true
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

      session.chain = session.chain.then(async () => {
        if (session.closed) {
          return
        }

        try {
          await synthesizeAndEmitRemote(session, text)
        } catch (error) {
          session.closed = true
          detachSenderListener(session)
          clearSession(session.requestId)
          emit(session.sender, {
            type: 'error',
            requestId: session.requestId,
            message: error instanceof Error ? error.message : '语音合成好像没接上。',
          })
        }
      })

      return { ok: true }
    },

    async finish(sender, payload) {
      const session = getSessionOrNull(payload?.requestId)
      if (!session || session.sender !== sender) {
        return { ok: false }
      }

      await session.chain.catch(() => undefined)
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
      detachSenderListener(session)
      clearSession(session.requestId)
      return { ok: true }
    },
  }
}
