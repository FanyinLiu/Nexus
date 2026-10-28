import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { before, test } from 'node:test'

import { NET_IPC_ERROR_CODES } from '../shared/netErrorCodes.js'
import {
  SPEECH_IPC_ERROR_CODES,
  extractSpeechIpcErrorCode,
} from '../shared/speechErrorCodes.js'
import { humanizeError, humanizeIfSpeechIpcError } from '../src/lib/humanizeError.ts'
import { getSpeechOutputErrorMessage } from '../src/hooks/chat/support.ts'
import { enMessages } from '../src/i18n/locales/en/index.ts'
import { ensureLocaleLoaded, setLocale } from '../src/i18n/runtime.ts'

before(async () => {
  await ensureLocaleLoaded('en-US')
  setLocale('en-US')
})

test('speech IPC timeout tokens survive Electron-style message wrapping', () => {
  const wrapped = `Error invoking remote method 'audio:synthesize': Error: ${SPEECH_IPC_ERROR_CODES.TTS_TIMEOUT}`
  assert.equal(extractSpeechIpcErrorCode(wrapped), SPEECH_IPC_ERROR_CODES.TTS_TIMEOUT)
  assert.equal(
    extractSpeechIpcErrorCode(`没能连上语音识别接口，看看地址和网络对不对？具体原因：${SPEECH_IPC_ERROR_CODES.STT_TIMEOUT}`),
    SPEECH_IPC_ERROR_CODES.STT_TIMEOUT,
  )
})

test('humanizeError maps speech timeout codes instead of leaking the token', () => {
  const tts = humanizeError(new Error(SPEECH_IPC_ERROR_CODES.TTS_TIMEOUT), 'tts')
  assert.match(tts, /(too long|faster|try)/i)
  assert.doesNotMatch(tts, /NEXUS_ERR_TTS_TIMEOUT/)
  assert.doesNotMatch(tts, /Something went wrong/)

  const stt = humanizeError(new Error(SPEECH_IPC_ERROR_CODES.STT_TIMEOUT), 'stt')
  assert.match(stt, /(too long|faster|try)/i)
  assert.doesNotMatch(stt, /NEXUS_ERR_STT_TIMEOUT/)
})

test('humanizeIfSpeechIpcError ignores non-coded speech copy', () => {
  assert.equal(humanizeIfSpeechIpcError(new Error('MiniMax 语音接口没有返回可播放音频。'), 'tts'), null)
  assert.match(
    humanizeIfSpeechIpcError(new Error(SPEECH_IPC_ERROR_CODES.TTS_TIMEOUT), 'tts') ?? '',
    /(too long|faster|try)/i,
  )
})

test('getSpeechOutputErrorMessage humanizes coded timeouts and maps other copy to playback', () => {
  assert.match(
    getSpeechOutputErrorMessage(new Error(SPEECH_IPC_ERROR_CODES.TTS_TIMEOUT)),
    /(too long|faster|try)/i,
  )
  assert.equal(
    getSpeechOutputErrorMessage(new Error('请先填写语音输出 API Base URL。')),
    enMessages['voice.error.playback'],
  )
})

test('default net timeout code maps to timeout advice', () => {
  const out = humanizeError(new Error(NET_IPC_ERROR_CODES.TIMEOUT))
  assert.match(out, /(too long|faster|try)/i)
  assert.doesNotMatch(out, /NEXUS_ERR_NET_TIMEOUT/)
})

test('TTS/STT IPC paths pass the shared timeout codes as timeoutMessage', () => {
  const ttsHelpers = readFileSync(new URL('../electron/services/ttsHelpers.js', import.meta.url), 'utf8')
  const audioIpc = readFileSync(new URL('../electron/ipc/audioIpc.js', import.meta.url), 'utf8')
  const sttService = readFileSync(new URL('../electron/services/sttService.js', import.meta.url), 'utf8')
  const netSource = readFileSync(new URL('../electron/net.js', import.meta.url), 'utf8')

  assert.match(ttsHelpers, /return SPEECH_IPC_ERROR_CODES\.TTS_TIMEOUT/)
  assert.match(audioIpc, /timeoutMessage:\s*SPEECH_IPC_ERROR_CODES\.TTS_TIMEOUT/)
  assert.match(audioIpc, /timeoutMessage:\s*SPEECH_IPC_ERROR_CODES\.STT_TIMEOUT/)
  assert.match(sttService, /timeoutMessage:\s*SPEECH_IPC_ERROR_CODES\.STT_TIMEOUT/)
  assert.match(netSource, /timeoutMessage = NET_IPC_ERROR_CODES\.TIMEOUT/)

  const edgeTts = readFileSync(new URL('../electron/services/edgeTts.js', import.meta.url), 'utf8')
  const tencentAsr = readFileSync(new URL('../electron/services/tencentAsr.js', import.meta.url), 'utf8')
  assert.match(edgeTts, /reject\(new Error\(SPEECH_IPC_ERROR_CODES\.TTS_TIMEOUT\)\)/)
  assert.match(tencentAsr, /reject\(new Error\(SPEECH_IPC_ERROR_CODES\.STT_TIMEOUT\)\)/)
})
