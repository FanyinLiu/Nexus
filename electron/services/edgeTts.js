/**
 * Microsoft Edge TTS WebSocket client.
 *
 * Connects directly to the Edge Read Aloud TTS service via WebSocket.
 * No API key required. Returns raw PCM audio stream.
 *
 * Protocol:
 *   1. Connect to wss://speech.platform.bing.com/...
 *   2. Send speech.config JSON
 *   3. Send SSML request
 *   4. Receive binary audio chunks (with 2-byte header + "Path:audio\r\n" prefix)
 *   5. Receive "Path:turn.end" text message when done
 */

import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'

const TRUSTED_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4'
const WS_BASE_URL = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1'
const CONNECT_TIMEOUT_MS = 8_000
const SYNTHESIS_TIMEOUT_MS = 15_000

// PCM 24kHz 16-bit mono
const OUTPUT_FORMAT = 'raw-24khz-16bit-mono-pcm'
const PCM_SAMPLE_RATE = 24000

function buildWsUrl() {
  const connectionId = randomUUID().replace(/-/g, '')
  return `${WS_BASE_URL}?TrustedClientToken=${TRUSTED_TOKEN}&ConnectionId=${connectionId}`
}

function isoTimestamp() {
  return new Date().toISOString()
}

function buildConfigMessage() {
  return [
    `X-Timestamp:${isoTimestamp()}`,
    'Content-Type:application/json; charset=utf-8',
    'Path:speech.config',
    '',
    JSON.stringify({
      context: {
        synthesis: {
          audio: {
            metadataoptions: {
              sentenceBoundaryEnabled: 'false',
              wordBoundaryEnabled: 'false',
            },
            outputFormat: OUTPUT_FORMAT,
          },
        },
      },
    }),
  ].join('\r\n')
}

