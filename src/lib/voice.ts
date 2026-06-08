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

export function getSpeechRecognitionCtor() {
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null
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

export function stopSpeaking() {
  if (!('speechSynthesis' in window)) return
  window.speechSynthesis.cancel()
}

export function mapSpeechError(error: string) {
  switch (error) {
    case 'not-allowed':
      return t('voice.stt.error.permission_denied')
    case 'audio-capture':
      return t('voice.stt.error.no_microphone')
    case 'network':
      return t('voice.stt.error.network')
    case 'no-speech':
      return t('voice.stt.error.no_speech')
    case 'aborted':
      return t('voice.stt.error.aborted')
    default:
      return t('voice.stt.error.generic')
  }
}
