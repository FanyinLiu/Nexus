import {
  normalizeBaseUrl,
  normalizeCosyVoiceBaseUrl,
  performNetworkRequest,
  withRequestTimeout,
  readJsonSafe,
  readTextSafe,
  extractResponseErrorMessage,
  buildMultipartBody,
  normalizeLanguageCode,
  audioFormatToMimeType,
} from '../net.js'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import http from 'node:http'

const cosyVoiceAgent = new http.Agent({ keepAlive: false, maxSockets: 2 })
import { app } from 'electron'
import { synthesizeEdgeTts } from './edgeTts.js'

// ── Constants ──

const AUDIO_SYNTH_TIMEOUT_MS = 25_000
const LOCAL_QWEN3_TTS_DEFAULT_BASE_URL = 'http://127.0.0.1:5051/v1'
const LOCAL_QWEN3_TTS_DEFAULT_MODEL = 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice'
const LOCAL_QWEN3_TTS_DEFAULT_VOICE = 'serena'
const LOCAL_QWEN3_TTS_MAX_NEW_TOKENS = 256
const LOCAL_QWEN3_TTS_SUPPORTED_MODELS = new Set([
  'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
  'Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice',
])
const LOCAL_QWEN3_TTS_STREAM_CHUNK_BYTES = 6144
const LOCAL_QWEN3_TTS_HEALTH_TIMEOUT_MS = 1_800
const LOCAL_QWEN3_TTS_STARTUP_TIMEOUT_MS = 45_000
const LOCAL_QWEN3_TTS_SYNTH_TIMEOUT_MS = 90_000
const LOCAL_QWEN3_TTS_SYNTH_TIMEOUT_PER_CHAR_MS = 900
const LOCAL_QWEN3_TTS_SYNTH_TIMEOUT_MAX_MS = 180_000
const VOLCENGINE_TTS_DEFAULT_CLUSTER = 'volcano_tts'
const VOLCENGINE_TTS_DEFAULT_VOICE = 'BV001_streaming'

// ── Module-level mutable state ──

let localQwen3TtsLaunchPromise = null

// ── Provider detection ──

function isLocalQwen3TtsSpeechOutputProvider(providerId) {
  return providerId === 'local-qwen3-tts'
}

function isPiperSpeechOutputProvider(providerId) {
  return providerId === 'piper-tts'
}

function isCoquiSpeechOutputProvider(providerId) {
  return providerId === 'coqui-tts'
}

function isLocalCliSpeechOutputProvider(providerId) {
  return isPiperSpeechOutputProvider(providerId) || isCoquiSpeechOutputProvider(providerId)
}

function isElevenLabsProvider(providerId) {
  return String(providerId ?? '').startsWith('elevenlabs')
}

function isOpenAiCompatibleSpeechInputProvider(providerId) {
  return providerId === 'openai-stt' || providerId === 'custom-openai-stt'
}

function isVolcengineSpeechInputProvider(providerId) {
  return providerId === 'volcengine-stt'
}

function isVolcengineSpeechOutputProvider(providerId) {
  return providerId === 'volcengine-tts'
}

function isOpenAiCompatibleSpeechOutputProvider(providerId) {
  return providerId === 'openai-tts' || providerId === 'custom-openai-tts' || providerId === 'local-qwen3-tts'
}

function isMiniMaxSpeechOutputProvider(providerId) {
  return providerId === 'minimax-tts'
}

function isDashScopeSpeechOutputProvider(providerId) {
  return providerId === 'dashscope-tts'
}

function isCosyVoiceSpeechOutputProvider(providerId) {
  return providerId === 'cosyvoice-tts'
}

function isEdgeTtsSpeechOutputProvider(providerId) {
  return providerId === 'edge-tts'
}

// ── URL / timeout resolution ──

function resolveLocalSpeechCommand(providerId, baseUrl) {
  const normalized = normalizeBaseUrl(baseUrl)
  if (normalized) {
    return normalized
  }

  if (isPiperSpeechOutputProvider(providerId)) {
    return 'piper'
  }

  if (isCoquiSpeechOutputProvider(providerId)) {
    return 'tts'
  }

  return ''
}

function resolveSpeechOutputBaseUrl(providerId, baseUrl) {
  const normalized = normalizeBaseUrl(baseUrl)

  if (isCosyVoiceSpeechOutputProvider(providerId)) {
    return normalizeCosyVoiceBaseUrl(normalized || 'http://127.0.0.1:50000')
  }

  if (isLocalQwen3TtsSpeechOutputProvider(providerId)) {
    return normalized || LOCAL_QWEN3_TTS_DEFAULT_BASE_URL
  }

  return normalized
}

function resolveSpeechOutputTimeoutMs(providerId, text = '', model = '') {
  if (!isLocalQwen3TtsSpeechOutputProvider(providerId)) {
    return AUDIO_SYNTH_TIMEOUT_MS
  }

  const normalizedText = String(text ?? '').trim()
  const normalizedModel = String(model ?? '').trim().toLowerCase()
  const isLargerLocalQwenModel = normalizedModel.includes('1.7b')
  const baseTimeout = isLargerLocalQwenModel
    ? LOCAL_QWEN3_TTS_SYNTH_TIMEOUT_MS + 30_000
    : LOCAL_QWEN3_TTS_SYNTH_TIMEOUT_MS
  const estimatedTimeout = baseTimeout + normalizedText.length * LOCAL_QWEN3_TTS_SYNTH_TIMEOUT_PER_CHAR_MS

  return Math.min(LOCAL_QWEN3_TTS_SYNTH_TIMEOUT_MAX_MS, estimatedTimeout)
}

function resolveSpeechOutputTimeoutMessage(providerId) {
  if (isLocalQwen3TtsSpeechOutputProvider(providerId)) {
    return '本地 Qwen3-TTS 响应超时。当前本地模型生成会比云端慢一些，请稍后重试，或缩短单次播报文本。'
  }

  if (isLocalCliSpeechOutputProvider(providerId)) {
    return '本地命令行 TTS 响应超时，请确认 Piper / Coqui 已正确安装，模型路径可访问，并且命令可以在当前环境里运行。'
  }

  return '语音播报响应超时，请检查网络、代理或当前语音服务状态。'
}

