/**
 * Tencent Cloud Real-Time Speech Recognition WebSocket client.
 *
 * Protocol:
 *   1. Client connects to wss://asr.cloud.tencent.com/asr/v2/<APPID>?{signed params}
 *   2. Server confirms handshake with JSON { code: 0, voice_id }
 *   3. Client sends binary PCM audio frames
 *   4. Server streams back JSON with partial (slice_type=1) and final (slice_type=2) results
 *   5. Client sends {"type":"end"} text frame to finish
 *
 * Credentials: SecretId + SecretKey from Tencent Cloud console (CAM > API Keys).
 * The AppID is extracted from the SecretId or passed separately.
 */

import { createHmac } from 'node:crypto'
import { BrowserWindow } from 'electron'

/** @type {'disconnected'|'connecting'|'ready'|'streaming'} */
let _state = 'disconnected'
/** @type {WebSocket|null} */
let _ws = null
let _lastPartialText = ''
let _lastFinalText = ''

/** @type {((text: string) => void)|null} */
let _finishResolve = null
/** @type {ReturnType<typeof setTimeout>|null} */
let _finishTimeout = null

/** @type {{ appId: string; secretId: string; secretKey: string; engineModelType: string; hotwordList: string }|null} */
let _credentials = null

const CONNECTION_TIMEOUT_MS = 8_000
const FINISH_TIMEOUT_MS = 6_000
const SUPPORTED_SAMPLE_RATE = 16000

// ── Signing ──

function buildSignedUrl(appId, secretId, secretKey, engineModelType, hotwordList) {
  const timestamp = Math.floor(Date.now() / 1000)
  const expired = timestamp + 86400
  const nonce = Math.floor(Math.random() * 900000000) + 100000000
  const voiceId = `nexus_${Date.now()}_${nonce}`

  // Core params that participate in HMAC signature
  const params = {
    engine_model_type: engineModelType,
    expired: String(expired),
    filter_dirty: '1',
    filter_modal: '1',
    filter_punc: '0',
    convert_num_mode: '1',
    needvad: '1',
    nonce: String(nonce),
    secretid: secretId,
    timestamp: String(timestamp),
    voice_format: '1', // PCM
    voice_id: voiceId,
    word_info: '0',
  }

  // Sort params alphabetically and compute signature
  const sortedKeys = Object.keys(params).sort()
  const queryParts = sortedKeys.map((k) => `${k}=${params[k]}`)
  const signString = `asr.cloud.tencent.com/asr/v2/${appId}?${queryParts.join('&')}`

  const signature = createHmac('sha1', secretKey)
    .update(signString)
    .digest('base64')

  const encodedSig = encodeURIComponent(signature)
  const queryString = queryParts.map((p) => encodeURIComponent(p.split('=')[0]) + '=' + encodeURIComponent(p.split('=')[1])).join('&')

  let url = `wss://asr.cloud.tencent.com/asr/v2/${appId}?${queryString}&signature=${encodedSig}`

  // Append hotword_list AFTER signature (not included in HMAC computation).
  // Tencent real-time ASR expects base64-encoded hotword list.
  if (hotwordList) {
    try {
      const encoded = Buffer.from(hotwordList, 'utf-8').toString('base64')
      url += `&hotword_list=${encodeURIComponent(encoded)}`
    } catch {
      // Skip hotwords if encoding fails
    }
  }

  return url
}

// ── IPC to renderer ──

function sendToRenderer(channel, data) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, data)
    }
  }
}

// ── Message handling ──

function handleMessage(rawData) {
  try {
    const data = JSON.parse(typeof rawData === 'string' ? rawData : rawData.toString())

    if (data.code !== 0) {
      console.error('[TencentASR] server error:', data.code, data.message)
      sendToRenderer('tencent-asr:result', {
        type: 'error',
        text: data.message || `腾讯云语音识别错误 (code=${data.code})`,
      })
      return
    }

    // Top-level final=1 means session complete
    if (data.final === 1) {
      const text = data.result?.voice_text_str ?? ''
      if (text) {
        _lastFinalText = text
        sendToRenderer('tencent-asr:result', { type: 'final', text })
      }

      if (_finishResolve) {
        const resolve = _finishResolve
        _finishResolve = null
        if (_finishTimeout) { clearTimeout(_finishTimeout); _finishTimeout = null }
        resolve(_lastFinalText || _lastPartialText)
      }
      return
    }

    const result = data.result
    if (!result) return

    const text = (result.voice_text_str ?? '').trim()
    if (!text) return

    const sliceType = result.slice_type

    if (sliceType === 2) {
      // Final result for this speech segment
      _lastFinalText = text
      _lastPartialText = ''
      console.log('[TencentASR] final:', text.slice(0, 80))
      sendToRenderer('tencent-asr:result', { type: 'final', text })

      if (_finishResolve) {
        const resolve = _finishResolve
        _finishResolve = null
        if (_finishTimeout) { clearTimeout(_finishTimeout); _finishTimeout = null }
        resolve(text)
      }
    } else if (sliceType === 0 || sliceType === 1) {
      // Partial/interim result
      if (text !== _lastPartialText) {
        _lastPartialText = text
        console.log('[TencentASR] partial:', text.slice(0, 80))
        sendToRenderer('tencent-asr:result', { type: 'partial', text })
      }
    }
  } catch {
    console.warn('[TencentASR] unparseable message')
  }
}

