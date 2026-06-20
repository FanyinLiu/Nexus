import WebSocket from 'ws'
import { audit } from './auditLog.js'
import {
  vaultRetrieve,
  vaultStore,
} from './keyVault.js'

const VTS_API_NAME = 'VTubeStudioPublicAPI'
const VTS_API_VERSION = '1.0'
const PLUGIN_NAME = 'Nexus Companion'
const PLUGIN_DEVELOPER = 'FanyinLiu'
const VTS_AUTH_TOKEN_SLOT = 'pet:vts-auth-token'
const INJECT_INTERVAL_MS = 33
const REQUEST_TIMEOUT_MS = 5_000
const CONNECT_TIMEOUT_MS = 8_000

const NEXUS_PARAMS = [
  { id: 'NexusMouthOpen', min: 0, max: 1, defaultValue: 0 },
  { id: 'NexusMouthRound', min: 0, max: 1, defaultValue: 0 },
  { id: 'NexusMouthNarrow', min: 0, max: 1, defaultValue: 0 },
  { id: 'NexusSmile', min: -1, max: 1, defaultValue: 0 },
  { id: 'NexusCheek', min: 0, max: 1, defaultValue: 0 },
  { id: 'NexusBrowForm', min: -1, max: 1, defaultValue: 0 },
  { id: 'NexusBreath', min: 0, max: 1, defaultValue: 0 },
  { id: 'NexusAngleX', min: -30, max: 30, defaultValue: 0 },
  { id: 'NexusAngleY', min: -30, max: 30, defaultValue: 0 },
  { id: 'NexusAngleZ', min: -30, max: 30, defaultValue: 0 },
  { id: 'NexusBodyAngleX', min: -10, max: 10, defaultValue: 0 },
  { id: 'NexusEyeX', min: -1, max: 1, defaultValue: 0 },
  { id: 'NexusEyeY', min: -1, max: 1, defaultValue: 0 },
]

const expressionSlots = new Set([
  'idle',
  'thinking',
  'happy',
  'sleepy',
  'surprised',
  'confused',
  'embarrassed',
  'listening',
  'speaking',
  'touchHead',
  'touchFace',
  'touchBody',
])

let requestCounter = 0
let state = 'disconnected'
let modelName = ''
let lastError = ''
let currentPort = 8001
let authenticated = false
let connectGeneration = 0
let socket = null
let injectTimer = null

const pendingRequests = new Map()
const listeners = new Set()
const hotkeyMap = new Map()

const inputState = {
  expressionSlot: 'idle',
  speechLevel: 0,
  gazeTarget: { x: 0, y: 0 },
  isSpeaking: false,
  isListening: false,
}

const smoothedState = {
  gazeX: 0,
  gazeY: 0,
  speechLevel: 0,
}

let lastExpressionSlot = 'idle'

function nextRequestId() {
  requestCounter += 1
  return `nexus-${requestCounter}`
}

function getStatus() {
  return {
    state,
    modelName,
    port: currentPort,
    error: lastError,
  }
}

function emitStatus() {
  const status = getStatus()
  for (const listener of listeners) {
    try {
      listener(status)
    } catch {
      // Listener failures must not break the bridge.
    }
  }
}

function setStatus(nextState, options = {}) {
  state = nextState
  if ('modelName' in options) modelName = options.modelName || ''
  if ('error' in options) lastError = options.error || ''
  if (nextState !== 'error' && !('error' in options)) lastError = ''
  emitStatus()
}

function clearInjectTimer() {
  if (injectTimer) {
    clearInterval(injectTimer)
    injectTimer = null
  }
}

function rejectAllPending(reason) {
  for (const [, pending] of pendingRequests) {
    clearTimeout(pending.timeoutId)
    pending.reject(new Error(reason))
  }
  pendingRequests.clear()
}

function closeSocket() {
  if (socket) {
    const ws = socket
    socket = null
    try {
      ws.removeAllListeners?.()
      ws.close()
    } catch {
      // Ignore close failures from already-torn-down sockets.
    }
  }
}