// ── Helpers ──

function parseOptionalSpeakerId(value) {
  const normalized = String(value ?? '').trim()
  if (!normalized) {
    return null
  }

  const parsed = Number.parseInt(normalized, 10)
  return Number.isFinite(parsed) ? parsed : null
}

async function createTempSpeechOutputFilePath(prefix) {
  const tempDir = path.join(app.getPath('temp'), 'nexus-tts')
  await fs.mkdir(tempDir, { recursive: true })
  return path.join(tempDir, `${prefix}-${randomUUID()}.wav`)
}

async function runLocalSpeechCommand({
  providerLabel,
  command,
  args,
  inputText,
  timeoutMs,
  timeoutMessage,
}) {
  return new Promise((resolve, reject) => {
    let settled = false
    let stderr = ''
    let timeoutHandle = null

    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ['pipe', 'ignore', 'pipe'],
    })

    const finish = (handler, value) => {
      if (settled) {
        return
      }

      settled = true
      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
      }
      handler(value)
    }

    timeoutHandle = setTimeout(() => {
      child.kill()
      finish(reject, new Error(timeoutMessage))
    }, timeoutMs)

    child.stderr?.setEncoding?.('utf8')
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk ?? '')
    })

    child.on('error', (error) => {
      const reason = error instanceof Error ? error.message : String(error)
      finish(reject, new Error(`${providerLabel} command failed to start. ${reason}`))
    })

    child.on('close', (code) => {
      if (code === 0) {
        finish(resolve, undefined)
        return
      }

      const detail = stderr.trim() || `${providerLabel} exited with code ${code ?? 'unknown'}.`
      finish(reject, new Error(detail))
    })

    if (typeof inputText === 'string') {
      child.stdin.write(inputText)
    }
    child.stdin.end()
  })
}

// ── Local CLI synthesizers ──

async function synthesizePiperSpeechOutput(payload, content, timeoutMs, timeoutMessage) {
  const command = resolveLocalSpeechCommand(payload.providerId, payload.baseUrl)
  const modelPath = String(payload.model ?? '').trim()
  if (!modelPath) {
    throw new Error('Piper TTS requires a model path (`.onnx`).')
  }

  const outputFilePath = await createTempSpeechOutputFilePath('piper')
  const args = [
    '--model',
    modelPath,
    '--output_file',
    outputFilePath,
  ]

  const speakerId = parseOptionalSpeakerId(payload.voice)
  if (speakerId !== null) {
    args.push('--speaker', String(speakerId))
  }

  try {
    await runLocalSpeechCommand({
      providerLabel: 'Piper',
      command,
      args,
      inputText: content,
      timeoutMs,
      timeoutMessage,
    })

    const audioBuffer = await fs.readFile(outputFilePath)
    return {
      audioBase64: audioBuffer.toString('base64'),
      mimeType: 'audio/wav',
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`Piper synthesis failed. ${reason}`)
  } finally {
    await fs.rm(outputFilePath, { force: true }).catch(() => undefined)
  }
}

async function synthesizeCoquiSpeechOutput(payload, content, timeoutMs, timeoutMessage) {
  const command = resolveLocalSpeechCommand(payload.providerId, payload.baseUrl)
  const modelName = String(payload.model ?? '').trim()
  if (!modelName) {
    throw new Error('Coqui TTS requires a `model_name`.')
  }

  const outputFilePath = await createTempSpeechOutputFilePath('coqui')
  const args = [
    '--text',
    content,
    '--model_name',
    modelName,
    '--out_path',
    outputFilePath,
  ]

  const speakerValue = String(payload.voice ?? '').trim()
  if (speakerValue) {
    args.push('--speaker_idx', speakerValue)
  }

  const languageValue = String(payload.language ?? '').trim()
  if (languageValue) {
    args.push('--language_idx', languageValue)
  }

  try {
    await runLocalSpeechCommand({
      providerLabel: 'Coqui TTS',
      command,
      args,
      timeoutMs,
      timeoutMessage,
    })

    const audioBuffer = await fs.readFile(outputFilePath)
    return {
      audioBase64: audioBuffer.toString('base64'),
      mimeType: 'audio/wav',
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`Coqui synthesis failed. ${reason}`)
  } finally {
    await fs.rm(outputFilePath, { force: true }).catch(() => undefined)
  }
}

// ── Qwen3-TTS model helpers ──

function normalizeLocalQwen3TtsModel(model) {
  const normalized = String(model ?? '').trim()
  return LOCAL_QWEN3_TTS_SUPPORTED_MODELS.has(normalized)
    ? normalized
    : LOCAL_QWEN3_TTS_DEFAULT_MODEL
}

function mapLanguageToLocalQwen3TtsLanguage(language) {
  switch (normalizeLanguageCode(language)) {
    case 'zh':
    case 'yue':
      return 'chinese'
    case 'en':
      return 'english'
    case 'de':
      return 'german'
    case 'fr':
      return 'french'
    case 'it':
      return 'italian'
    case 'ja':
      return 'japanese'
    case 'ko':
      return 'korean'
    case 'pt':
      return 'portuguese'
    case 'ru':
      return 'russian'
    case 'es':
      return 'spanish'
    default:
      return 'auto'
  }
}

