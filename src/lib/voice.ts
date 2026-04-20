import { t } from '../i18n/runtime.ts'

export interface BrowserSpeechRecognitionAlternative {
  transcript: string
  confidence: number
}

export interface BrowserSpeechRecognitionResult {
  isFinal: boolean
  length: number
  [index: number]: BrowserSpeechRecognitionAlternative
}

export interface BrowserSpeechRecognitionResultList {
  length: number
  [index: number]: BrowserSpeechRecognitionResult
}

export interface BrowserSpeechRecognitionEvent extends Event {
  resultIndex: number
  results: BrowserSpeechRecognitionResultList
}

export interface BrowserSpeechRecognitionErrorEvent extends Event {
  error: string
  message?: string
}

export interface BrowserSpeechRecognition {
  continuous: boolean
  interimResults: boolean
  lang: string
  maxAlternatives?: number
  onstart: ((event: Event) => void) | null
  onend: ((event: Event) => void) | null
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

export interface BrowserSpeechRecognitionCtor {
  new (): BrowserSpeechRecognition
}

declare global {
  interface Window {
    SpeechRecognition?: BrowserSpeechRecognitionCtor
    webkitSpeechRecognition?: BrowserSpeechRecognitionCtor
  }
}

const BROWSER_SPEECH_START_DELAY_MS = 32
let browserSpeechRequestId = 0

export function getSpeechRecognitionCtor() {
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null
}

export function isBrowserSpeechRecognitionSupported() {
  return Boolean(getSpeechRecognitionCtor())
}

function findMatchingVoice(lang: string) {
  const voices = window.speechSynthesis.getVoices()
  const normalized = lang.toLowerCase()

  return voices.find((voice) => voice.lang.toLowerCase() === normalized)
    ?? voices.find((voice) => voice.lang.toLowerCase().startsWith(normalized.split('-')[0]))
    ?? null
}

function findVoiceById(voiceId?: string) {
  const normalized = String(voiceId ?? '').trim()
  if (!normalized) return null

  const voices = window.speechSynthesis.getVoices()
  return voices.find((voice) => voice.voiceURI === normalized || voice.name === normalized) ?? null
}

export function getAvailableSpeechSynthesisVoices() {
  if (!('speechSynthesis' in window)) return []

  return window.speechSynthesis.getVoices().map((voice) => ({
    id: voice.voiceURI,
    name: voice.name,
    lang: voice.lang,
    localService: voice.localService,
    default: voice.default,
  }))
}

type SpeakTextOptions = {
  text: string
  lang: string
  rate: number
  pitch: number
  volume: number
  voiceId?: string
  onStart?: () => void
  onEnd?: () => void
  onError?: (message: string) => void
}

export function stopSpeaking() {
  if (!('speechSynthesis' in window)) return
  browserSpeechRequestId += 1
  window.speechSynthesis.cancel()
}

export function speakText({
  text,
  lang,
  rate,
  pitch,
  volume,
  voiceId,
  onStart,
  onEnd,
  onError,
}: SpeakTextOptions) {
  if (!('speechSynthesis' in window)) {
    onError?.(t('voice.tts.browser_unsupported'))
    return null
  }

  const content = text.trim()
  if (!content) return null

  stopSpeaking()
  const requestId = browserSpeechRequestId

  const utterance = new SpeechSynthesisUtterance(content)
  utterance.lang = lang
  utterance.rate = rate
  utterance.pitch = pitch
  utterance.volume = volume

  const matchedVoice = findVoiceById(voiceId) ?? findMatchingVoice(lang)
  if (matchedVoice) {
    utterance.voice = matchedVoice
  }

  utterance.onstart = () => onStart?.()
  utterance.onend = () => onEnd?.()
  utterance.onerror = () => onError?.(t('voice.tts.browser_engine_failed'))

  window.setTimeout(() => {
    if (!('speechSynthesis' in window) || browserSpeechRequestId !== requestId) {
      return
    }

    window.speechSynthesis.resume()
    window.speechSynthesis.speak(utterance)
  }, BROWSER_SPEECH_START_DELAY_MS)

  return utterance
}

export function mapSpeechError(error: string) {
  switch (error) {
    case 'not-allowed':
      return '没有拿到麦克风权限，请在系统里允许应用访问麦克风。'
    case 'audio-capture':
      return '没有检测到可用麦克风。'
    case 'network':
      return '语音识别暂时不可用，请稍后再试。'
    case 'no-speech':
      return '这次没有听到你的声音，可以再说一遍。'
    case 'aborted':
      return '语音识别已停止。'
    default:
      return '语音识别失败，请稍后再试。'
  }
}
