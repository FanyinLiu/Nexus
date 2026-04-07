import type { MutableRefObject } from 'react'
import type { HearingConfig } from './config'
import {
  createLocalAsrWorker,
  decodeAudioBlobToMonoFloat32,
  normalizeWhisperLanguage,
  preloadLocalAsrWorker,
  type LocalAsrWorkerResponse,
} from './localWhisper.ts'
import type { VoiceTraceEntry } from '../../types'

export type LocalAsrPendingRequest = {
  resolve: (text: string) => void
  reject: (error: Error) => void
}

export type LocalAsrRuntimeRefs = {
  workerRef: MutableRefObject<Worker | null>
  requestIdRef: MutableRefObject<number>
  pendingRef: MutableRefObject<Map<number, LocalAsrPendingRequest>>
}

type AppendVoiceTrace = (
  title: string,
  detail: string,
  tone?: VoiceTraceEntry['tone'],
) => void

type LocalAsrRuntimeOptions = {
  appendVoiceTrace?: AppendVoiceTrace
}

const DEFAULT_WHISPER_MODEL = 'Xenova/whisper-base'

export function rejectPendingLocalAsrRequests(
  pendingRef: MutableRefObject<Map<number, LocalAsrPendingRequest>>,
  message: string,
) {
  for (const [requestId, pending] of pendingRef.current.entries()) {
    pendingRef.current.delete(requestId)
    pending.reject(new Error(message))
  }
}

export function getLocalAsrWorker(
  refs: LocalAsrRuntimeRefs,
  options?: LocalAsrRuntimeOptions,
) {
  if (refs.workerRef.current) {
    return refs.workerRef.current
  }

  const worker = createLocalAsrWorker()

  worker.onmessage = (event: MessageEvent<LocalAsrWorkerResponse>) => {
    const payload = event.data

    if (payload.type === 'status') {
      options?.appendVoiceTrace?.('本地识别状态', payload.message)
      return
    }

    const pending = refs.pendingRef.current.get(payload.requestId)
    if (!pending) {
      return
    }

    refs.pendingRef.current.delete(payload.requestId)

    if (payload.type === 'result') {
      pending.resolve(payload.text)
      return
    }

    pending.reject(new Error(payload.message))
  }

  worker.onerror = () => {
    rejectPendingLocalAsrRequests(refs.pendingRef, '本地 Whisper 识别线程异常中断。')
    worker.terminate()

    if (refs.workerRef.current === worker) {
      refs.workerRef.current = null
    }
  }

  refs.workerRef.current = worker
  return worker
}

export async function transcribeWithLocalWhisper(
  refs: LocalAsrRuntimeRefs,
  blob: Blob,
  config: Pick<HearingConfig, 'speechInputModel' | 'speechRecognitionLang'>,
  options?: LocalAsrRuntimeOptions,
) {
  const worker = getLocalAsrWorker(refs, options)
  const audio = await decodeAudioBlobToMonoFloat32(blob)
  const requestId = ++refs.requestIdRef.current

  return new Promise<string>((resolve, reject) => {
    refs.pendingRef.current.set(requestId, { resolve, reject })
    worker.postMessage({
      type: 'transcribe',
      requestId,
      model: config.speechInputModel || DEFAULT_WHISPER_MODEL,
      language: normalizeWhisperLanguage(config.speechRecognitionLang),
      audio,
    }, [audio.buffer])
  })
}

export function preloadHiddenLocalAsrWorker(
  refs: LocalAsrRuntimeRefs,
  model = DEFAULT_WHISPER_MODEL,
  options?: LocalAsrRuntimeOptions,
) {
  const worker = getLocalAsrWorker(refs, options)
  return preloadLocalAsrWorker(worker, model)
}

export function cleanupLocalAsrRuntime(
  refs: LocalAsrRuntimeRefs,
  message: string,
) {
  rejectPendingLocalAsrRequests(refs.pendingRef, message)
  const worker = refs.workerRef.current
  if (worker) {
    // 清理事件监听器，防止内存泄漏
    worker.onmessage = null
    worker.onerror = null
    worker.terminate()
    refs.workerRef.current = null
  }
}
