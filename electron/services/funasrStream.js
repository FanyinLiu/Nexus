/**
 * FunASR WebSocket streaming STT client.
 *
 * Connects to a local FunASR server (funasr-wss-server or funasr-wss-server-2pass)
 * for real-time streaming speech recognition with high accuracy.
 *
 * Protocol:
 *   1. Client sends JSON config on connect
 *   2. Client streams PCM audio chunks as binary
 *   3. Server responds with JSON containing partial/final results
 *   4. Client sends {"is_speaking": false} to signal end of utterance
 *
 * Deploy FunASR server:
 *   pip install funasr
 *   python scripts/funasr_server.py --port 10095
 */

import { BrowserWindow } from 'electron'

/** @type {'disconnected'|'connecting'|'ready'|'streaming'} */
let _state = 'disconnected'
/** @type {WebSocket|null} */
let _ws = null
/** @type {string} */
let _baseUrl = ''
let _lastPartialText = ''
let _lastFinalText = ''

/** @type {((resolve: string) => void)|null} */
let _finishResolve = null
/** @type {ReturnType<typeof setTimeout>|null} */
let _finishTimeout = null

const CONNECTION_TIMEOUT_MS = 6_000
const FINISH_TIMEOUT_MS = 8_000
const SUPPORTED_SAMPLE_RATE = 16000

function buildWsUrl(baseUrl) {
  const trimmed = baseUrl.replace(/\/+$/, '')
  if (trimmed.startsWith('ws://') || trimmed.startsWith('wss://')) {
    return trimmed
  }
  return `ws://${trimmed}`
}

function sendToRenderer(channel, data) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, data)
    }
  }
}

function handleMessage(rawData) {
  try {
    const data = JSON.parse(typeof rawData === 'string' ? rawData : rawData.toString())

    // FunASR response format:
    // { "text": "...", "mode": "online"/"offline"/"2pass-online"/"2pass-offline", "is_final": bool }
    const text = (data.text ?? '').trim()
    const mode = data.mode ?? ''
    const isFinal = data.is_final === true
      || mode === 'offline'
      || mode === '2pass-offline'

    if (!text) {
      // If this is a final-flagged empty response, resolve the finish promise
      if (isFinal && _finishResolve) {
        const resolve = _finishResolve
        _finishResolve = null
        if (_finishTimeout) { clearTimeout(_finishTimeout); _finishTimeout = null }
        resolve(_lastFinalText || _lastPartialText)
      }
      return
    }

    if (isFinal) {
      _lastFinalText = text
      _lastPartialText = ''
      console.log('[FunASR] final result:', text.slice(0, 60), '| mode:', mode)
      sendToRenderer('funasr:result', { type: 'final', text })

      // Only resolve the finish promise if we already sent {is_speaking: false}
      // (i.e. finishStream was called). During streaming, finals are just
      // intermediate refinements — don't end the session.
      if (_finishResolve) {
        const resolve = _finishResolve
        _finishResolve = null
        if (_finishTimeout) { clearTimeout(_finishTimeout); _finishTimeout = null }
        resolve(text)
      }
    } else {
      if (text !== _lastPartialText) {
        _lastPartialText = text
        console.log('[FunASR] partial result:', text.slice(0, 60), '| mode:', mode)
        sendToRenderer('funasr:result', { type: 'partial', text })
      }
    }
  } catch {
    console.warn('[FunASR] unparseable message')
  }
}

export async function connect(baseUrl) {
  if (_state !== 'disconnected') {
    throw new Error(`FunASR is already ${_state}`)
  }

  const wsUrl = buildWsUrl(baseUrl)
  _baseUrl = wsUrl
  _state = 'connecting'
  _lastPartialText = ''
  _lastFinalText = ''

  console.info('[FunASR] connecting to', wsUrl)

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      _state = 'disconnected'
      try { ws.close() } catch {}
      reject(new Error(`FunASR connection timed out (${CONNECTION_TIMEOUT_MS / 1000}s)`))
    }, CONNECTION_TIMEOUT_MS)

    let ws
    try {
      ws = new globalThis.WebSocket(wsUrl)
    } catch (err) {
      clearTimeout(timeoutId)
      _state = 'disconnected'
      reject(new Error(`Failed to create WebSocket: ${err.message}`))
      return
    }

    ws.binaryType = 'arraybuffer'

    ws.addEventListener('open', () => {
      clearTimeout(timeoutId)
      _ws = ws
      _state = 'ready'
      console.info('[FunASR] connected')
      resolve()
    })

    ws.addEventListener('message', (event) => {
      handleMessage(event.data)
    })

    ws.addEventListener('error', (event) => {
      console.error('[FunASR] ws error:', event.message ?? 'unknown')
    })

    ws.addEventListener('close', (event) => {
      clearTimeout(timeoutId)
      const wasConnecting = _state === 'connecting'
      _ws = null
      _state = 'disconnected'
      console.info(`[FunASR] ws closed (code=${event.code})`)

      // Resolve any pending finish with what we have
      if (_finishResolve) {
        const resolve = _finishResolve
        _finishResolve = null
        if (_finishTimeout) { clearTimeout(_finishTimeout); _finishTimeout = null }
        resolve(_lastFinalText || _lastPartialText)
      }

      if (wasConnecting) {
        reject(new Error(`FunASR WebSocket closed during connect (code=${event.code})`))
      }
    })
  })
}

export function startStream(options = {}) {
  if (!_ws || _state !== 'ready') {
    throw new Error(`FunASR is not ready (state: ${_state})`)
  }

  _state = 'streaming'
  _lastPartialText = ''
  _lastFinalText = ''

  // Send initial config
  const config = {
    mode: options.mode ?? '2pass',
    chunk_size: options.chunkSize ?? [5, 10, 5],
    wav_name: 'nexus-stream',
    is_speaking: true,
    wav_format: 'pcm',
    audio_fs: SUPPORTED_SAMPLE_RATE,
    hotwords: options.hotwords ?? '',
    itn: true,
  }

  _ws.send(JSON.stringify(config))
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

  // Signal end of speaking
  _ws.send(JSON.stringify({ is_speaking: false }))
  _state = 'ready'

  // Always wait for the server to send back the final refined result after
  // receiving {is_speaking: false}. Never resolve early from cached text —
  // the server's post-silence offline pass produces the most accurate result.
  return new Promise((resolve) => {
    _finishResolve = resolve
    _finishTimeout = setTimeout(() => {
      _finishTimeout = null
      if (_finishResolve) {
        const r = _finishResolve
        _finishResolve = null
        console.log('[FunASR] finish timeout, using cached text:', (_lastFinalText || _lastPartialText).slice(0, 60))
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
  if (_state === 'streaming') {
    _state = 'ready'
  }
}

export async function disconnect() {
  abortStream()
  if (_ws) {
    const ws = _ws
    _ws = null
    await new Promise((resolve) => {
      ws.addEventListener('close', resolve, { once: true })
      ws.close()
      setTimeout(resolve, 2_000)
    })
  }
  _state = 'disconnected'
  _baseUrl = ''
  console.info('[FunASR] disconnected')
}

export function getStatus() {
  return {
    state: _state,
    baseUrl: _baseUrl,
  }
}

export function isConnected() {
  return _state === 'ready' || _state === 'streaming'
}

export function isStreaming() {
  return _state === 'streaming'
}
