import type { MutableRefObject } from 'react'
import type { WakewordRuntimeController } from '../../features/hearing/wakewordRuntime.ts'
import type { ParaformerStreamSession } from '../../features/hearing/localParaformer.ts'
import type { SenseVoiceStreamSession } from '../../features/hearing/localSenseVoice.ts'
import type { TencentAsrStreamSession } from '../../features/hearing/tencentAsr.ts'
import type { BrowserSpeechRecognition } from '../../lib/voice'

export type CleanupVoiceRuntimeResourcesOptions = {
  clearPendingVoiceRestart: () => void
  recognitionRef: MutableRefObject<BrowserSpeechRecognition | null>
  stopApiRecording: (cancel?: boolean) => void
  stopVadListening: (cancel?: boolean) => Promise<void>
  speechLevelValueRef: MutableRefObject<number>
  setSpeechLevel: (level: number) => void
  stopActiveSpeechOutput: () => void
  paraformerSessionRef: MutableRefObject<ParaformerStreamSession | null>
  sensevoiceSessionRef: MutableRefObject<SenseVoiceStreamSession | null>
  tencentAsrSessionRef: MutableRefObject<TencentAsrStreamSession | null>
  apiRecordingRef: MutableRefObject<import('./types').ApiRecordingSession | null>
  wakewordRuntimeRef: MutableRefObject<WakewordRuntimeController | null>
}

export function cleanupVoiceRuntimeResources(
  options: CleanupVoiceRuntimeResourcesOptions,
) {
  options.clearPendingVoiceRestart()
  options.recognitionRef.current?.abort()
  options.stopApiRecording(true)
  void options.stopVadListening(true)

  options.speechLevelValueRef.current = 0
  options.setSpeechLevel(0)
  options.stopActiveSpeechOutput()
  options.paraformerSessionRef.current?.abort()
  options.paraformerSessionRef.current = null
  options.sensevoiceSessionRef.current?.abort()
  options.sensevoiceSessionRef.current = null
  options.tencentAsrSessionRef.current?.abort()
  options.tencentAsrSessionRef.current = null
  options.wakewordRuntimeRef.current?.destroy()
  options.wakewordRuntimeRef.current = null
}
