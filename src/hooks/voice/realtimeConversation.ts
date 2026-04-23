import { useCallback, useEffect, useRef } from 'react'
import { StreamAudioPlayer } from '../../features/voice/streamAudioPlayer'
import { logVoiceEvent } from '../../features/voice/shared'
import { useTranslation } from '../../i18n'
import type { AppSettings, PetDialogBubbleState } from '../../types'

type RealtimeConversationDeps = {
  settingsRef: React.RefObject<AppSettings>
  setVoiceState: (state: 'idle' | 'listening' | 'processing' | 'speaking') => void
  setMood: (mood: string) => void
  presentPetDialogBubble: (
    bubble: PetDialogBubbleState,
    options?: { autoHideMs?: number },
  ) => void
  appendChatMessage: (message: { id: string; role: string; content: string; createdAt: string }) => void
  updatePetStatus: (text: string, duration?: number) => void
}

const MIC_SAMPLE_RATE = 16000
const FEED_INTERVAL_MS = 100

export function useRealtimeConversation(deps: RealtimeConversationDeps) {
  const { t } = useTranslation()
  const activeRef = useRef(false)
  const playerRef = useRef<StreamAudioPlayer | null>(null)
  const unsubRef = useRef<(() => void) | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const feedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const pendingSamplesRef = useRef<number[]>([])
  const responseTextRef = useRef('')

  const cleanup = useCallback(() => {
    if (feedTimerRef.current) {
      clearInterval(feedTimerRef.current)
      feedTimerRef.current = null
    }
    pendingSamplesRef.current = []

    if (processorRef.current) {
      processorRef.current.onaudioprocess = null
      processorRef.current.disconnect()
      processorRef.current = null
    }

    sourceRef.current?.disconnect()
    sourceRef.current = null

    audioCtxRef.current?.close().catch(() => {})
    audioCtxRef.current = null

    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null

    playerRef.current?.stopAndClear()
    playerRef.current = null

    unsubRef.current?.()
    unsubRef.current = null

    responseTextRef.current = ''
  }, [])

  const stopRealtimeSession = useCallback(() => {
    if (!activeRef.current) return
    activeRef.current = false
    cleanup()
    window.desktopPet?.realtimeStop?.().catch(() => {})
    deps.setVoiceState('idle')
    deps.setMood('idle')
    logVoiceEvent('realtime session stopped')
  }, [cleanup, deps])

  const startRealtimeSession = useCallback(async () => {
    if (activeRef.current) return
    activeRef.current = true

    const settings = deps.settingsRef.current
    const dp = window.desktopPet
    if (!dp?.realtimeStart) {
      activeRef.current = false
      throw new Error('Realtime API not available')
    }

    const player = new StreamAudioPlayer({
      onPlaybackStart: () => deps.setVoiceState('speaking'),
      onPlaybackEnd: () => {
        if (activeRef.current) {
          deps.setVoiceState('listening')
          deps.setMood('idle')
        }
      },
    })
    playerRef.current = player

    const unsub = dp.subscribeRealtimeEvent((event) => {
      if (!activeRef.current) return

      switch (event.type) {
        case 'user_speech_started':
          deps.setVoiceState('listening')
          deps.setMood('thinking')
          player.stopAndClear()
          responseTextRef.current = ''
          break

        case 'user_speech_stopped':
          deps.setVoiceState('processing')
          break

        case 'user_transcript':
          if (event.text) {
            logVoiceEvent('realtime user transcript', { text: event.text })
            deps.appendChatMessage({
              id: `msg-${crypto.randomUUID()}`,
              role: 'user',
              content: event.text,
              createdAt: new Date().toISOString(),
            })
          }
          break

        case 'audio':
          deps.setVoiceState('speaking')
          deps.setMood('happy')
          player.appendPcmChunk(
            new Float32Array(event.samples),
            event.sampleRate,
            event.channels,
          )
          break

        case 'response_transcript_delta':
          responseTextRef.current += event.delta
          deps.presentPetDialogBubble({
            content: responseTextRef.current,
            streaming: true,
          })
          break

        case 'response_transcript_done':
          responseTextRef.current = event.text
          deps.presentPetDialogBubble(
            { content: event.text, streaming: false },
            { autoHideMs: 9_000 },
          )
          deps.appendChatMessage({
            id: `msg-${crypto.randomUUID()}`,
            role: 'assistant',
            content: event.text,
            createdAt: new Date().toISOString(),
          })
          break

        case 'response_done':
          deps.setMood('happy')
          break

        case 'error':
          logVoiceEvent('realtime error', { message: event.message })
          deps.updatePetStatus(t('voice.realtime.error_prefix', { message: event.message }), 4000)
          break

        case 'state':
          if (event.state === 'idle' && activeRef.current) {
            stopRealtimeSession()
          }
          break
      }
    })
    unsubRef.current = unsub

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: { ideal: MIC_SAMPLE_RATE },
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      })
      streamRef.current = stream

      const audioCtx = new AudioContext({ sampleRate: MIC_SAMPLE_RATE })
      audioCtxRef.current = audioCtx
      const source = audioCtx.createMediaStreamSource(stream)
      sourceRef.current = source
      const processor = audioCtx.createScriptProcessor(4096, 1, 1)
      processorRef.current = processor

      processor.onaudioprocess = (e) => {
        if (!activeRef.current) return
        const input = e.inputBuffer.getChannelData(0)
        pendingSamplesRef.current.push(...input)
      }

      source.connect(processor)
      processor.connect(audioCtx.destination)

      feedTimerRef.current = setInterval(() => {
        const samples = pendingSamplesRef.current
        if (samples.length > 0) {
          pendingSamplesRef.current = []
          dp.realtimeFeed({ samples }).catch(() => {})
        }
      }, FEED_INTERVAL_MS)

      await dp.realtimeStart({
        apiKey: settings.apiKey,
        baseUrl: settings.apiBaseUrl.replace(/\/v1\/?$/i, '/v1/realtime'),
        model: settings.model,
        voice: 'alloy',
        systemPrompt: settings.systemPrompt,
        temperature: 0.8,
        maxResponseTokens: 300,
      })

      deps.setVoiceState('listening')
      deps.updatePetStatus(t('voice.realtime.connected'), 2000)
      logVoiceEvent('realtime session started')
    } catch (err) {
      activeRef.current = false
      cleanup()
      throw err
    }
  }, [cleanup, stopRealtimeSession, deps, t])

  // Unmount-safety: if the component holding this hook disappears while a
  // realtime session is still active (page navigation, chat panel close),
  // full teardown must run — otherwise the mic track stays live, the
  // AudioContext stays open, and the feed setInterval keeps pinging IPC.
  useEffect(() => {
    return () => {
      if (activeRef.current) {
        activeRef.current = false
        cleanup()
        window.desktopPet?.realtimeStop?.().catch(() => {})
      }
    }
  }, [cleanup])

  return {
    startRealtimeSession,
    stopRealtimeSession,
    isRealtimeActive: () => activeRef.current,
  }
}