function cleanupConnection(reason = 'Disconnected') {
  clearInjectTimer()
  authenticated = false
  hotkeyMap.clear()
  rejectAllPending(reason)
  closeSocket()
}

function toMessageText(rawData) {
  if (typeof rawData === 'string') return rawData
  if (Buffer.isBuffer(rawData)) return rawData.toString('utf8')
  return String(rawData)
}

function handleMessage(generation, rawData) {
  if (generation !== connectGeneration) return

  try {
    const msg = JSON.parse(toMessageText(rawData))
    const requestId = typeof msg?.requestID === 'string' ? msg.requestID : ''
    const pending = pendingRequests.get(requestId)
    if (!pending) return

    pendingRequests.delete(requestId)
    clearTimeout(pending.timeoutId)
    pending.resolve(msg.data ?? {})
  } catch {
    // Ignore malformed VTS messages.
  }
}

function sendVtsMessage(messageType, data = {}) {
  return new Promise((resolve, reject) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      reject(new Error('Not connected to VTube Studio'))
      return
    }

    const requestID = nextRequestId()
    const timeoutId = setTimeout(() => {
      if (pendingRequests.has(requestID)) {
        pendingRequests.delete(requestID)
        reject(new Error(`VTS request ${messageType} timed out`))
      }
    }, REQUEST_TIMEOUT_MS)

    pendingRequests.set(requestID, { resolve, reject, timeoutId })
    socket.send(JSON.stringify({
      apiName: VTS_API_NAME,
      apiVersion: VTS_API_VERSION,
      requestID,
      messageType,
      data,
    }))
  })
}

async function requestAuthToken() {
  const result = await sendVtsMessage('AuthenticationTokenRequest', {
    pluginName: PLUGIN_NAME,
    pluginDeveloper: PLUGIN_DEVELOPER,
  })
  const token = typeof result.authenticationToken === 'string' ? result.authenticationToken : ''
  if (!token) throw new Error('No auth token received')
  return token
}

async function authenticate(token) {
  const result = await sendVtsMessage('AuthenticationRequest', {
    pluginName: PLUGIN_NAME,
    pluginDeveloper: PLUGIN_DEVELOPER,
    authenticationToken: token,
  })
  authenticated = result.authenticated === true
  return authenticated
}

function createParameter(parameterName, min = -30, max = 30, defaultValue = 0) {
  return sendVtsMessage('ParameterCreationRequest', {
    parameterName,
    explanation: `Nexus companion parameter: ${parameterName}`,
    min,
    max,
    defaultValue,
  })
}

function injectParameters(parameters) {
  if (!authenticated || !parameters.length) return Promise.resolve()
  return sendVtsMessage('InjectParameterDataRequest', {
    faceFound: true,
    mode: 'set',
    parameterValues: parameters.map((parameter) => ({
      id: parameter.id,
      value: parameter.value,
      weight: parameter.weight ?? 1,
    })),
  })
}

async function getHotkeys() {
  const result = await sendVtsMessage('HotkeysInCurrentModelRequest', {})
  return Array.isArray(result.availableHotkeys) ? result.availableHotkeys : []
}

function triggerHotkey(hotkeyID) {
  return sendVtsMessage('HotkeyTriggerRequest', { hotkeyID })
}

async function getCurrentModel() {
  const result = await sendVtsMessage('CurrentModelRequest', {})
  return {
    modelLoaded: result.modelLoaded === true,
    modelName: String(result.modelName ?? ''),
    modelID: String(result.modelID ?? ''),
  }
}

async function initializeAuth(generation) {
  const stored = await vaultRetrieve(VTS_AUTH_TOKEN_SLOT)
  if (generation !== connectGeneration) return

  if (stored) {
    const ok = await authenticate(stored)
    if (generation !== connectGeneration) return
    if (ok) {
      await onAuthenticated(generation)
      return
    }
  }

  setStatus('auth_needed', { modelName: '' })
  const token = await requestAuthToken()
  if (generation !== connectGeneration) return

  await vaultStore(VTS_AUTH_TOKEN_SLOT, token)
  audit('vts-bridge', 'token-store', {
    source: 'vts-auth-request',
    tokenPresent: true,
    tokenLength: token.length,
  })

  const ok = await authenticate(token)
  if (generation !== connectGeneration) return
  if (!ok) throw new Error('VTube Studio authentication failed')

  await onAuthenticated(generation)
}