function buildSsmlMessage(text, voice, rate, pitch, volume) {
  const requestId = randomUUID().replace(/-/g, '')
  // rate: Nexus 0.5-2.0 multiplier → SSML percentage offset (1.0 = +0%, 1.3 = +30%)
  const rateStr = rate != null ? `${rate >= 1 ? '+' : ''}${Math.round((rate - 1) * 100)}%` : '+0%'
  // pitch: Nexus 0.5-2.0 multiplier → SSML Hz offset (1.0 = +0Hz, 1.08 = +4Hz, 0.92 = -4Hz)
  const pitchStr = pitch != null ? `${(pitch - 1) * 50 >= 0 ? '+' : ''}${Math.round((pitch - 1) * 50)}Hz` : '+0Hz'
  // volume: Nexus 0-1.0 → SSML 0-100
  const volumeStr = volume != null ? `${Math.round(volume * 100)}` : '100'

  const escapeXml = (s) => String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&apos;')
    .replace(/"/g, '&quot;')

  const escapedText = escapeXml(text)
  const escapedVoice = escapeXml(voice)

  const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>`
    + `<voice name='${escapedVoice}'>`
    + `<prosody rate='${rateStr}' pitch='${pitchStr}' volume='${volumeStr}'>`
    + escapedText
    + `</prosody></voice></speak>`

  return [
    `X-RequestId:${requestId}`,
    'Content-Type:application/ssml+xml',
    `X-Timestamp:${isoTimestamp()}`,
    'Path:ssml',
    '',
    ssml,
  ].join('\r\n')
}

function extractAudioData(binaryMessage) {
  // Binary messages have a 2-byte header length prefix, then the header text,
  // then the raw audio bytes.
  const buffer = Buffer.isBuffer(binaryMessage)
    ? binaryMessage
    : Buffer.from(binaryMessage)

  if (buffer.length < 2) return null

  const headerLen = buffer.readUInt16BE(0)
  if (buffer.length <= 2 + headerLen) return null

  return buffer.slice(2 + headerLen)
}

/**
 * Synthesize text to a PCM stream using Edge TTS.
 *
 * @param {string} text - Text to synthesize
 * @param {object} options
 * @param {string} [options.voice] - Voice name (e.g. 'zh-CN-XiaoxiaoNeural')
 * @param {number} [options.rate] - Speech rate multiplier (1.0 = normal)
 * @param {number} [options.pitch] - Pitch adjustment in Hz
 * @param {number} [options.volume] - Volume (0.0 to 1.0)
 * @returns {Promise<{pcmStream: Readable, pcmSampleRate: number}>}
 */
export async function synthesizeEdgeTts(text, options = {}) {
  const voice = options.voice || 'zh-CN-XiaoxiaoNeural'
  const { rate, pitch, volume } = options

  const pcmStream = new Readable({ read() {} })
  const wsUrl = buildWsUrl()

  return new Promise((resolve, reject) => {
    let ws
    let resolved = false
    let firstChunkReceived = false
    let streamEnded = false

    const connectTimeout = setTimeout(() => {
      if (!resolved) {
        resolved = true
        try { ws?.close() } catch {}
        reject(new Error('Edge TTS 连接超时'))
      }
    }, CONNECT_TIMEOUT_MS)

    let synthesisTimeout

    try {
      ws = new globalThis.WebSocket(wsUrl)
    } catch (err) {
      clearTimeout(connectTimeout)
      reject(new Error(`Edge TTS WebSocket 创建失败: ${err.message}`))
      return
    }

    ws.binaryType = 'arraybuffer'

    ws.addEventListener('open', () => {
      clearTimeout(connectTimeout)

      // Send config
      ws.send(buildConfigMessage())
      // Send SSML
      ws.send(buildSsmlMessage(text, voice, rate, pitch, volume))

      synthesisTimeout = setTimeout(() => {
        if (!streamEnded) {
          streamEnded = true
          console.warn('[Edge-TTS] synthesis timeout — force-ending stream')
          pcmStream.push(null)
          try { ws.close() } catch {}
        }
      }, SYNTHESIS_TIMEOUT_MS)

      // Resolve immediately with the stream — audio chunks will be pushed as they arrive
      resolved = true
      resolve({ pcmStream, pcmSampleRate: PCM_SAMPLE_RATE })
    })

    ws.addEventListener('message', (event) => {
      if (typeof event.data === 'string') {
        // Text message — check for turn.end
        if (event.data.includes('Path:turn.end')) {
          clearTimeout(synthesisTimeout)
          if (!streamEnded) {
            streamEnded = true
            pcmStream.push(null)
          }
          try { ws.close() } catch {}
        }
        return
      }

      // Binary message — extract audio data
      const audioData = extractAudioData(event.data)
      if (audioData && audioData.length > 0) {
        if (!firstChunkReceived) {
          firstChunkReceived = true
          console.log('[Edge-TTS] first audio chunk received:', audioData.length, 'bytes')
        }
        pcmStream.push(audioData)
      }
    })

    ws.addEventListener('error', (event) => {
      clearTimeout(connectTimeout)
      clearTimeout(synthesisTimeout)
      const msg = `Edge TTS WebSocket 错误: ${event.message || 'unknown'}`
      console.error('[Edge-TTS]', msg)
      if (!resolved) {
        resolved = true
        reject(new Error(msg))
      } else {
        streamEnded = true
        pcmStream.destroy(new Error(msg))
      }
    })

    ws.addEventListener('close', () => {
      clearTimeout(connectTimeout)
      clearTimeout(synthesisTimeout)
      if (!resolved) {
        resolved = true
        reject(new Error('Edge TTS WebSocket 连接关闭'))
      } else {
        // Ensure stream ends
        if (!streamEnded && !pcmStream.destroyed) {
          streamEnded = true
          pcmStream.push(null)
        }
      }
    })
  })
}

export const EDGE_TTS_VOICES = [
  { id: 'zh-CN-XiaoxiaoNeural', label: '晓晓（中文女，推荐）' },
  { id: 'zh-CN-XiaoyiNeural', label: '晓伊（中文女）' },
  { id: 'zh-CN-YunjianNeural', label: '云健（中文男）' },
  { id: 'zh-CN-YunxiNeural', label: '云希（中文男）' },
  { id: 'zh-CN-YunxiaNeural', label: '云夏（中文男少年）' },
  { id: 'zh-CN-YunyangNeural', label: '云扬（中文男，新闻风）' },
  { id: 'zh-CN-liaoning-XiaobeiNeural', label: '晓北（东北话女）' },
  { id: 'zh-TW-HsiaoChenNeural', label: '曉臻（台灣女）' },
  { id: 'zh-TW-YunJheNeural', label: '雲哲（台灣男）' },
  { id: 'en-US-JennyNeural', label: 'Jenny (English Female)' },
  { id: 'en-US-AriaNeural', label: 'Aria (English Female)' },
  { id: 'en-US-GuyNeural', label: 'Guy (English Male)' },
  { id: 'ja-JP-NanamiNeural', label: 'Nanami (日本語女性)' },
  { id: 'ja-JP-KeitaNeural', label: 'Keita (日本語男性)' },
  { id: 'ko-KR-SunHiNeural', label: '선히 (한국어 여성)' },
  { id: 'ko-KR-InJoonNeural', label: '인준 (한국어 남성)' },
]
