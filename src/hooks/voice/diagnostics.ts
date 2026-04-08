import {
  AUDIO_SMOKE_PLAYBACK_TIMEOUT_MS,
  buildSpeechOutputSmokeText,
  mapMicrophoneDiagnosticError,
  pickRecordingMimeType,
  requestVoiceInputStream,
} from '../../features/voice/runtimeSupport'
import {
  isSenseVoiceSpeechInputProvider,
} from '../../lib/audioProviders'
import { checkSenseVoiceAvailability } from '../../features/hearing/localSenseVoice.ts'
import type { AppSettings } from '../../types'

export type VoiceDiagnosticResult = {
  ok: boolean
  message: string
}

export type TestSpeechInputReadinessRuntimeOptions = {
  draftSettings: AppSettings
}

export type TestSpeechInputConnectionRuntimeOptions = {
  draftSettings: AppSettings
  testSpeechInputReadiness: (draftSettings: AppSettings) => Promise<VoiceDiagnosticResult>
}

export type ProbeSpeechOutputPlaybackStartRuntimeOptions = {
  draftSettings: AppSettings
  text: string
  stopActiveSpeechOutput: () => void
  startSpeechOutput: (
    text: string,
    speechSettings: AppSettings,
    options?: {
      onStart?: () => void
      onEnd?: () => void
      onError?: (message: string) => void
    },
  ) => Promise<void>
}

export type TestSpeechOutputReadinessRuntimeOptions = {
  draftSettings: AppSettings
  options?: {
    playSample?: boolean
    sampleText?: string
  }
  probeSpeechOutputPlaybackStart: (
    draftSettings: AppSettings,
    text: string,
  ) => Promise<void>
}

export type RunAudioSmokeTestRuntimeOptions = {
  draftSettings: AppSettings
  testSpeechInputConnection: (draftSettings: AppSettings) => Promise<VoiceDiagnosticResult>
  testSpeechOutputReadiness: (
    draftSettings: AppSettings,
    options?: {
      playSample?: boolean
      sampleText?: string
    },
  ) => Promise<VoiceDiagnosticResult>
}

export async function testSpeechInputReadinessRuntime(
  options: TestSpeechInputReadinessRuntimeOptions,
): Promise<VoiceDiagnosticResult> {
  const providerId = options.draftSettings.speechInputProviderId

  if (!navigator.mediaDevices?.getUserMedia) {
    return {
      ok: false,
      message: '当前环境没有暴露麦克风录音能力，无法启动语音输入。',
    }
  }

  if (typeof MediaRecorder === 'undefined') {
    return {
      ok: false,
      message: '当前环境不支持 MediaRecorder，无法完成语音输入录音。',
    }
  }

  let stream: MediaStream | null = null

  try {
    stream = (await requestVoiceInputStream({ purpose: 'stt' })).stream
    const audioTracks = stream.getAudioTracks()

    if (!audioTracks.length) {
      return {
        ok: false,
        message: '已经拿到录音流，但没有发现可用的音频轨道。',
      }
    }

    const mimeType = pickRecordingMimeType()
    if (mimeType) {
      new MediaRecorder(stream, { mimeType })
    } else {
      new MediaRecorder(stream)
    }

    if (isSenseVoiceSpeechInputProvider(providerId)) {
      const status = await checkSenseVoiceAvailability()
      if (!status.installed) {
        return {
          ok: false,
          message: 'sherpa-onnx-node 未安装，请先运行 npm install sherpa-onnx-node。',
        }
      }
      if (!status.modelFound) {
        return {
          ok: false,
          message: `未找到 SenseVoice 模型，请将 sherpa-onnx-sense-voice-zh-en-2024-07-17 目录放到 ${status.modelsDir} 下。`,
        }
      }
    }

    const message = isSenseVoiceSpeechInputProvider(providerId)
      ? '麦克风权限已就绪，SenseVoice 离线识别引擎和模型都正常。'
      : '麦克风权限已就绪，本地录音链路正常。'

    return { ok: true, message }
  } catch (caught) {
    return {
      ok: false,
      message: mapMicrophoneDiagnosticError(
        caught,
        isSenseVoiceSpeechInputProvider(providerId),
      ),
    }
  } finally {
    stream?.getTracks().forEach((track) => track.stop())
  }
}

export async function testSpeechInputConnectionRuntime(
  options: TestSpeechInputConnectionRuntimeOptions,
): Promise<VoiceDiagnosticResult> {
  const localSpeechCheck = await options.testSpeechInputReadiness(options.draftSettings)
  if (!localSpeechCheck.ok) {
    return localSpeechCheck
  }

  if (isSenseVoiceSpeechInputProvider(options.draftSettings.speechInputProviderId)) {
    return localSpeechCheck
  }

  if (!window.desktopPet?.testServiceConnection) {
    return {
      ok: false,
      message: '当前环境不支持语音输入连接测试。',
    }
  }

  const remoteSpeechCheck = await window.desktopPet.testServiceConnection({
    capability: 'speech-input',
    providerId: options.draftSettings.speechInputProviderId,
    baseUrl: options.draftSettings.speechInputApiBaseUrl,
    apiKey: options.draftSettings.speechInputApiKey,
    model: options.draftSettings.speechInputModel,
  })

  if (!remoteSpeechCheck.ok) {
    return remoteSpeechCheck
  }

  return {
    ok: true,
    message: `${localSpeechCheck.message} ${remoteSpeechCheck.message}`.trim(),
  }
}