async function onAuthenticated(generation) {
  for (const param of NEXUS_PARAMS) {
    await createParameter(param.id, param.min, param.max, param.defaultValue)
    if (generation !== connectGeneration) return
  }

  const hotkeys = await getHotkeys()
  if (generation !== connectGeneration) return

  hotkeyMap.clear()
  for (const hotkey of hotkeys) {
    const name = String(hotkey?.name ?? '').toLowerCase()
    const hotkeyID = String(hotkey?.hotkeyID ?? '')
    if (name && hotkeyID) hotkeyMap.set(name, hotkeyID)
  }

  const model = await getCurrentModel()
  if (generation !== connectGeneration) return

  setStatus('ready', { modelName: model.modelLoaded ? model.modelName : '' })
  startParameterInjection()
}

function startParameterInjection() {
  clearInjectTimer()
  injectTimer = setInterval(() => {
    if (!authenticated) return

    const input = inputState
    const smooth = smoothedState
    const seconds = performance.now() / 1000

    const gazeRate = input.expressionSlot === 'thinking' ? 0.08 : 0.16
    smooth.gazeX += (input.gazeTarget.x - smooth.gazeX) * gazeRate
    smooth.gazeY += (input.gazeTarget.y - smooth.gazeY) * gazeRate

    const slTarget = input.speechLevel
    smooth.speechLevel += (slTarget - smooth.speechLevel)
      * (slTarget > smooth.speechLevel ? 0.34 : 0.2)
    const mouth = smooth.speechLevel < 0.015 ? 0 : smooth.speechLevel

    let gazeX = smooth.gazeX
    let gazeY = smooth.gazeY
    let angleZ = Math.sin(seconds * 0.95) * 0.65
    const bodyAngleX = Math.sin(seconds * 0.82) * 0.55 + gazeX * 1.9
    let smile = 0
    let cheek = 0
    let brow = 0
    let breath = 0.22 + (Math.sin(seconds * 2.1) + 1) * 0.1

    switch (input.expressionSlot) {
      case 'listening':
        angleZ += Math.sin(seconds * 3.4) * 0.9
        smile += 0.08; breath += 0.06; break
      case 'thinking':
        gazeX *= 0.35; angleZ += Math.sin(seconds * 1.8) * 2.4
        brow -= 0.18; break
      case 'speaking':
        angleZ += Math.sin(seconds * 5.8) * 0.9
        smile += 0.14 + mouth * 0.22; cheek += mouth * 0.06
        breath += 0.08; break
      case 'happy':
        angleZ += 1.8; smile += 0.18; cheek += 0.1; break
      case 'sleepy':
        gazeX *= 0.45; angleZ += Math.sin(seconds * 0.66) * 1.15
        breath -= 0.08; break
      case 'surprised':
        gazeY -= 0.08; brow += 0.15; break
      case 'confused':
        angleZ += Math.sin(seconds * 2.5) * 1.6; brow -= 0.1; break
      case 'embarrassed':
        gazeX *= 0.4; angleZ += 2.4; cheek += 0.22; smile += 0.06; break
      default:
        break
    }

    injectParameters([
      { id: 'NexusMouthOpen', value: mouth * 0.95 },
      { id: 'NexusMouthRound', value: mouth * 0.24 },
      { id: 'NexusMouthNarrow', value: mouth * 0.08 },
      { id: 'NexusSmile', value: smile },
      { id: 'NexusCheek', value: cheek },
      { id: 'NexusBrowForm', value: brow },
      { id: 'NexusBreath', value: breath },
      { id: 'NexusAngleX', value: gazeX * 18 },
      { id: 'NexusAngleY', value: gazeY * -12 },
      { id: 'NexusAngleZ', value: angleZ },
      { id: 'NexusBodyAngleX', value: bodyAngleX },
      { id: 'NexusEyeX', value: gazeX },
      { id: 'NexusEyeY', value: gazeY },
    ]).catch(() => {})

    if (input.expressionSlot !== lastExpressionSlot) {
      lastExpressionSlot = input.expressionSlot
      const hotkeyId = hotkeyMap.get(input.expressionSlot)
        ?? hotkeyMap.get(`nexus_${input.expressionSlot}`)
      if (hotkeyId) triggerHotkey(hotkeyId).catch(() => {})
    }
  }, INJECT_INTERVAL_MS)
}

