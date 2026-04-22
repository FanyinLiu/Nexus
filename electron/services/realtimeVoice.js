import WebSocket from 'ws'

/** @type {WebSocket|null} */
let _ws = null
/** @type {'idle'|'connecting'|'active'|'error'} */
let _state = 'idle'
/** @type {string} */
let _sessionId = ''
/** @type {((event: object) => void)|null} */
let _eventCallback = null
/** @type {Promise<any>|null} */
let _startingSession = null

const REALTIME_API_URL = 'wss://api.openai.com/v1/realtime'
const CONNECTION_TIMEOUT_MS = 10_000

export function onRealtimeEvent(callback) {
  _eventCallback = callback
}

function emit(event) {
  _eventCallback?.(event)
}

function encodeAudioToBase64(samples) {
  const int16 = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return Buffer.from(int16.buffer).toString('base64')
}

function decodeBase64ToFloat32(base64) {
  const buffer = Buffer.from(base64, 'base64')
  const int16 = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.length / 2)
  const float32 = new Float32Array(int16.length)
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 0x8000
  }
  return float32
}

export async function startSession(options) {
  if (_startingSession) {
    await _startingSession.catch(() => {})
  }
  if (_ws) {
    await stopSession()
  }

  const {
    apiKey,
    baseUrl,
    model = 'gpt-4o-realtime-preview',
    voice = 'alloy',
    systemPrompt = '',
    temperature = 0.8,
    maxResponseTokens = 300,
  } = options

  const wsBaseUrl = (baseUrl || REALTIME_API_URL).replace(/^http/i, 'ws')
  const wsUrl = `${wsBaseUrl}?model=${encodeURIComponent(model)}`

  _state = 'connecting'
  _sessionId = crypto.randomUUID()

  emit({ type: 'state', state: _state, sessionId: _sessionId })

  const sessionPromise = new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      _state = 'error'
      emit({ type: 'state', state: _state, sessionId: _sessionId })
      try { ws?.close() } catch {}
      reject(new Error('Realtime API connection timed out'))
    }, CONNECTION_TIMEOUT_MS)

    let ws
    try {
      ws = new WebSocket(wsUrl, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'OpenAI-Beta': 'realtime=v1',
        },
      })
    } catch (err) {
      clearTimeout(timeoutId)
      _state = 'error'
      emit({ type: 'state', state: _state, sessionId: _sessionId })
      reject(new Error(`Failed to create WebSocket: ${err.message}`))
      return
    }

    ws.on('open', () => {
      clearTimeout(timeoutId)
      _ws = ws
      _state = 'active'

      ws.send(JSON.stringify({
        type: 'session.update',
        session: {
          modalities: ['text', 'audio'],
          instructions: systemPrompt || undefined,
          voice,
          input_audio_format: 'pcm16',
          output_audio_format: 'pcm16',
          input_audio_transcription: { model: 'whisper-1' },
          turn_detection: {
            type: 'server_vad',
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 500,
          },
          temperature,
          max_response_output_tokens: maxResponseTokens,
        },
      }))

      emit({ type: 'state', state: _state, sessionId: _sessionId })
      console.info('[realtime] session connected')
      resolve({ sessionId: _sessionId })
    })

    ws.on('message', (rawData) => {
      try {
        const msg = JSON.parse(typeof rawData === 'string' ? rawData : rawData.toString())
        handleServerEvent(msg)
      } catch {
        console.warn('[realtime] unparseable message')
      }
    })

    ws.on('error', (err) => {
      console.error('[realtime] ws error:', err.message)
    })

    ws.on('close', (code) => {
      clearTimeout(timeoutId)
      const previousState = _state
      _ws = null
      _state = 'idle'
      console.info(`[realtime] ws closed (code=${code})`)
      emit({ type: 'state', state: _state, sessionId: _sessionId })

      if (previousState === 'connecting') {
        reject(new Error(`WebSocket closed during handshake (code=${code})`))
      }
    })
  })
  _startingSession = sessionPromise.finally(() => { _startingSession = null })
  return sessionPromise
}

function handleServerEvent(msg) {
  switch (msg.type) {
    case 'session.created':
    case 'session.updated':
      break

    case 'input_audio_buffer.speech_started':
      emit({ type: 'user_speech_started', sessionId: _sessionId })
      break

    case 'input_audio_buffer.speech_stopped':
      emit({ type: 'user_speech_stopped', sessionId: _sessionId })
      break

    case 'conversation.item.input_audio_transcription.completed':
      emit({
        type: 'user_transcript',
        sessionId: _sessionId,
        text: msg.transcript ?? '',
      })
      break

    case 'response.audio.delta':
      if (msg.delta) {
        const samples = decodeBase64ToFloat32(msg.delta)
        emit({
          type: 'audio',
          sessionId: _sessionId,
          samples: Array.from(samples),
          sampleRate: 24000,
          channels: 1,
        })
      }
      break

    case 'response.audio_transcript.delta':
      emit({
        type: 'response_transcript_delta',
        sessionId: _sessionId,
        delta: msg.delta ?? '',
      })
      break

    case 'response.audio_transcript.done':
      emit({
        type: 'response_transcript_done',
        sessionId: _sessionId,
        text: msg.transcript ?? '',
      })
      break

    case 'response.done':
      emit({ type: 'response_done', sessionId: _sessionId })
      break

    case 'error':
      console.error('[realtime] server error:', msg.error?.message ?? msg)
      emit({
        type: 'error',
        sessionId: _sessionId,
        message: msg.error?.message ?? 'Unknown realtime API error',
      })
      break

    default:
      break
  }
}

export function feedAudio(samples) {
  if (!_ws || _state !== 'active') return

  const base64 = encodeAudioToBase64(samples)
  _ws.send(JSON.stringify({
    type: 'input_audio_buffer.append',
    audio: base64,
  }))
}

export function interrupt() {
  if (!_ws || _state !== 'active') return

  _ws.send(JSON.stringify({ type: 'response.cancel' }))
}

export function sendTextMessage(text) {
  if (!_ws || _state !== 'active') return

  _ws.send(JSON.stringify({
    type: 'conversation.item.create',
    item: {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text }],
    },
  }))
  _ws.send(JSON.stringify({ type: 'response.create' }))
}

export async function stopSession() {
  if (_ws) {
    const ws = _ws
    _ws = null
    await new Promise((resolve) => {
      const fallback = setTimeout(resolve, 2_000)
      ws.on('close', () => {
        clearTimeout(fallback)
        resolve()
      })
      ws.close()
    })
  }

  _state = 'idle'
  emit({ type: 'state', state: _state, sessionId: _sessionId })
  console.info('[realtime] session stopped')
}

export function getState() {
  return { state: _state, sessionId: _sessionId }
}
