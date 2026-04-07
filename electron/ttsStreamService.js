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
    samples: Array.from(samples),
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
    throw new Error('无法解析 WAV 音频数据。')
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
  return {
    prependSilenceMs: session.hasEmittedAudio ? 6 : 18,
    fadeInMs: session.hasEmittedAudio ? 8 : 12,
    fadeOutMs: Number.isFinite(options.fadeOutMs) ? options.fadeOutMs : 6,
    normalizePeak: options.normalizePeak !== false,
  }
}

export function createTtsStreamService({ sherpaTtsService, synthesizeRemote, warmupRemote }) {
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

  function clearSession(requestId) {
    sessions.delete(requestId)
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

      const isLocalSherpa = payload?.providerId === 'local-sherpa-tts'
      if (isLocalSherpa && !sherpaTtsService.isAvailable()) {
        throw new Error('本地流式 TTS 不可用，请检查 Sherpa 模型是否存在。')
      }
      if (!isLocalSherpa && !synthesizeRemote) {
        throw new Error('远程流式 TTS 未配置。')
      }

      sessions.set(requestId, {
        requestId,
        sender,
        payload,
        chain: Promise.resolve(),
        closed: false,
        hasEmittedAudio: false,
        remoteWarmup: payload?.providerId === 'local-qwen3-tts' && typeof warmupRemote === 'function'
          ? Promise.resolve(warmupRemote(payload)).catch(() => undefined)
          : Promise.resolve(),
      })

      return { ok: true }
    },

    pushText(sender, payload) {
      const session = getSession(payload?.requestId)
      if (session.sender !== sender || session.closed) {
        return { ok: false }
      }

      const text = String(payload?.text ?? '').trim()
      if (!text) {
        return { ok: true }
      }

      const isLocalSherpa = session.payload?.providerId === 'local-sherpa-tts'

      session.chain = session.chain.then(async () => {
        if (session.closed) {
          return
        }

        try {
          if (isLocalSherpa) {
            const { samples, sampleRate } = await sherpaTtsService.synthesizeSamples(text, {
              speed: Number.isFinite(session.payload?.rate) ? session.payload.rate : 1,
              sid: session.payload?.voice,
              leadingSilenceMs: session.hasEmittedAudio ? 6 : 18,
              fadeInMs: session.hasEmittedAudio ? 8 : 12,
              fadeOutMs: 6,
            })

            if (session.closed) {
              return
            }

            emitSamples(session, samples, sampleRate, text)
            return
          }

          await synthesizeAndEmitRemote(session, text)
        } catch (error) {
          session.closed = true
          clearSession(session.requestId)
          emit(session.sender, {
            type: 'error',
            requestId: session.requestId,
            message: error instanceof Error ? error.message : '流式 TTS 合成失败。',
          })
        }
      })

      return { ok: true }
    },

    async finish(sender, payload) {
      const session = getSession(payload?.requestId)
      if (session.sender !== sender) {
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
      clearSession(session.requestId)
      return { ok: true }
    },

    abort(sender, payload) {
      const session = getSession(payload?.requestId)
      if (session.sender !== sender) {
        return { ok: false }
      }

      session.closed = true
      clearSession(session.requestId)
      return { ok: true }
    },
  }
}