export function connectVtsBridge({ port }) {
  const nextPort = Number.isInteger(port) ? port : 8001
  if (state !== 'disconnected' && state !== 'error' && currentPort === nextPort) return getStatus()

  connectGeneration += 1
  cleanupConnection('Superseded by a newer VTS connection')
  currentPort = nextPort
  modelName = ''
  setStatus('connecting', { modelName: '', error: '' })

  const generation = connectGeneration
  const wsUrl = `ws://localhost:${currentPort}`
  let ws

  try {
    ws = new WebSocket(wsUrl)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    setStatus('error', { modelName: '', error: message })
    return getStatus()
  }

  socket = ws
  const timeoutId = setTimeout(() => {
    if (generation !== connectGeneration) return
    cleanupConnection('VTube Studio connection timed out')
    setStatus('error', { modelName: '', error: `Connection to ${wsUrl} timed out` })
  }, CONNECT_TIMEOUT_MS)

  ws.on('open', () => {
    clearTimeout(timeoutId)
    if (generation !== connectGeneration) {
      try { ws.close() } catch {}
      return
    }
    void initializeAuth(generation).catch((error) => {
      if (generation !== connectGeneration) return
      const message = error instanceof Error ? error.message : String(error)
      cleanupConnection(message)
      setStatus('error', { modelName: '', error: message })
    })
  })

  ws.on('message', (rawData) => handleMessage(generation, rawData))

  ws.on('error', (error) => {
    if (generation !== connectGeneration) return
    const message = error instanceof Error ? error.message : 'WebSocket connection failed'
    cleanupConnection(message)
    setStatus('error', { modelName: '', error: message })
  })

  ws.on('close', () => {
    clearTimeout(timeoutId)
    if (generation !== connectGeneration) return
    const wasError = state === 'error'
    cleanupConnection('VTube Studio connection closed')
    if (!wasError) setStatus('disconnected', { modelName: '' })
  })

  return getStatus()
}

export function disconnectVtsBridge() {
  connectGeneration += 1
  cleanupConnection('Disconnected')
  setStatus('disconnected', { modelName: '', error: '' })
  return getStatus()
}

export function updateVtsBridgeInput(input) {
  inputState.expressionSlot = expressionSlots.has(input.expressionSlot)
    ? input.expressionSlot
    : 'idle'
  inputState.speechLevel = clamp(Number(input.speechLevel), 0, 1)
  inputState.gazeTarget = {
    x: clamp(Number(input.gazeTarget?.x), -1, 1),
    y: clamp(Number(input.gazeTarget?.y), -1, 1),
  }
  inputState.isSpeaking = input.isSpeaking === true
  inputState.isListening = input.isListening === true
  return getStatus()
}

export async function migrateLegacyVtsAuthToken(token) {
  const value = String(token ?? '')
  await vaultStore(VTS_AUTH_TOKEN_SLOT, value)
  audit('vts-bridge', 'legacy-token-migration', {
    tokenPresent: value.length > 0,
    tokenLength: value.length,
    fixedSlot: true,
  })
}

export function getVtsBridgeStatus() {
  return getStatus()
}

export function onVtsBridgeStatus(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function shutdownVtsBridge() {
  disconnectVtsBridge()
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}