function buildOpenAiCompatibleSpeechRequestPayload(payload, content, options = {}) {
  const isLocalQwen3Tts = isLocalQwen3TtsSpeechOutputProvider(payload.providerId)
  const responseFormat = String(options.responseFormat ?? '').trim()
  const localQwenLanguage = isLocalQwen3Tts ? mapLanguageToLocalQwen3TtsLanguage(payload.language) : ''

  // OpenAI speed: 0.25-4.0 (Nexus rate is 0.5-2.0, direct map)
  const speed = Number.isFinite(payload.rate) ? Math.min(Math.max(payload.rate, 0.25), 4.0) : undefined

  return {
    model: isLocalQwen3Tts
      ? normalizeLocalQwen3TtsModel(payload.model)
      : payload.model || 'gpt-4o-mini-tts',
    voice: String(payload.voice ?? '').trim() || (isLocalQwen3Tts ? LOCAL_QWEN3_TTS_DEFAULT_VOICE : 'alloy'),
    input: content,
    ...(speed != null ? { speed } : {}),
    ...(responseFormat ? { response_format: responseFormat } : {}),
    ...(payload.instructions?.trim() ? { instructions: payload.instructions.trim() } : {}),
    ...(isLocalQwen3Tts
      ? {
          language: localQwenLanguage,
          max_new_tokens: LOCAL_QWEN3_TTS_MAX_NEW_TOKENS,
        }
      : {}),
    ...(isLocalQwen3Tts && options.stream
      ? {
          stream: true,
          chunk_bytes: LOCAL_QWEN3_TTS_STREAM_CHUNK_BYTES,
        }
      : {}),
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

// ── Local Qwen3-TTS service lifecycle ──

async function getLocalQwen3TtsLaunchConfig() {
  const repoRoot = path.resolve(__dirname, '..')
  const isWin = process.platform === 'win32'
  const pythonExe = path.join(repoRoot, '.venv-qwen3tts', isWin ? 'Scripts' : 'bin', isWin ? 'python.exe' : 'python')
  const serverScript = path.join(repoRoot, 'scripts', 'qwen3_tts_server.py')
  const hfHome = path.join(repoRoot, '.hf-home')
  const hubCache = path.join(hfHome, 'hub')

  try {
    await fs.access(pythonExe)
  } catch {
    throw new Error(`没有找到本地 Qwen3-TTS Python 环境：${pythonExe}`)
  }

  try {
    await fs.access(serverScript)
  } catch {
    throw new Error(`没有找到本地 Qwen3-TTS 服务脚本：${serverScript}`)
  }

  return {
    repoRoot,
    pythonExe,
    serverScript,
    hfHome,
    hubCache,
  }
}

async function isLocalQwen3TtsServiceReady(baseUrl) {
  try {
    const healthUrl = new URL('/health', resolveSpeechOutputBaseUrl('local-qwen3-tts', baseUrl)).toString()
    const response = await performNetworkRequest(healthUrl, {
      method: 'GET',
      timeoutMs: LOCAL_QWEN3_TTS_HEALTH_TIMEOUT_MS,
      timeoutMessage: '本地 Qwen3-TTS 健康检查超时。',
    })
    return response.ok
  } catch {
    return false
  }
}

async function waitForLocalQwen3TtsReady(baseUrl, timeoutMs = LOCAL_QWEN3_TTS_STARTUP_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await isLocalQwen3TtsServiceReady(baseUrl)) {
      return true
    }
    await sleep(1_250)
  }

  return false
}

async function ensureLocalQwen3TtsService(baseUrl, model) {
  const resolvedBaseUrl = resolveSpeechOutputBaseUrl('local-qwen3-tts', baseUrl)
  if (await isLocalQwen3TtsServiceReady(resolvedBaseUrl)) {
    return resolvedBaseUrl
  }

  if (!localQwen3TtsLaunchPromise) {
    localQwen3TtsLaunchPromise = (async () => {
      const config = await getLocalQwen3TtsLaunchConfig()
      const parsedBaseUrl = new URL(resolvedBaseUrl)
      const port = Number(parsedBaseUrl.port || 5051)
      const normalizedModel = normalizeLocalQwen3TtsModel(model)

      const child = spawn(
        config.pythonExe,
        [
          config.serverScript,
          '--host',
          parsedBaseUrl.hostname,
          '--port',
          String(port),
          '--preload-model',
          normalizedModel,
        ],
        {
          cwd: config.repoRoot,
          detached: true,
          windowsHide: true,
          stdio: 'ignore',
          env: {
            ...process.env,
            HF_HOME: config.hfHome,
            HUGGINGFACE_HUB_CACHE: config.hubCache,
            TRANSFORMERS_CACHE: config.hubCache,
            HF_HUB_DISABLE_TELEMETRY: '1',
            HF_HUB_DISABLE_SYMLINKS_WARNING: '1',
          },
        },
      )

      child.unref()

      const ready = await waitForLocalQwen3TtsReady(resolvedBaseUrl)
      if (!ready) {
        throw new Error('本地 Qwen3-TTS 服务启动超时，请先手动运行 scripts/start_qwen3_tts_server.bat。')
      }
    })()
      .finally(() => {
        localQwen3TtsLaunchPromise = null
      })
  }

  await localQwen3TtsLaunchPromise
  return resolvedBaseUrl
}

// ── Authorization ──

function buildAuthorizationHeaders(providerId, apiKey) {
  if (!apiKey) return {}

  if (isElevenLabsProvider(providerId)) {
    return {
      'xi-api-key': apiKey,
    }
  }

  if (isVolcengineSpeechOutputProvider(providerId)) {
    const credentials = parseVolcengineSpeechCredentials(apiKey)
    return {
      Authorization: `Bearer;${credentials.accessToken || apiKey}`,
    }
  }

  return {
    Authorization: `Bearer ${apiKey}`,
  }
}

// ── Voice helpers ──

function toSpeechVoiceOption(item) {
  const id = String(
    item?.voice_id
    ?? item?.voiceId
    ?? item?.voice_name
    ?? item?.voiceName
    ?? item?.name
    ?? '',
  ).trim()

  if (!id) return null

  const rawLabel = String(
    item?.voice_name
    ?? item?.voiceName
    ?? item?.name
    ?? id,
  ).trim()

  const description = [
    item?.language,
    item?.accent,
    item?.gender,
    item?.age,
    item?.style,
    item?.emotion,
  ]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .join(' · ')

  return {
    id,
    label: rawLabel,
    ...(description ? { description } : {}),
  }
}