export async function probeSpeechOutputPlaybackStartRuntime(
  options: ProbeSpeechOutputPlaybackStartRuntimeOptions,
) {
  options.stopActiveSpeechOutput()

  await new Promise<void>((resolve, reject) => {
    let settled = false
    let timeoutId: number | null = window.setTimeout(() => {
      finish(() => {
        options.stopActiveSpeechOutput()
        reject(new Error('语音服务已经返回结果，但播放在限定时间内没有真正开始，请检查系统输出设备、自动播放权限或音频解码能力。'))
      })
    }, AUDIO_SMOKE_PLAYBACK_TIMEOUT_MS)
    let stopTimerId: number | null = null

    function finish(callback: () => void) {
      if (settled) return
      settled = true

      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
        timeoutId = null
      }

      if (stopTimerId !== null) {
        window.clearTimeout(stopTimerId)
        stopTimerId = null
      }

      callback()
    }

    function scheduleStop() {
      stopTimerId = window.setTimeout(() => {
        options.stopActiveSpeechOutput()
      }, 220)
    }

    void options.startSpeechOutput(options.text, options.draftSettings, {
      onStart: () => {
        finish(() => {
          scheduleStop()
          resolve()
        })
      },
      onEnd: () => {
        finish(() => {
          resolve()
        })
      },
      onError: (message) => {
        finish(() => {
          options.stopActiveSpeechOutput()
          reject(new Error(message))
        })
      },
    }).catch((error) => {
      finish(() => {
        options.stopActiveSpeechOutput()
        reject(error instanceof Error ? error : new Error(String(error)))
      })
    })
  })
}

export async function testSpeechOutputReadinessRuntime(
  options: TestSpeechOutputReadinessRuntimeOptions,
): Promise<VoiceDiagnosticResult> {
  if (!options.draftSettings.speechOutputEnabled) {
    return {
      ok: false,
      message: '请先开启语音播报。',
    }
  }

  if (!window.desktopPet?.testServiceConnection) {
    return {
      ok: false,
      message: '当前环境不支持语音输出连接测试。',
    }
  }

  const remoteSpeechCheck = await window.desktopPet.testServiceConnection({
    capability: 'speech-output',
    providerId: options.draftSettings.speechOutputProviderId,
    baseUrl: options.draftSettings.speechOutputApiBaseUrl,
    apiKey: options.draftSettings.speechOutputApiKey,
    model: options.draftSettings.speechOutputModel,
    // Voice cloning disabled — always use the provider's configured voice.
    voice: options.draftSettings.speechOutputVoice,
  })

  if (!remoteSpeechCheck.ok) {
    return remoteSpeechCheck
  }

  if (options.options?.playSample) {
    await options.probeSpeechOutputPlaybackStart(
      options.draftSettings,
      options.options.sampleText?.trim() || buildSpeechOutputSmokeText(options.draftSettings),
    )

    return {
      ok: true,
      message: `${remoteSpeechCheck.message} 已确认本机可以启动语音播放。`,
    }
  }

  return remoteSpeechCheck
}

export async function runAudioSmokeTestRuntime(
  options: RunAudioSmokeTestRuntimeOptions,
): Promise<VoiceDiagnosticResult> {
  if (!options.draftSettings.speechInputEnabled && !options.draftSettings.speechOutputEnabled) {
    return {
      ok: false,
      message: '请先至少开启语音输入或语音播报中的一项。',
    }
  }

  const messages: string[] = []

  if (options.draftSettings.speechInputEnabled) {
    const inputCheck = await options.testSpeechInputConnection(options.draftSettings)
    if (!inputCheck.ok) {
      return {
        ok: false,
        message: `语音输入：${inputCheck.message}`,
      }
    }

    messages.push(`语音输入：${inputCheck.message}`)
  } else {
    messages.push('语音输入：当前已关闭，已跳过。')
  }

  if (options.draftSettings.speechOutputEnabled) {
    const outputCheck = await options.testSpeechOutputReadiness(options.draftSettings, {
      playSample: true,
      sampleText: buildSpeechOutputSmokeText(options.draftSettings),
    })
    if (!outputCheck.ok) {
      return {
        ok: false,
        message: [...messages, `语音输出：${outputCheck.message}`].join('\n'),
      }
    }

    messages.push(`语音输出：${outputCheck.message}`)
  } else {
    messages.push('语音输出：当前已关闭，已跳过。')
  }

  return {
    ok: true,
    message: messages.join('\n'),
  }
}
