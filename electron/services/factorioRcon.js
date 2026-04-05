import nodeNet from 'node:net'

/**
 * Factorio RCON protocol implementation.
 *
 * RCON packet format (little-endian):
 *   [4 bytes size] [4 bytes id] [4 bytes type] [body + \0] [\0]
 *
 * Types:
 *   SERVERDATA_AUTH          = 3
 *   SERVERDATA_AUTH_RESPONSE = 2
 *   SERVERDATA_EXECCOMMAND   = 2
 *   SERVERDATA_RESPONSE_VALUE = 0
 */

const SERVERDATA_AUTH = 3
const SERVERDATA_EXECCOMMAND = 2
const SERVERDATA_RESPONSE_VALUE = 0
const SERVERDATA_AUTH_RESPONSE = 2

/** @type {'disconnected'|'connecting'|'authenticating'|'connected'} */
let _state = 'disconnected'
/** @type {import('node:net').Socket|null} */
let _socket = null
/** @type {{ address: string, port: number, password: string }|null} */
let _config = null
let _nextId = 1
let _readBuffer = Buffer.alloc(0)

/** @type {Map<number, { resolve: Function, reject: Function, timeoutId: ReturnType<typeof setTimeout> }>} */
const _pending = new Map()

/** @type {Array<{ command: string, response: string, timestamp: string }>} */
let _commandLog = []
const MAX_COMMAND_LOG = 32

const CONNECTION_TIMEOUT_MS = 8_000
const REQUEST_TIMEOUT_MS = 10_000

function nextId() {
  return _nextId++
}

function encodePacket(id, type, body) {
  const bodyBuffer = Buffer.from(body, 'utf8')
  const size = 4 + 4 + bodyBuffer.length + 1 + 1
  const packet = Buffer.alloc(4 + size)
  packet.writeInt32LE(size, 0)
  packet.writeInt32LE(id, 4)
  packet.writeInt32LE(type, 8)
  bodyBuffer.copy(packet, 12)
  packet[12 + bodyBuffer.length] = 0
  packet[13 + bodyBuffer.length] = 0
  return packet
}

function drainReadBuffer() {
  while (_readBuffer.length >= 12) {
    const size = _readBuffer.readInt32LE(0)
    const totalPacketLength = 4 + size

    if (_readBuffer.length < totalPacketLength) break

    const id = _readBuffer.readInt32LE(4)
    const type = _readBuffer.readInt32LE(8)
    const bodyEnd = totalPacketLength - 2
    const body = _readBuffer.subarray(12, bodyEnd).toString('utf8')

    _readBuffer = _readBuffer.subarray(totalPacketLength)

    handlePacket(id, type, body)
  }
}

function handlePacket(id, type, body) {
  const pending = _pending.get(id)
  if (!pending) return

  clearTimeout(pending.timeoutId)
  _pending.delete(id)

  if (type === SERVERDATA_AUTH_RESPONSE) {
    if (id === -1) {
      pending.reject(new Error('RCON authentication failed: bad password'))
    } else {
      pending.resolve(body)
    }
    return
  }

  if (type === SERVERDATA_RESPONSE_VALUE) {
    pending.resolve(body)
    return
  }

  pending.resolve(body)
}

function rejectAllPending(message) {
  for (const [id, entry] of _pending) {
    clearTimeout(entry.timeoutId)
    entry.reject(new Error(message))
    _pending.delete(id)
  }
}

function sendPacket(id, type, body) {
  if (!_socket || _socket.destroyed) {
    throw new Error('RCON socket is not connected')
  }
  _socket.write(encodePacket(id, type, body))
}

function sendRequest(type, body) {
  return new Promise((resolve, reject) => {
    const id = nextId()
    const timeoutId = setTimeout(() => {
      _pending.delete(id)
      reject(new Error(`RCON request timed out (id=${id})`))
    }, REQUEST_TIMEOUT_MS)

    _pending.set(id, { resolve, reject, timeoutId })
    sendPacket(id, type, body)
  })
}

export async function connect(address, port, password) {
  if (_state !== 'disconnected') {
    throw new Error(`Factorio RCON is already ${_state}`)
  }

  _config = { address, port, password }
  _state = 'connecting'
  _readBuffer = Buffer.alloc(0)

  console.info(`[factorio-rcon] connecting to ${address}:${port}`)

  const socket = new nodeNet.Socket()
  _socket = socket

  await new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      _state = 'disconnected'
      socket.destroy()
      reject(new Error(`Connection to ${address}:${port} timed out`))
    }, CONNECTION_TIMEOUT_MS)

    socket.once('connect', () => {
      clearTimeout(timeoutId)
      resolve()
    })

    socket.once('error', (err) => {
      clearTimeout(timeoutId)
      _state = 'disconnected'
      _socket = null
      reject(new Error(`RCON connection error: ${err.message}`))
    })

    socket.connect(port, address)
  })

  socket.on('data', (chunk) => {
    _readBuffer = Buffer.concat([_readBuffer, chunk])
    drainReadBuffer()
  })

  socket.once('close', () => {
    console.info('[factorio-rcon] socket closed')
    _socket = null
    _state = 'disconnected'
    rejectAllPending('RCON socket closed')
  })

  socket.once('error', (err) => {
    console.error('[factorio-rcon] socket error:', err.message)
  })

  _state = 'authenticating'
  console.info('[factorio-rcon] authenticating...')

  try {
    await sendRequest(SERVERDATA_AUTH, password)
    _state = 'connected'
    console.info('[factorio-rcon] authenticated')
  } catch (err) {
    _state = 'disconnected'
    socket.destroy()
    _socket = null
    throw err
  }
}

export async function execute(command) {
  if (_state !== 'connected') {
    throw new Error(`Factorio RCON is not connected (state: ${_state})`)
  }

  const response = await sendRequest(SERVERDATA_EXECCOMMAND, command)

  _commandLog.push({
    command,
    response: String(response ?? ''),
    timestamp: new Date().toISOString(),
  })
  if (_commandLog.length > MAX_COMMAND_LOG) {
    _commandLog = _commandLog.slice(-MAX_COMMAND_LOG)
  }

  return response
}

export async function disconnect() {
  rejectAllPending('RCON disconnecting')

  if (_socket) {
    const socket = _socket
    _socket = null
    await new Promise((resolve) => {
      socket.once('close', resolve)
      socket.destroy()
      setTimeout(resolve, 2_000)
    })
  }

  _state = 'disconnected'
  _config = null
  console.info('[factorio-rcon] disconnected')
}

export function getStatus() {
  return {
    state: _state,
    address: _config?.address ?? null,
    port: _config?.port ?? null,
    recentCommands: _commandLog.slice(-4),
  }
}

export function getGameContext() {
  if (_state !== 'connected') return null

  return {
    game: 'factorio',
    connected: true,
    address: `${_config?.address}:${_config?.port}`,
    recentCommands: _commandLog.slice(-6).map((entry) => ({
      command: entry.command,
      response: entry.response.slice(0, 200),
      timestamp: entry.timestamp,
    })),
  }
}
