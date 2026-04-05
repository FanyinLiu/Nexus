import {
  getSpeechInputProviderPreset,
  getSpeechOutputProviderPreset,
  resolveSpeechInputModel,
} from '../../lib'
import {
  buildDoctorReport,
  buildLocalServiceProbeRequest,
  collectDoctorSettingsPatch,
  formatLocalServiceProbeDetail,
} from '../../features/doctor'
import { mapMicrophoneDiagnosticError } from '../../features/voice'
import type {
  AppSettings,
  DoctorReport,
  ReminderTask,
  RuntimeStateSnapshot,
} from '../../types'

type DoctorVoiceRuntime = {
  testSpeechInputConnection: (draftSettings: AppSettings) => Promise<{
    ok: boolean
    message: string
  }>
  testSpeechOutputReadiness: (draftSettings: AppSettings) => Promise<{
    ok: boolean
    message: string
  }>
}

type RunDoctorChecksOptions = {
  draftSettings: AppSettings
  reminderTasks: ReminderTask[]
  runtimeSnapshot: RuntimeStateSnapshot
  voice: DoctorVoiceRuntime
}

export type RunDoctorChecksResult = {
  report: DoctorReport
  suggestedSettingsPatch?: Partial<AppSettings>
}

export async function runDoctorChecks({
  draftSettings,
  reminderTasks,
  runtimeSnapshot,
  voice,
}: RunDoctorChecksOptions): Promise<RunDoctorChecksResult> {
  const checks: DoctorReport['checks'] = []

  const enabledReminderTasks = reminderTasks.filter((task) => task.enabled)
  const nextReminderTask = enabledReminderTasks.find((task) => task.nextRunAt)
  const disabledFailovers = [
    !draftSettings.chatFailoverEnabled ? '聊天模型主备' : '',
    !draftSettings.speechInputFailoverEnabled ? 'STT 主备' : '',
    !draftSettings.speechOutputFailoverEnabled ? 'TTS 主备' : '',
  ].filter(Boolean)

  checks.push({
    id: 'runtime-presence',
    title: '桌宠 / 面板在线状态',
    status: runtimeSnapshot.petOnline || runtimeSnapshot.panelOnline
      ? (runtimeSnapshot.petOnline && runtimeSnapshot.panelOnline ? 'ok' : 'warning')
      : 'error',
    summary: runtimeSnapshot.petOnline && runtimeSnapshot.panelOnline
      ? '桌宠与面板都在线，运行态总线已联通。'
      : runtimeSnapshot.petOnline || runtimeSnapshot.panelOnline
        ? '只有一个界面在线，跨窗口状态同步会受影响。'
        : '桌宠和面板都没有向运行态总线上报心跳。',
    detail: `桌宠：${runtimeSnapshot.petOnline ? '在线' : '离线'} / 面板：${runtimeSnapshot.panelOnline ? '在线' : '离线'}`,
  })

  checks.push({
    id: 'provider-failover',
    title: 'Provider 故障转移',
    status: disabledFailovers.length ? 'warning' : 'ok',
    summary: disabledFailovers.length
      ? `还有 ${disabledFailovers.length} 条主备链路未开启。`
      : '聊天、STT、TTS 都已开启默认故障转移。',
    detail: disabledFailovers.length
      ? `未开启：${disabledFailovers.join(' / ')}`
      : '当前会在链路失败时自动尝试备用方案，并对故障 provider 做短时冷却。',
    repairActions: disabledFailovers.length
      ? [{
          id: 'enable-default-failover',
          label: '启用默认主备链路',
          description: '开启聊天、STT、TTS 的默认自动故障转移。',
          settingsPatch: {
            chatFailoverEnabled: true,
            speechInputFailoverEnabled: true,
            speechOutputFailoverEnabled: true,
          },
        }]
      : [],
  })

  const requiredLocalServiceIds = new Set<string>()
  if (draftSettings.apiProviderId === 'ollama' || draftSettings.chatFailoverEnabled) {
    requiredLocalServiceIds.add('ollama')
  }
  if (draftSettings.speechOutputProviderId === 'cosyvoice-tts') {
    requiredLocalServiceIds.add('cosyvoice-tts')
  }
  if (draftSettings.speechOutputProviderId === 'local-qwen3-tts') {
    requiredLocalServiceIds.add('local-qwen3-tts')
  }

  const localServiceProbeTargets = [
    buildLocalServiceProbeRequest(
      'ollama',
      'Ollama',
      draftSettings.apiProviderId === 'ollama'
        ? draftSettings.apiBaseUrl
        : 'http://127.0.0.1:11434',
    ),
    buildLocalServiceProbeRequest(
      'cosyvoice-tts',
      'CosyVoice2',
      draftSettings.speechOutputProviderId === 'cosyvoice-tts'
        ? draftSettings.speechOutputApiBaseUrl
        : (getSpeechOutputProviderPreset('cosyvoice-tts').baseUrl || 'http://127.0.0.1:50000'),
    ),
    buildLocalServiceProbeRequest(
      'local-qwen3-tts',
      'local-qwen3-tts',
      draftSettings.speechOutputProviderId === 'local-qwen3-tts'
        ? draftSettings.speechOutputApiBaseUrl
        : (getSpeechOutputProviderPreset('local-qwen3-tts').baseUrl || 'http://127.0.0.1:5051'),
    ),
  ].filter((target): target is NonNullable<typeof target> => Boolean(target))

  if (window.desktopPet?.probeLocalServices && localServiceProbeTargets.length) {
    try {
      const serviceResults = await window.desktopPet.probeLocalServices(localServiceProbeTargets)
      const requiredFailures = serviceResults.filter(
        (result) => requiredLocalServiceIds.has(result.id) && !result.ok,
      )
      const optionalFailures = serviceResults.filter(
        (result) => !requiredLocalServiceIds.has(result.id) && !result.ok,
      )
      const activeSpeechOutputServiceFailure = (
        (draftSettings.speechOutputProviderId === 'local-qwen3-tts'
          || draftSettings.speechOutputProviderId === 'cosyvoice-tts')
        && serviceResults.some(
          (result) => result.id === draftSettings.speechOutputProviderId && !result.ok,
        )
      )

      checks.push({
        id: 'local-services',
        title: '本地服务端口',
        status: requiredFailures.length
          ? 'error'
          : requiredLocalServiceIds.size === 0
            ? 'skipped'
            : optionalFailures.length
              ? 'warning'
              : 'ok',
        summary: requiredFailures.length
          ? `发现 ${requiredFailures.length} 个当前链路依赖的本地服务端口不通。`
          : requiredLocalServiceIds.size === 0
            ? '当前主链路没有依赖 Ollama / local-qwen3-tts / CosyVoice2，本项只做参考探测。'
            : optionalFailures.length
              ? `主链路仍可用，但有 ${optionalFailures.length} 个本地备用服务没有启动。`
              : '当前链路依赖的本地服务端口都可连通。',
        detail: formatLocalServiceProbeDetail(serviceResults),
        repairActions: activeSpeechOutputServiceFailure
          ? [{
              id: 'switch-to-edge-tts',
              label: '切换到 Edge TTS（免费在线）',
              description: '当前本地 TTS 端口不通，切换到免费的 Edge TTS 恢复语音播报。',
              settingsPatch: {
                speechOutputProviderId: 'edge-tts',
                speechOutputApiBaseUrl: getSpeechOutputProviderPreset('edge-tts').baseUrl,
                speechOutputApiKey: '',
                speechOutputModel: getSpeechOutputProviderPreset('edge-tts').defaultModel,
                speechOutputVoice: getSpeechOutputProviderPreset('edge-tts').defaultVoice,
              },
            }]
          : [],
      })
    } catch (error) {
      checks.push({
        id: 'local-services',
        title: '本地服务端口',
        status: 'warning',
        summary: '本地服务探测没有执行完成。',
        detail: error instanceof Error ? error.message : '本地端口探测失败。',
      })
    }
  }

  if (window.desktopPet?.testChatConnection) {
    try {
      const result = await window.desktopPet.testChatConnection({
        providerId: draftSettings.apiProviderId,
        baseUrl: draftSettings.apiBaseUrl,
        apiKey: draftSettings.apiKey,
        model: draftSettings.model,
      })
      checks.push({
        id: 'chat-provider',
        title: '聊天模型链路',
        status: result.ok ? 'ok' : 'error',
        summary: result.ok ? '聊天模型接口可用。' : '聊天模型接口当前不可用。',
        detail: result.message,
      })
    } catch (error) {
      checks.push({
        id: 'chat-provider',
        title: '聊天模型链路',
        status: 'error',
        summary: '聊天模型接口当前不可用。',
        detail: error instanceof Error ? error.message : '聊天模型检测失败。',
      })
    }
  }

  if (draftSettings.speechInputEnabled) {
    if (!navigator.mediaDevices?.getUserMedia) {
      checks.push({
        id: 'microphone',
        title: '麦克风权限',
        status: 'error',
        summary: '当前环境没有暴露麦克风能力。',
        detail: '请检查 Electron 录音权限、系统隐私设置和输入设备。',
      })
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        const track = stream.getAudioTracks()[0] ?? null
        stream.getTracks().forEach((item) => item.stop())
        checks.push({
          id: 'microphone',
          title: '麦克风权限',
          status: track ? 'ok' : 'warning',
          summary: track ? '麦克风权限正常，可以拿到录音轨道。' : '拿到了录音流，但没有发现有效音轨。',
          detail: track?.label?.trim() || '浏览器未返回可读的设备标签。',
        })
      } catch (error) {
        checks.push({
          id: 'microphone',
          title: '麦克风权限',
          status: 'error',
          summary: '麦克风权限或输入设备异常。',
          detail: mapMicrophoneDiagnosticError(error, true),
        })
      }
    }

    try {
      const result = await voice.testSpeechInputConnection(draftSettings)
      checks.push({
        id: 'speech-input',
        title: '语音识别链路',
        status: result.ok ? 'ok' : 'error',
        summary: result.ok ? '当前 STT 链路可用。' : '当前 STT 链路不可用。',
        detail: result.message,
        repairActions: result.ok || draftSettings.speechInputProviderId === 'local-sherpa'
          ? []
          : [{
              id: 'switch-stt-local-sherpa',
              label: '切换到本地 Whisper',
              description: '把失败的 STT 链路切到本地 Whisper 作为更稳的兜底。',
              settingsPatch: {
                speechInputProviderId: 'local-sherpa',
                speechInputApiBaseUrl: '',
                speechInputModel: resolveSpeechInputModel(
                  'local-sherpa',
                  getSpeechInputProviderPreset('local-sherpa').defaultModel,
                ),
              },
            }],
      })
    } catch (error) {
      checks.push({
        id: 'speech-input',
        title: '语音识别链路',
        status: 'error',
        summary: '当前 STT 链路不可用。',
        detail: error instanceof Error ? error.message : '语音识别检测失败。',
      })
    }
  } else {
    checks.push({
      id: 'speech-input',
      title: '语音识别链路',
      status: 'skipped',
      summary: '当前已关闭语音输入。',
    })
  }

  if (draftSettings.speechOutputEnabled) {
    try {
      const result = await voice.testSpeechOutputReadiness(draftSettings)
      checks.push({
        id: 'speech-output',
        title: '语音播报链路',
        status: result.ok ? 'ok' : 'error',
        summary: result.ok ? '当前 TTS 链路可用。' : '当前 TTS 链路不可用。',
        detail: result.message,
        repairActions: result.ok || draftSettings.speechOutputProviderId === 'cosyvoice-tts'
          ? []
          : [{
              id: 'reset-cosyvoice-tts',
              label: '先切回 CosyVoice2',
              description: '先把 TTS 播报切回 CosyVoice2 主链，再继续排查其他链路。',
              settingsPatch: {
                speechOutputProviderId: 'cosyvoice-tts',
                speechOutputApiBaseUrl: getSpeechOutputProviderPreset('cosyvoice-tts').baseUrl,
                speechOutputApiKey: '',
                speechOutputModel: getSpeechOutputProviderPreset('cosyvoice-tts').defaultModel,
                speechOutputVoice: getSpeechOutputProviderPreset('cosyvoice-tts').defaultVoice,
              },
            }],
      })
    } catch (error) {
      checks.push({
        id: 'speech-output',
        title: '语音播报链路',
        status: 'error',
        summary: '当前 TTS 链路不可用。',
        detail: error instanceof Error ? error.message : '语音播报检测失败。',
      })
    }
  } else {
    checks.push({
      id: 'speech-output',
      title: '语音播报链路',
      status: 'skipped',
      summary: '当前已关闭语音播报。',
    })
  }

  if (draftSettings.voiceTriggerMode === 'wake_word' && window.desktopPet?.kwsStatus) {
    try {
      const status = await window.desktopPet.kwsStatus({ wakeWord: draftSettings.wakeWord })
      checks.push({
        id: 'wake-word',
        title: '唤醒词模型',
        status: status.active && status.modelFound ? 'ok' : status.modelFound ? 'warning' : 'error',
        summary: status.active && status.modelFound
          ? `唤醒词“${draftSettings.wakeWord}”正在工作。`
          : status.modelFound
            ? '唤醒词模型已找到，但监听还没有真正启动。'
            : '唤醒词模型或配置当前不可用。',
        detail: status.reason || `模型：${status.modelKind ?? '未知'} / 活跃：${status.active ? '是' : '否'}`,
        repairActions: status.modelFound
          ? []
          : [{
              id: 'disable-wake-word',
              label: '先改回直接发送',
              description: '先恢复正常对话，唤醒词模型补齐后再重新打开。',
              settingsPatch: {
                voiceTriggerMode: 'direct_send',
                wakeWordEnabled: false,
              },
            }],
      })
    } catch (error) {
      checks.push({
        id: 'wake-word',
        title: '唤醒词模型',
        status: 'error',
        summary: '唤醒词链路检测失败。',
        detail: error instanceof Error ? error.message : '唤醒词检测失败。',
      })
    }
  } else {
    checks.push({
      id: 'wake-word',
      title: '唤醒词模型',
      status: 'skipped',
      summary: draftSettings.voiceTriggerMode === 'wake_word'
        ? '当前环境不支持唤醒词检测接口。'
        : '当前未启用唤醒词模式。',
    })
  }

  checks.push({
    id: 'scheduler',
    title: '定时任务调度器',
    status: enabledReminderTasks.length === 0
      ? 'skipped'
      : (runtimeSnapshot.petOnline || runtimeSnapshot.panelOnline) && nextReminderTask?.nextRunAt
        ? 'ok'
        : 'warning',
    summary: enabledReminderTasks.length === 0
      ? '当前没有启用的定时任务。'
      : (runtimeSnapshot.petOnline || runtimeSnapshot.panelOnline) && nextReminderTask?.nextRunAt
        ? '提醒调度器已挂在桌宠窗口，下一次触发时间已算出。'
        : '存在任务，但桌宠窗口离线或下一次触发时间没有算出来。',
    detail: enabledReminderTasks.length === 0
      ? '创建提醒后，这里会显示下一次执行时间。'
      : `${nextReminderTask?.title ?? '未命名任务'} / ${nextReminderTask?.nextRunAt ?? '没有 nextRunAt'}`,
  })

  const report = buildDoctorReport(checks)
  const suggestedSettingsPatch = collectDoctorSettingsPatch(report)

  return {
    report,
    suggestedSettingsPatch: Object.keys(suggestedSettingsPatch).length
      ? suggestedSettingsPatch
      : undefined,
  }
}