// ── Public API ──

export function configure(credentials) {
  _credentials = {
    appId: String(credentials.appId ?? '').trim(),
    secretId: String(credentials.secretId ?? '').trim(),
    secretKey: String(credentials.secretKey ?? '').trim(),
    engineModelType: String(credentials.engineModelType ?? '16k_zh').trim(),
    hotwordList: String(credentials.hotwordList ?? '').trim(),
  }
}

export async function connect(credentials) {
  if (_state !== 'disconnected') {
    await disconnect()
  }

  if (credentials) {
    configure(credentials)
  }

  if (!_credentials || !_credentials.appId || !_credentials.secretId || !_credentials.secretKey) {
    throw new Error('腾讯云语音识别缺少必要凭证 (AppID / SecretId / SecretKey)。请在设置中填写。')
  }

  _state = 'connecting'
  _lastPartialText = ''
  _lastFinalText = ''

  const wsUrl = buildSignedUrl(
    _credentials.appId,
    _credentials.secretId,
    _credentials.secretKey,
    _credentials.engineModelType,
    _credentials.hotwordList,
  )

  console.info('[TencentASR] connecting...')

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      _state = 'disconnected'
      try { ws.close() } catch {}
      reject(new Error(`腾讯云语音识别连接超时 (${CONNECTION_TIMEOUT_MS / 1000}s)`))
    }, CONNECTION_TIMEOUT_MS)

    let ws
    try {
      ws = new globalThis.WebSocket(wsUrl)
    } catch (err) {
      clearTimeout(timeoutId)
      _state = 'disconnected'
      reject(new Error(`WebSocket 创建失败: ${err.message}`))
      return
    }

    ws.binaryType = 'arraybuffer'

    ws.addEventListener('open', () => {
      // Wait for server handshake confirmation before resolving
    })

    ws.addEventListener('message', (event) => {
      const rawData = typeof event.data === 'string' ? event.data : event.data.toString()

      // Check if this is the handshake confirmation
      if (_state === 'connecting') {
        try {
          const data = JSON.parse(rawData)
          if (data.code === 0) {
            clearTimeout(timeoutId)
            _ws = ws
            _state = 'streaming' // Tencent protocol is immediately in streaming mode after connect
            console.info('[TencentASR] connected, voice_id:', data.voice_id)
            resolve()
            return
          }
          clearTimeout(timeoutId)
          _state = 'disconnected'
          reject(new Error(data.message || `腾讯云握手失败 (code=${data.code})`))
          return
        } catch {
          // Not JSON, ignore
        }
      }

      handleMessage(rawData)
    })

    ws.addEventListener('error', (event) => {
      console.error('[TencentASR] ws error:', event.message ?? 'unknown')
    })

    ws.addEventListener('close', (event) => {
      clearTimeout(timeoutId)
      const wasConnecting = _state === 'connecting'
      _ws = null
      _state = 'disconnected'
      console.info(`[TencentASR] ws closed (code=${event.code})`)

      if (_finishResolve) {
        const resolve = _finishResolve
        _finishResolve = null
        if (_finishTimeout) { clearTimeout(_finishTimeout); _finishTimeout = null }
        resolve(_lastFinalText || _lastPartialText)
      }

      if (wasConnecting) {
        reject(new Error(`腾讯云 WebSocket 在连接过程中关闭 (code=${event.code})`))
      }
    })
  })
}

export function feedAudio(samples) {
  if (!_ws || _state !== 'streaming') return

  // Convert Float32Array to Int16 PCM
  const pcm16 = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
  }

  _ws.send(pcm16.buffer)
}

export function finishStream() {
  if (!_ws || _state !== 'streaming') {
    return Promise.resolve(_lastFinalText || _lastPartialText)
  }

  // Signal end of audio
  _ws.send(JSON.stringify({ type: 'end' }))

  return new Promise((resolve) => {
    _finishResolve = resolve
    _finishTimeout = setTimeout(() => {
      _finishTimeout = null
      if (_finishResolve) {
        const r = _finishResolve
        _finishResolve = null
        console.log('[TencentASR] finish timeout, using cached:', (_lastFinalText || _lastPartialText).slice(0, 60))
        r(_lastFinalText || _lastPartialText)
      }
    }, FINISH_TIMEOUT_MS)
  })
}

export function abortStream() {
  _lastPartialText = ''
  _lastFinalText = ''
  if (_finishResolve) {
    const resolve = _finishResolve
    _finishResolve = null
    if (_finishTimeout) { clearTimeout(_finishTimeout); _finishTimeout = null }
    resolve('')
  }
}

export async function disconnect() {
  abortStream()
  if (_ws) {
    const ws = _ws
    _ws = null
    await new Promise((resolve) => {
      ws.addEventListener('close', resolve, { once: true })
      try { ws.close() } catch {}
      setTimeout(resolve, 2_000)
    })
  }
  _state = 'disconnected'
  console.info('[TencentASR] disconnected')
}

export function getStatus() {
  return { state: _state }
}

export function isStreaming() {
  return _state === 'streaming'
}
