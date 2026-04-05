import nodeNet from 'node:net'

/** @type {'disconnected'|'connecting'|'connected'} */
let _state = 'disconnected'
/** @type {WebSocket|null} */
let _ws = null
/** @type {ReturnType<typeof setTimeout>|null} */
let _reconnectTimer = null
let _reconnectCount = 0
let _intentionallyClosed = false

/** @type {{ address: string, port: number, username: string }|null} */
let _config = null

/** @type {Array<{ type: string, body: string, sender: string, timestamp: string }>} */
let _eventLog = []

const MAX_EVENT_LOG = 64
const MAX_RECONNECT_ATTEMPTS = 5
const BASE_RECONNECT_DELAY_MS = 3_000
const CONNECTION_TIMEOUT_MS = 8_000

/** @type {((event: object) => void)|null} */
let _eventCallback = null

function pushEvent(type, body, sender = '') {
  const entry = { type, body, sender, timestamp: new Date().toISOString() }
  _eventLog.push(entry)
  if (_eventLog.length > MAX_EVENT_LOG) {
    _eventLog = _eventLog.slice(-MAX_EVENT_LOG)
  }
  _eventCallback?.(entry)
}

function clearReconnectTimer() {
  if (_reconnectTimer) {
    clearTimeout(_reconnectTimer)
    _reconnectTimer = null
  }
}

function scheduleReconnect() {
  if (_intentionallyClosed || !_config) return
  if (_reconnectCount >= MAX_RECONNECT_ATTEMPTS) {
    console.warn('[minecraft] max reconnect attempts reached')
    _state = 'disconnected'
    pushEvent('error', `Gave up after ${MAX_RECONNECT_ATTEMPTS} reconnect attempts.`)
    return
  }

  const delayMs = BASE_RECONNECT_DELAY_MS * Math.pow(2, _reconnectCount)
  _reconnectCount++
  console.info(`[minecraft] reconnect #${_reconnectCount} in ${delayMs}ms`)
  pushEvent('info', `Reconnecting in ${Math.round(delayMs / 1000)}s...`)

  _reconnectTimer = setTimeout(() => {
    _reconnectTimer = null
    if (_intentionallyClosed || !_config) return
    connect(_config.address, _config.port, _config.username).catch((err) => {
      console.error('[minecraft] reconnect failed:', err.message)
      scheduleReconnect()
    })
  }, delayMs)
}

function handleWsMessage(rawData) {
  try {
    const message = JSON.parse(typeof rawData === 'string' ? rawData : rawData.toString())
    const header = message?.header ?? {}
    const body = message?.body ?? {}

    if (header.messagePurpose === 'event') {
      const eventName = header.eventName ?? 'unknown'
      pushEvent(eventName, JSON.stringify(body), body.sender ?? '')
    } else if (header.messagePurpose === 'commandResponse') {
      pushEvent('commandResponse', JSON.stringify(body))
    }
  } catch {
    console.warn('[minecraft] unparseable message')
  }
}

export async function connect(address, port, username) {
  if (_state === 'connecting' || _state === 'connected') {
    throw new Error(`Minecraft gateway is already ${_state}`)
  }

  _config = { address, port, username }
  _intentionallyClosed = false
  _state = 'connecting'

  const wsUrl = `ws://${address}:${port}`
  console.info('[minecraft] connecting to', wsUrl)

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      _state = 'disconnected'
      try { ws.close() } catch {}
      reject(new Error(`Connection to ${wsUrl} timed out after ${CONNECTION_TIMEOUT_MS / 1000}s`))
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

    ws.addEventListener('open', () => {
      clearTimeout(timeoutId)
      _ws = ws
      _state = 'connected'
      _reconnectCount = 0
      console.info('[minecraft] connected')
      pushEvent('connected', `Connected to ${wsUrl} as ${username}`)

      subscribeToEvents(ws)
      resolve()
    })

    ws.addEventListener('error', (event) => {
      console.error('[minecraft] ws error:', event.message ?? 'unknown')
    })

    ws.addEventListener('close', (event) => {
      clearTimeout(timeoutId)
      const wasConnected = _state === 'connected'
      _ws = null
      _state = 'disconnected'
      console.info(`[minecraft] ws closed (code=${event.code})`)
      pushEvent('disconnected', `Connection closed (code=${event.code})`)

      if (wasConnected && !_intentionallyClosed) {
        scheduleReconnect()
      } else if (_state === 'connecting') {
        reject(new Error(`WebSocket closed during handshake (code=${event.code})`))
      }
    })
  })
}

function subscribeToEvents(ws) {
  const events = [
    'PlayerMessage',
    'PlayerJoin',
    'PlayerLeave',
    'PlayerDied',
    'PlayerTravelled',
    'BlockPlaced',
    'BlockBroken',
    'ItemUsed',
  ]

  for (const eventName of events) {
    const subscribeMsg = JSON.stringify({
      header: {
        version: 1,
        requestId: crypto.randomUUID(),
        messagePurpose: 'subscribe',
        messageType: 'commandRequest',
      },
      body: { eventName },
    })
    ws.send(subscribeMsg)
  }
}

export function sendCommand(command) {
  if (!_ws || _state !== 'connected') {
    throw new Error('Minecraft gateway is not connected')
  }

  const message = JSON.stringify({
    header: {
      version: 1,
      requestId: crypto.randomUUID(),
      messagePurpose: 'commandRequest',
      messageType: 'commandRequest',
    },
    body: {
      version: 1,
      commandLine: command,
      origin: { type: 'player' },
    },
  })

  _ws.send(message)
}

export async function disconnect() {
  clearReconnectTimer()
  _intentionallyClosed = true

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
  _config = null
  console.info('[minecraft] disconnected')
}

export function getStatus() {
  return {
    state: _state,
    address: _config?.address ?? null,
    port: _config?.port ?? null,
    username: _config?.username ?? null,
    reconnectCount: _reconnectCount,
    recentEvents: _eventLog.slice(-8),
  }
}

export function getRecentEvents(limit = 16) {
  return _eventLog.slice(-limit)
}

export function onEvent(callback) {
  _eventCallback = callback
}

export function getGameContext() {
  if (_state !== 'connected') return null

  const chatMessages = _eventLog
    .filter((e) => e.type === 'PlayerMessage')
    .slice(-6)
    .map((e) => {
      try {
        const body = JSON.parse(e.body)
        return `[${e.timestamp}] ${body.sender ?? '?'}: ${body.message ?? ''}`
      } catch {
        return `[${e.timestamp}] ${e.body}`
      }
    })

  const playerEvents = _eventLog
    .filter((e) => e.type === 'PlayerJoin' || e.type === 'PlayerLeave' || e.type === 'PlayerDied')
    .slice(-4)
    .map((e) => `[${e.timestamp}] ${e.type}`)

  return {
    game: 'minecraft',
    connected: true,
    address: `${_config?.address}:${_config?.port}`,
    username: _config?.username ?? '',
    recentChat: chatMessages,
    recentPlayerEvents: playerEvents,
  }
}
