import type { MutableRefObject } from 'react'
import {
  getRecordingFileName,
  pickRecordingMimeType,
  requestVoiceInputStream,
} from '../../features/voice/runtimeSupport'
import { createAdaptiveRmsGate } from './support'
import type { ApiRecordingSession } from './types'

export type RecordingSessionSpeechEvent = {
  firstDetectedSpeech: boolean
  now: number
  rms: number
  session: ApiRecordingSession
}

export type RecordingSessionStopEvent = {
  audioBlob: Blob
  session: ApiRecordingSession
}

export type StartRecordingSessionOptions = {
  sessionRef: MutableRefObject<ApiRecordingSession | null>
  stopRecording: () => void
  threshold: number
  maxIdleMs: number
  silenceMs: number
  maxDurationMs: number
  onReady?: (session: ApiRecordingSession) => void
  onSpeech?: (event: RecordingSessionSpeechEvent) => void
  onStop?: (event: RecordingSessionStopEvent) => void | Promise<void>
  onRecorderError?: (session: ApiRecordingSession) => void
}

export function cleanupApiRecordingSession(session: ApiRecordingSession) {
  if (session.animationFrameId) {
    window.cancelAnimationFrame(session.animationFrameId)
  }

  if (session.maxDurationTimer) {
    window.clearTimeout(session.maxDurationTimer)
  }

  session.stream.getTracks().forEach((track) => track.stop())
  void session.audioContext.close().catch(() => undefined)
}

export async function startRecordingSession(
  options: StartRecordingSessionOptions,
) {
  const stream = (await requestVoiceInputStream({ purpose: 'stt' })).stream
  // From here on, any throw must release the mic stream — without this,
  // a MediaRecorder constructor failure (unsupported mimeType in some
  // browsers) leaks the active mic permission until tab close.
  let mediaRecorder: MediaRecorder
  let audioContext: AudioContext | null = null
  let mimeType: string | null = null
  try {
    mimeType = pickRecordingMimeType()
    mediaRecorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream)
    audioContext = new AudioContext()
  } catch (err) {
    for (const track of stream.getTracks()) track.stop()
    if (audioContext) {
      void (audioContext as AudioContext).close().catch(() => undefined)
    }
    throw err
  }
  const analyser = audioContext.createAnalyser()
  analyser.fftSize = 2048

  const source = audioContext.createMediaStreamSource(stream)
  source.connect(analyser)

  const session: ApiRecordingSession = {
    mediaRecorder,
    stream,
    audioContext,
    analyser,
    dataArray: new Uint8Array(analyser.fftSize) as Uint8Array<ArrayBuffer>,
    chunks: [],
    mimeType: mimeType || 'audio/webm',
    fileName: getRecordingFileName(mimeType || 'audio/webm'),
    animationFrameId: null,
    maxDurationTimer: null,
    startedAt: performance.now(),
    lastSpeechAt: performance.now(),
    hasDetectedSpeech: false,
    cancelled: false,
  }

  const volumeGate = createAdaptiveRmsGate(options.threshold)

  const monitorVolume = () => {
    if (options.sessionRef.current !== session) {
      return
    }

    analyser.getByteTimeDomainData(session.dataArray)
    let sum = 0

    for (const value of session.dataArray) {
      const normalized = (value - 128) / 128
      sum += normalized * normalized
    }

    const rms = Math.sqrt(sum / session.dataArray.length)
    const now = performance.now()

    if (volumeGate.isSpeech(rms)) {
      const firstDetectedSpeech = !session.hasDetectedSpeech
      session.hasDetectedSpeech = true
      session.lastSpeechAt = now
      options.onSpeech?.({
        firstDetectedSpeech,
        now,
        rms,
        session,
      })
    }

    if (!session.hasDetectedSpeech && now - session.startedAt >= options.maxIdleMs) {
      options.stopRecording()
      return
    }

    if (session.hasDetectedSpeech && now - session.lastSpeechAt >= options.silenceMs) {
      options.stopRecording()
      return
    }

    session.animationFrameId = window.requestAnimationFrame(monitorVolume)
  }

  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      session.chunks.push(event.data)
    }
  }

  mediaRecorder.onerror = () => {
    if (options.sessionRef.current === session) {
      options.sessionRef.current = null
    }

    cleanupApiRecordingSession(session)
    options.onRecorderError?.(session)
  }

  mediaRecorder.onstop = async () => {
    if (options.sessionRef.current === session) {
      options.sessionRef.current = null
    }

    cleanupApiRecordingSession(session)

    await options.onStop?.({
      audioBlob: new Blob(session.chunks, { type: session.mimeType }),
      session,
    })
  }

  session.maxDurationTimer = window.setTimeout(() => {
    options.stopRecording()
  }, options.maxDurationMs)

  options.sessionRef.current = session
  options.onReady?.(session)
  mediaRecorder.start()
  session.animationFrameId = window.requestAnimationFrame(monitorVolume)

  return session
}