function extractMiniMaxVoiceOptions(data) {
  const sources = [
    ...(Array.isArray(data?.system_voice) ? data.system_voice : []),
    ...(Array.isArray(data?.voice_cloning) ? data.voice_cloning : []),
    ...(Array.isArray(data?.voice_generation) ? data.voice_generation : []),
    ...(Array.isArray(data?.voice_list) ? data.voice_list : []),
    ...(Array.isArray(data?.data?.system_voice) ? data.data.system_voice : []),
    ...(Array.isArray(data?.data?.voice_cloning) ? data.data.voice_cloning : []),
    ...(Array.isArray(data?.data?.voice_generation) ? data.data.voice_generation : []),
    ...(Array.isArray(data?.data?.voice_list) ? data.data.voice_list : []),
    ...(Array.isArray(data?.data?.voices) ? data.data.voices : []),
    ...(Array.isArray(data?.voices) ? data.voices : []),
  ]

  const seen = new Set()
  const voices = []

  for (const item of sources) {
    const mapped = toSpeechVoiceOption(item)
    if (!mapped || seen.has(mapped.id)) continue
    seen.add(mapped.id)
    voices.push(mapped)
  }

  return voices.sort((left, right) => left.label.localeCompare(right.label, 'zh-Hans-CN', {
    sensitivity: 'base',
  }))
}

// ── Volcengine TTS ──

function parseVolcengineSpeechCredentials(apiKey) {
  const raw = String(apiKey ?? '').trim()
  if (!raw) {
    return {
      appId: '',
      accessToken: '',
    }
  }

  const directMatch = raw.match(/^\s*([0-9]{6,})\s*[:|：]\s*(.+?)\s*$/s)
  if (directMatch) {
    return {
      appId: String(directMatch[1] ?? '').trim(),
      accessToken: String(directMatch[2] ?? '').trim(),
    }
  }

  const appIdMatch = raw.match(/(?:app[\s_-]*id|appid)\s*[:：=]\s*([0-9]{6,})/i)
  const accessTokenMatch = raw.match(/(?:access[\s_-]*token|token)\s*[:：=]\s*([A-Za-z0-9._\-+/=]+)/i)
  if (appIdMatch || accessTokenMatch) {
    return {
      appId: String(appIdMatch?.[1] ?? '').trim(),
      accessToken: String(accessTokenMatch?.[1] ?? '').trim(),
    }
  }

  const separator = raw.includes(':') ? ':' : raw.includes('|') ? '|' : ''
  if (!separator) {
    return {
      appId: '',
      accessToken: raw,
    }
  }

  const [appId, ...tokenParts] = raw.split(separator)
  return {
    appId: String(appId ?? '').trim(),
    accessToken: tokenParts.join(separator).trim(),
  }
}

function normalizeVolcengineSpeechOutputCluster(cluster) {
  return String(cluster ?? '').trim() || VOLCENGINE_TTS_DEFAULT_CLUSTER
}

function normalizeVolcengineSpeechOutputVoice(voice) {
  return String(voice ?? '').trim() || VOLCENGINE_TTS_DEFAULT_VOICE
}

function formatVolcengineSpeechOutputCombo(cluster, voice) {
  return `${normalizeVolcengineSpeechOutputCluster(cluster)} + ${normalizeVolcengineSpeechOutputVoice(voice)}`
}

function isVolcengineSpeechOutputAuthErrorMessage(message) {
  const normalizedMessage = String(message ?? '').trim().toLowerCase()

  return (
    normalizedMessage.includes('requested grant not found')
    || normalizedMessage.includes('authenticate request')
    || normalizedMessage.includes('invalid token')
  )
}

function isVolcengineSpeechOutputGrantErrorMessage(message) {
  const normalizedMessage = String(message ?? '').trim().toLowerCase()

  return (
    normalizedMessage.includes('requested resource not granted')
    || normalizedMessage.includes('resource not granted')
    || normalizedMessage.includes('requested resource')
    || normalizedMessage.includes('access denied')
  )
}

function isVolcengineSpeechOutputInitErrorMessage(message) {
  const normalizedMessage = String(message ?? '').trim().toLowerCase()

  return (
    normalizedMessage.includes('init engine instance failed')
    || normalizedMessage.includes('voice_type')
    || normalizedMessage.includes('cluster')
  )
}

function getVolcengineSpeechOutputErrorDetails(data, fallbackMessage) {
  const code = String(data?.code ?? '').trim()
  const rawMessage = String(data?.message ?? data?.msg ?? '').trim()

  if (isVolcengineSpeechOutputAuthErrorMessage(rawMessage)) {
    return {
      code,
      rawMessage,
      isAuthError: true,
      isGrantError: false,
      isInitError: false,
      message: '火山语音鉴权失败，请确认 API Key 填的是 APP_ID:ACCESS_TOKEN，并且当前账号已开通豆包语音服务。',
    }
  }

  if (isVolcengineSpeechOutputGrantErrorMessage(rawMessage)) {
    return {
      code,
      rawMessage,
      isAuthError: false,
      isGrantError: true,
      isInitError: false,
      message: '当前火山音色还没授权到你的账号，请先在控制台服务页为这个音色下单/授权；如果只是想先能播报，建议改回 BV001_streaming 或 BV002_streaming。',
    }
  }

  if (isVolcengineSpeechOutputInitErrorMessage(rawMessage)) {
    return {
      code,
      rawMessage,
      isAuthError: false,
      isGrantError: false,
      isInitError: true,
      message: '火山语音初始化失败，请检查业务集群和音色是否匹配，建议先用 volcano_tts + BV001_streaming。',
    }
  }

  if (rawMessage) {
    return {
      code,
      rawMessage,
      isAuthError: false,
      isGrantError: false,
      isInitError: false,
      message: code ? `火山语音合成失败（${code}）：${rawMessage}` : rawMessage,
    }
  }

  return {
    code,
    rawMessage,
    isAuthError: false,
    isGrantError: false,
    isInitError: false,
    message: code
      ? `火山语音合成接口返回异常状态：${code}`
      : fallbackMessage,
  }
}

function buildVolcengineSpeechOutputRequestBody({
  credentials,
  cluster,
  voice,
  text,
  rate = 1,
  volume = 1,
  pitch = 1,
}) {
  return JSON.stringify({
    app: {
      appid: credentials.appId,
      token: credentials.accessToken,
      cluster: normalizeVolcengineSpeechOutputCluster(cluster),
    },
    user: {
      uid: credentials.appId || 'nexus',
    },
    audio: {
      voice_type: normalizeVolcengineSpeechOutputVoice(voice),
      encoding: 'wav',
      speed_ratio: Number(Math.min(Math.max(rate, 0.2), 3).toFixed(2)),
      volume_ratio: Number(Math.min(Math.max(volume, 0.1), 3).toFixed(2)),
      pitch_ratio: Number(Math.min(Math.max(pitch, 0.1), 3).toFixed(2)),
      rate: 24000,
    },
    request: {
      reqid: randomUUID(),
      text: String(text ?? ''),
      text_type: 'plain',
      operation: 'query',
      with_frontend: 1,
      frontend_type: 'unitTson',
    },
  })
}

function buildVolcengineSpeechOutputAttemptPlan({ cluster, voice }) {
  const initialCluster = normalizeVolcengineSpeechOutputCluster(cluster)
  const initialVoice = normalizeVolcengineSpeechOutputVoice(voice)
  const candidates = [
    {
      cluster: initialCluster,
      voice: initialVoice,
      reason: '当前设置',
    },
    {
      cluster: initialCluster,
      voice: VOLCENGINE_TTS_DEFAULT_VOICE,
      reason: '当前集群 + 通用女声',
    },
    {
      cluster: VOLCENGINE_TTS_DEFAULT_CLUSTER,
      voice: VOLCENGINE_TTS_DEFAULT_VOICE,
      reason: '默认集群 + 通用女声',
    },
    {
      cluster: VOLCENGINE_TTS_DEFAULT_CLUSTER,
      voice: 'BV002_streaming',
      reason: '默认集群 + 通用男声',
    },
  ]
  const seen = new Set()

  return candidates.filter((candidate) => {
    const key = `${candidate.cluster}::${candidate.voice}`
    if (seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
}

function summarizeVolcengineSpeechOutputAttempts(attempts) {
  return attempts.map((attempt) => formatVolcengineSpeechOutputCombo(attempt.cluster, attempt.voice))
}

function buildVolcengineSpeechOutputFailureMessage(attempts, fallbackMessage) {
  const prefix = fallbackMessage && !isVolcengineSpeechOutputInitErrorMessage(fallbackMessage)
    ? fallbackMessage
    : '火山语音初始化失败。'
  const retriedMessage = attempts.length > 1
    ? ' 已自动尝试兼容组合，但仍然失败。'
    : ' 这次请求仍然失败。'

  return `${prefix}${retriedMessage}请确认业务集群和音色匹配；想先稳定播报，建议先改成 volcano_tts + BV001_streaming。`
}

function buildVolcengineSpeechOutputGrantFailureMessage(attempts) {
  const retriedMessage = attempts.length > 1
    ? '已自动尝试兼容音色，但仍然失败。'
    : '当前音色仍然不可用。'

  return `当前火山音色还没授权到你的账号，${retriedMessage}请到火山控制台语音服务页为目标音色做 0 元下单或授权；如果只是想先稳定播报，建议直接用 BV001_streaming 或 BV002_streaming。`
}

async function performVolcengineSpeechOutputAttempt({
  baseUrl,
  apiKey,
  credentials,
  cluster,
  voice,
  text,
  rate = 1,
  volume = 1,
  pitch = 1,
  timeoutMs = AUDIO_SYNTH_TIMEOUT_MS,
  timeoutMessage = '语音播报响应超时，请检查网络、代理或当前语音服务状态。',
}) {
  const response = await performNetworkRequest(`${baseUrl}/v1/tts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...buildAuthorizationHeaders('volcengine-tts', apiKey),
    },
    body: buildVolcengineSpeechOutputRequestBody({
      credentials,
      cluster,
      voice,
      text,
      rate,
      volume,
      pitch,
    }),
    timeoutMs,
    timeoutMessage,
  })
  const contentType = response.headers.get('content-type') ?? ''
  let data = null
  let responseText = ''

  if (contentType.includes('application/json')) {
    data = await readJsonSafe(response)
  } else {
    responseText = await readTextSafe(response)
    try {
      data = JSON.parse(responseText)
    } catch {
      data = null
    }
  }

  if (!response.ok) {
    const details = data
      ? getVolcengineSpeechOutputErrorDetails(
        data,
        `火山语音播报请求失败（状态码：${response.status}）`,
      )
      : null
    const errorMessage =
      details?.message
      || responseText.trim()
      || `火山语音播报请求失败（状态码：${response.status}）`
    const rawMessage = details?.rawMessage || responseText

    return {
      ok: false,
      cluster: normalizeVolcengineSpeechOutputCluster(cluster),
      voice: normalizeVolcengineSpeechOutputVoice(voice),
      responseStatus: response.status,
      data,
      errorMessage,
      rawMessage,
      isGrantError:
        details?.isGrantError
        || isVolcengineSpeechOutputGrantErrorMessage(rawMessage)
        || isVolcengineSpeechOutputGrantErrorMessage(errorMessage),
      isInitError:
        details?.isInitError
        || isVolcengineSpeechOutputInitErrorMessage(rawMessage)
        || isVolcengineSpeechOutputInitErrorMessage(errorMessage),
    }
  }

  const volcengineData = data ?? {}
  if (Number(volcengineData?.code ?? 0) !== 3000) {
    const details = getVolcengineSpeechOutputErrorDetails(
      volcengineData,
      '火山语音接口返回了异常状态。',
    )

    return {
      ok: false,
      cluster: normalizeVolcengineSpeechOutputCluster(cluster),
      voice: normalizeVolcengineSpeechOutputVoice(voice),
      responseStatus: response.status,
      data: volcengineData,
      errorMessage: details.message,
      rawMessage: details.rawMessage,
      isGrantError: details.isGrantError,
      isInitError: details.isInitError,
    }
  }

  const audioBase64 = String(volcengineData?.data ?? '').trim()
  if (!audioBase64) {
    return {
      ok: false,
      cluster: normalizeVolcengineSpeechOutputCluster(cluster),
      voice: normalizeVolcengineSpeechOutputVoice(voice),
      responseStatus: response.status,
      data: volcengineData,
      errorMessage: '火山语音接口没有返回可播放音频。',
      rawMessage: '',
      isGrantError: false,
      isInitError: false,
    }
  }

  return {
    ok: true,
    cluster: normalizeVolcengineSpeechOutputCluster(cluster),
    voice: normalizeVolcengineSpeechOutputVoice(voice),
    responseStatus: response.status,
    data: volcengineData,
    audioBase64,
    mimeType: audioFormatToMimeType(volcengineData?.addition?.audio_format ?? 'mp3'),
  }
}

async function synthesizeVolcengineSpeechOutputWithFallback(options) {
  const attempts = buildVolcengineSpeechOutputAttemptPlan(options)
  let lastFailure = null

  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index]
    const result = await performVolcengineSpeechOutputAttempt({
      ...options,
      cluster: attempt.cluster,
      voice: attempt.voice,
    })

    if (result.ok) {
      return {
        ...result,
        usedFallback: index > 0,
        attempts,
        reason: attempt.reason,
      }
    }

    lastFailure = result
    if (!result.isInitError && !result.isGrantError) {
      return {
        ...result,
        attempts,
      }
    }
  }

  console.warn('[Volcengine TTS] all fallback attempts failed', {
    attempts: summarizeVolcengineSpeechOutputAttempts(attempts),
    finalError: lastFailure?.errorMessage ?? '火山语音初始化失败。',
    finalRawMessage: lastFailure?.rawMessage ?? '',
  })

  return {
    ...(lastFailure ?? {
      ok: false,
      cluster: normalizeVolcengineSpeechOutputCluster(options.cluster),
      voice: normalizeVolcengineSpeechOutputVoice(options.voice),
      errorMessage: '火山语音初始化失败。',
      rawMessage: '',
      isGrantError: false,
      isInitError: true,
    }),
    attempts,
    errorMessage: lastFailure?.isGrantError
      ? buildVolcengineSpeechOutputGrantFailureMessage(attempts)
      : buildVolcengineSpeechOutputFailureMessage(
        attempts,
        lastFailure?.errorMessage,
      ),
  }
}

// ── Silent WAV ──

function createSilentWavBase64(durationMs = 450, sampleRate = 16000) {
  const channelCount = 1
  const bitsPerSample = 16
  const bytesPerSample = bitsPerSample / 8
  const sampleCount = Math.max(1, Math.round(sampleRate * durationMs / 1000))
  const dataSize = sampleCount * channelCount * bytesPerSample
  const buffer = Buffer.alloc(44 + dataSize)

  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(channelCount, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * channelCount * bytesPerSample, 28)
  buffer.writeUInt16LE(channelCount * bytesPerSample, 32)
  buffer.writeUInt16LE(bitsPerSample, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)

  return buffer.toString('base64')
}

// ── Language mapping ──

function mapLanguageToMiniMaxBoost(language) {
  switch (normalizeLanguageCode(language)) {
    case 'zh':
      return 'Chinese'
    case 'yue':
      return 'Cantonese'
    case 'en':
      return 'English'
    case 'ja':
      return 'Japanese'
    case 'ko':
      return 'Korean'
    default:
      return 'auto'
  }
}

function mapLanguageToDashScopeType(language) {
  switch (normalizeLanguageCode(language)) {
    case 'zh':
      return 'Chinese'
    case 'en':
      return 'English'
    case 'de':
      return 'German'
    case 'fr':
      return 'French'
    case 'ru':
      return 'Russian'
    case 'it':
      return 'Italian'
    case 'es':
      return 'Spanish'
    case 'pt':
      return 'Portuguese'
    case 'ja':
      return 'Japanese'
    case 'ko':
      return 'Korean'
    default:
      return 'Auto'
  }
}

// ── Main synthesizer ──

/**
 * Synthesize text via a remote TTS API provider, returning PCM-decodable audio.
 * Used by the streaming TTS service to convert each text chunk into audio.
 * For OpenAI-compatible providers, requests raw PCM (int16 24kHz) for lower latency.
 * For others, returns the standard audioBase64/mimeType result.
 *
 * @param {object} sessionPayload - The session payload from tts:stream-start (providerId, baseUrl, apiKey, model, voice, etc.)
 * @param {string} text - The text to synthesize
 * @returns {Promise<{ audioBase64?: string, mimeType?: string, pcmBuffer?: Buffer, pcmSampleRate?: number }>}
 */
async function synthesizeRemoteTts(sessionPayload, text) {
  const payload = { ...sessionPayload, text }
  const content = text.trim()
  if (!content) throw new Error('没有可播报的文本内容。')
  const synthTimeoutMs = resolveSpeechOutputTimeoutMs(payload.providerId, content, payload.model)
  const synthTimeoutMessage = resolveSpeechOutputTimeoutMessage(payload.providerId)

  if (isPiperSpeechOutputProvider(payload.providerId)) {
    return synthesizePiperSpeechOutput(payload, content, synthTimeoutMs, synthTimeoutMessage)
  }

  if (isCoquiSpeechOutputProvider(payload.providerId)) {
    return synthesizeCoquiSpeechOutput(payload, content, synthTimeoutMs, synthTimeoutMessage)
  }

  const baseUrl = isLocalQwen3TtsSpeechOutputProvider(payload.providerId)
    ? await ensureLocalQwen3TtsService(payload.baseUrl, payload.model)
    : resolveSpeechOutputBaseUrl(payload.providerId, payload.baseUrl)
  const rate = Number.isFinite(payload.rate) ? payload.rate : 1
  const pitch = Number.isFinite(payload.pitch) ? payload.pitch : 1
  const volume = Number.isFinite(payload.volume) ? payload.volume : 1

  if (!baseUrl) throw new Error('请先填写语音输出 API Base URL。')

  // ── OpenAI-compatible: request raw PCM for streaming ──
  if (isOpenAiCompatibleSpeechOutputProvider(payload.providerId)) {
    const isLocalQwen3Tts = isLocalQwen3TtsSpeechOutputProvider(payload.providerId)
    const endpoint = `${baseUrl}/audio/speech`
    const requestBody = JSON.stringify(buildOpenAiCompatibleSpeechRequestPayload(
      payload,
      content,
      {
        responseFormat: 'pcm',
        stream: isLocalQwen3Tts,
      },
    ))
    const headers = {
      'Content-Type': 'application/json',
      ...buildAuthorizationHeaders(payload.providerId, payload.apiKey),
    }

    const response = isLocalQwen3Tts
      ? await withRequestTimeout(
          fetch(endpoint, {
            method: 'POST',
            headers,
            body: requestBody,
          }),
          synthTimeoutMs,
          synthTimeoutMessage,
        )
      : await performNetworkRequest(endpoint, {
          method: 'POST',
          headers,
          body: requestBody,
          timeoutMs: synthTimeoutMs,
          timeoutMessage: synthTimeoutMessage,
        })

    if (!response.ok) {
      throw new Error(await extractResponseErrorMessage(response, '语音播报请求失败（状态码：' + response.status + '）'))
    }

    if (isLocalQwen3Tts && response.body) {
      const headerSampleRate = Number.parseInt(response.headers.get('x-audio-sample-rate') ?? '', 10)
      return {
        pcmStream: Readable.fromWeb(response.body),
        pcmSampleRate: Number.isFinite(headerSampleRate) && headerSampleRate > 0 ? headerSampleRate : 24000,
      }
    }

    const pcmBuffer = Buffer.from(await response.arrayBuffer())
    return { pcmBuffer, pcmSampleRate: 24000 }
  }

  // ── ElevenLabs: request pcm_16000 for streaming ──
  if (payload.providerId === 'elevenlabs-tts') {
    if (!payload.voice) throw new Error('请先填写 ElevenLabs 的 voice_id。')

    const endpoint = `${baseUrl}/text-to-speech/${encodeURIComponent(payload.voice)}?output_format=pcm_16000`
    const requestBody = JSON.stringify({
      text: content,
      model_id: payload.model || 'eleven_multilingual_v2',
      ...(normalizeLanguageCode(payload.language) ? { language_code: normalizeLanguageCode(payload.language) } : {}),
    })
    const headers = {
      Accept: 'audio/pcm',
      'Content-Type': 'application/json',
      ...buildAuthorizationHeaders(payload.providerId, payload.apiKey),
    }

    const response = await performNetworkRequest(endpoint, {
      method: 'POST',
      headers,
      body: requestBody,
      timeoutMs: synthTimeoutMs,
      timeoutMessage: synthTimeoutMessage,
    })

    if (!response.ok) {
      throw new Error(await extractResponseErrorMessage(response, '语音播报请求失败（状态码：' + response.status + '）'))
    }

    const pcmBuffer = Buffer.from(await response.arrayBuffer())
    return { pcmBuffer, pcmSampleRate: 16000 }
  }

  // ── Volcengine ──
  if (isVolcengineSpeechOutputProvider(payload.providerId)) {
    const credentials = parseVolcengineSpeechCredentials(payload.apiKey)
    if (!credentials.appId || !credentials.accessToken) {
      throw new Error('火山语音合成请在 API Key 一栏填写 APP_ID:ACCESS_TOKEN。')
    }

    const result = await synthesizeVolcengineSpeechOutputWithFallback({
      baseUrl,
      apiKey: payload.apiKey,
      credentials,
      cluster: payload.model,
      voice: payload.voice,
      text: content,
      rate,
      volume,
      pitch,
      timeoutMs: synthTimeoutMs,
      timeoutMessage: synthTimeoutMessage,
    })

    if (!result.ok) throw new Error(result.errorMessage)
    return { audioBase64: result.audioBase64, mimeType: result.mimeType }
  }

  // ── MiniMax ──
  if (isMiniMaxSpeechOutputProvider(payload.providerId)) {
    const endpoint = `${baseUrl}/t2a_v2`
    const requestBody = JSON.stringify({
      model: payload.model || 'speech-2.8-turbo',
      text: content,
      stream: false,
      voice_setting: {
        voice_id: payload.voice || 'female-shaonv',
        speed: Number(Math.min(Math.max(rate, 0.5), 2).toFixed(1)),
        vol: Math.round(Math.min(Math.max(volume * 10, 1), 10)),
        pitch: Math.round(Math.min(Math.max((pitch - 1) * 12, -12), 12)),
      },
      audio_setting: {
        format: 'wav',
        sample_rate: 24000,
        bitrate: 128000,
        channel: 1,
      },
      language_boost: mapLanguageToMiniMaxBoost(payload.language),
    })
    const headers = {
      'Content-Type': 'application/json',
      ...buildAuthorizationHeaders(payload.providerId, payload.apiKey),
    }

    const response = await performNetworkRequest(endpoint, {
      method: 'POST',
      headers,
      body: requestBody,
      timeoutMs: synthTimeoutMs,
      timeoutMessage: synthTimeoutMessage,
    })

    if (!response.ok) {
      throw new Error(await extractResponseErrorMessage(response, '语音播报请求失败（状态码：' + response.status + '）'))
    }

    const data = await readJsonSafe(response)
    if (Number(data?.base_resp?.status_code ?? 0) !== 0) {
      throw new Error(data?.base_resp?.status_msg ?? data?.message ?? 'MiniMax 语音接口返回了异常状态。')
    }
    const audioHex = String(data?.data?.audio ?? '').trim()
    if (!audioHex) throw new Error('MiniMax 语音接口没有返回可播放音频。')

    return {
      audioBase64: Buffer.from(audioHex, 'hex').toString('base64'),
      mimeType: audioFormatToMimeType(data?.extra_info?.audio_format ?? 'wav'),
    }
  }

  // ── DashScope ──
  if (isDashScopeSpeechOutputProvider(payload.providerId)) {
    const endpoint = `${baseUrl}/services/aigc/multimodal-generation/generation`
    const requestBody = JSON.stringify({
      model: payload.model || 'qwen3-tts-instruct-flash',
      input: {
        text: content,
        voice: payload.voice || 'Cherry',
        language_type: mapLanguageToDashScopeType(payload.language),
      },
    })
    const headers = {
      'Content-Type': 'application/json',
      ...buildAuthorizationHeaders(payload.providerId, payload.apiKey),
    }

    const response = await performNetworkRequest(endpoint, {
      method: 'POST',
      headers,
      body: requestBody,
      timeoutMs: synthTimeoutMs,
      timeoutMessage: synthTimeoutMessage,
    })

    if (!response.ok) {
      throw new Error(await extractResponseErrorMessage(response, '语音播报请求失败（状态码：' + response.status + '）'))
    }

    const data = await readJsonSafe(response)
    const audioUrl = String(data?.output?.audio?.url ?? data?.output?.audio_url ?? '').trim()
    if (!audioUrl) throw new Error('百炼语音接口没有返回音频地址。')

    const audioResponse = await performNetworkRequest(audioUrl, {
      method: 'GET',
      timeoutMs: synthTimeoutMs,
      timeoutMessage: '语音文件下载超时，请检查网络或稍后重试。',
    })

    if (!audioResponse.ok) {
      throw new Error(await extractResponseErrorMessage(audioResponse, '百炼音频下载失败（状态码：' + audioResponse.status + '）'))
    }

    return {
      audioBase64: Buffer.from(await audioResponse.arrayBuffer()).toString('base64'),
      mimeType: audioResponse.headers.get('content-type') ?? 'audio/wav',
    }
  }

  // ── CosyVoice2: collect full PCM response (non-streaming, avoids pipeline settle issues) ──
  if (isCosyVoiceSpeechOutputProvider(payload.providerId)) {
    const rawMode = payload.model || 'sft'
    const mode = (rawMode === 'sft' || rawMode === 'instruct') ? rawMode : 'sft'
    const formBody = new URLSearchParams()
    formBody.append('tts_text', content)
    formBody.append('spk_id', payload.voice || '中文女')
    if (mode === 'instruct') {
      formBody.append('instruct_text', payload.instructions?.trim() || '用自然亲切的语气说')
    }
    const bodyStr = formBody.toString()
    console.log('[CosyVoice] synthesize:', mode, 'voice:', payload.voice || '中文女', 'text:', content.slice(0, 40))

    const url = new URL(`${baseUrl}/inference_${mode}`)
    const pcmBuffer = await new Promise((resolve, reject) => {
      let settled = false
      const settle = (fn, value) => { if (!settled) { settled = true; fn(value) } }

      // Hard wall-clock timeout — covers server hangs after sending headers
      const hardTimeout = setTimeout(() => {
        req.destroy()
        settle(reject, new Error('CosyVoice2 响应超时（硬超时）'))
      }, AUDIO_SYNTH_TIMEOUT_MS + 5_000)

      const req = http.request({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        agent: cosyVoiceAgent,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(bodyStr),
        },
        timeout: AUDIO_SYNTH_TIMEOUT_MS,
      }, (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          clearTimeout(hardTimeout)
          if (res.statusCode !== 200) {
            const body = Buffer.concat(chunks).toString('utf-8').slice(0, 500)
            console.error('[CosyVoice] 合成失败:', res.statusCode, body)
            settle(reject, new Error('CosyVoice2 合成失败（状态码：' + res.statusCode + '）' + body))
            return
          }
          console.log('[CosyVoice] response complete:', Buffer.concat(chunks).length, 'bytes')
          settle(resolve, Buffer.concat(chunks))
        })
        res.on('error', (err) => {
          clearTimeout(hardTimeout)
          settle(reject, new Error('CosyVoice2 音频接收失败：' + (err?.message || '连接中断')))
        })
      })
      req.on('error', (err) => { clearTimeout(hardTimeout); settle(reject, new Error('CosyVoice2 服务连接失败：' + err.message)) })
      req.on('timeout', () => { req.destroy(); clearTimeout(hardTimeout); settle(reject, new Error('CosyVoice2 响应超时')) })
      req.write(bodyStr)
      req.end()
    })

    return { pcmBuffer, pcmSampleRate: 24000 }
  }

  // ── Edge TTS: Microsoft Edge Read Aloud, free, ultra-low latency ──
  if (isEdgeTtsSpeechOutputProvider(payload.providerId)) {
    console.log('[Edge-TTS] synthesize:', content.slice(0, 40), 'voice:', payload.voice || 'zh-CN-XiaoxiaoNeural')
    return synthesizeEdgeTts(content, {
      voice: payload.voice || 'zh-CN-XiaoxiaoNeural',
      rate: Number.isFinite(payload.rate) ? payload.rate : undefined,
      pitch: Number.isFinite(payload.pitch) ? payload.pitch : undefined,
      volume: Number.isFinite(payload.volume) ? payload.volume : undefined,
    })
  }

  throw new Error('当前语音输出提供商暂未接通流式播放。')
}

async function warmupRemoteTtsSession(sessionPayload) {
  if (isLocalQwen3TtsSpeechOutputProvider(sessionPayload?.providerId)) {
    await ensureLocalQwen3TtsService(sessionPayload?.baseUrl, sessionPayload?.model)
  }
}

// ── Exports ──

export {
  synthesizeRemoteTts,
  warmupRemoteTtsSession,
  buildAuthorizationHeaders,
  parseVolcengineSpeechCredentials,
  isLocalQwen3TtsSpeechOutputProvider,
  isPiperSpeechOutputProvider,
  isCoquiSpeechOutputProvider,
  isLocalCliSpeechOutputProvider,
  isElevenLabsProvider,
  isOpenAiCompatibleSpeechOutputProvider,
  isMiniMaxSpeechOutputProvider,
  isDashScopeSpeechOutputProvider,
  isCosyVoiceSpeechOutputProvider,
  isVolcengineSpeechOutputProvider,
  isVolcengineSpeechInputProvider,
  isOpenAiCompatibleSpeechInputProvider,
  resolveSpeechOutputBaseUrl,
  resolveSpeechOutputTimeoutMs,
  resolveSpeechOutputTimeoutMessage,
  ensureLocalQwen3TtsService,
  toSpeechVoiceOption,
  extractMiniMaxVoiceOptions,
  buildOpenAiCompatibleSpeechRequestPayload,
  synthesizePiperSpeechOutput,
  synthesizeCoquiSpeechOutput,
  synthesizeVolcengineSpeechOutputWithFallback,
  formatVolcengineSpeechOutputCombo,
  createSilentWavBase64,
  mapLanguageToMiniMaxBoost,
  mapLanguageToDashScopeType,
}
