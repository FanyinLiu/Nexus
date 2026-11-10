import assert from 'node:assert/strict'
import { register } from 'node:module'
import { test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { ensureLocaleLoaded, setLocale } from '../src/i18n/runtime.ts'
import type { AppSettings, MediaPermissionStatusSnapshot, PlatformProfile } from '../src/types/index.ts'

register(new URL('./helpers/tsx-test-loader.mjs', import.meta.url))

const { VoiceSimplePage } = await import('../src/components/settingsSimple/VoiceSimplePage.tsx')
const { MemorySimplePage } = await import('../src/components/settingsSimple/MemorySimplePage.tsx')
const {
  buildMediaPermissionStatusRequest,
  isScreenContextActive,
} = await import('../src/features/context/mediaPermissionStatus.ts')

await ensureLocaleLoaded('zh-CN')
setLocale('zh-CN')

const voiceDraft = {
  uiLanguage: 'zh-CN',
  speechInputEnabled: true,
  speechOutputEnabled: false,
  continuousVoiceModeEnabled: false,
  wakeWordEnabled: false,
  wakewordAlwaysOn: false,
  speechRecognitionLang: 'zh-CN',
  speechSynthesisLang: 'zh-CN',
  speechOutputVoice: 'zh-CN-XiaoxiaoNeural',
  voiceTriggerMode: 'direct_send',
  wakeWord: '星绘',
} as unknown as AppSettings

const memoryDraft = {
  uiLanguage: 'zh-CN',
  memoryPaused: false,
  contextAwarenessEnabled: true,
  activeWindowContextEnabled: false,
  clipboardContextEnabled: false,
  screenContextEnabled: true,
  proactiveAgendaEnabled: false,
  proactiveFrequency: 'normal',
  proactiveLetterEnabled: true,
  proactiveLetterChoice: 'auto',
} as unknown as AppSettings

function status(
  microphone: MediaPermissionStatusSnapshot['microphone'],
  screenRecording: MediaPermissionStatusSnapshot['screenRecording'],
): MediaPermissionStatusSnapshot {
  return { platform: 'darwin', microphone, screenRecording }
}

function renderVoice(
  mediaPermissionStatus: MediaPermissionStatusSnapshot,
  draft: AppSettings = voiceDraft,
  permissionPlatform = 'darwin',
) {
  return renderToStaticMarkup(React.createElement(VoiceSimplePage, {
    draft,
    setDraft: () => undefined,
    platformProfile: {
      voice: {
        speechInputSupported: true,
        speechInputAvailable: true,
        speechOutputSupported: true,
        speechOutputAvailable: true,
      },
    } as unknown as PlatformProfile,
    speechVoiceOptions: [],
    onLoadSpeechVoices: () => undefined,
    mediaPermissionStatus,
    permissionPlatform,
  }))
}

function renderMemory(
  mediaPermissionStatus: MediaPermissionStatusSnapshot,
  draft: AppSettings = memoryDraft,
) {
  return renderToStaticMarkup(React.createElement(MemorySimplePage, {
    draft,
    setDraft: () => undefined,
    memories: [],
    dailyMemoryEntries: [],
    confirm: async () => true,
    onCommitMemoryPaused: () => undefined,
    onOpenAdvanced: () => undefined,
    onUpdateMemory: () => undefined,
    onRemoveMemory: () => undefined,
    onUpdateDailyEntry: () => undefined,
    onRemoveDailyEntry: () => undefined,
    mediaPermissionStatus,
  }))
}

test('the microphone permission line appears under the voice toggle only while denied', () => {
  const denied = renderVoice(status('denied', 'unknown'))
  assert.match(denied, /麦克风没授权，去系统设置打开/)
  assert.match(denied, /role="status"/)

  const granted = renderVoice(status('granted', 'unknown'))
  assert.doesNotMatch(granted, /麦克风没授权，去系统设置打开/)
})

test('the microphone line uses the Windows copy on win32 and the Mac copy on darwin', () => {
  const windows = renderVoice(status('denied', 'unknown'), voiceDraft, 'win32')
  assert.match(windows, /麦克风没授权，去 Windows 设置打开/)
  assert.doesNotMatch(windows, /去系统设置打开/)

  const mac = renderVoice(status('denied', 'unknown'), voiceDraft, 'darwin')
  assert.match(mac, /麦克风没授权，去系统设置打开/)
  assert.doesNotMatch(mac, /Windows 设置/)
})

test('the microphone line uses the platform key in all five locales', async () => {
  const windows = {
    'zh-CN': '麦克风没授权，去 Windows 设置打开',
    'zh-TW': '麥克風沒授權，到 Windows 設定開啟',
    'en-US': 'Microphone access is off. Open Windows Settings to allow it.',
    ja: 'マイクが許可されていません。Windows の設定で許可してください。',
    ko: '마이크 권한이 없어요. Windows 설정에서 허용해 주세요.',
  } as const
  const mac = {
    'zh-CN': '麦克风没授权，去系统设置打开',
    'zh-TW': '麥克風沒授權，到系統設定開啟',
    'en-US': 'Microphone access is off. Open System Settings to allow it.',
    ja: 'マイクが許可されていません。システム設定で許可してください。',
    ko: '마이크 권한이 없어요. 시스템 설정에서 허용해 주세요.',
  } as const

  for (const locale of Object.keys(windows) as Array<keyof typeof windows>) {
    await ensureLocaleLoaded(locale)
    const draft = { ...voiceDraft, uiLanguage: locale } as AppSettings
    assert.ok(renderVoice(status('denied', 'unknown'), draft, 'win32').includes(windows[locale]))
    assert.ok(renderVoice(status('denied', 'unknown'), draft, 'darwin').includes(mac[locale]))
  }
})

test('the microphone line stays hidden when every mic switch is off even if denied', () => {
  const allOff = {
    ...voiceDraft,
    speechInputEnabled: false,
    wakeWordEnabled: false,
    continuousVoiceModeEnabled: false,
    wakewordAlwaysOn: false,
  } as AppSettings
  const html = renderVoice(status('denied', 'unknown'), allOff)
  assert.doesNotMatch(html, /麦克风没授权/)
})

test('the screen recording permission line appears under the screen context toggle only while denied', () => {
  const denied = renderMemory(status('unknown', 'denied'))
  assert.match(denied, /屏幕录制没授权，去系统设置打开/)
  assert.match(denied, /role="status"/)

  const granted = renderMemory(status('unknown', 'granted'))
  assert.doesNotMatch(granted, /屏幕录制没授权，去系统设置打开/)
})

test('the combined screen result requires both the master and the sub-switch', () => {
  assert.equal(isScreenContextActive({
    contextAwarenessEnabled: false,
    screenContextEnabled: true,
  }), false)
  assert.equal(isScreenContextActive({
    contextAwarenessEnabled: true,
    screenContextEnabled: false,
  }), false)
  assert.equal(isScreenContextActive({
    contextAwarenessEnabled: true,
    screenContextEnabled: true,
  }), true)

  const request = buildMediaPermissionStatusRequest({
    ...memoryDraft,
    contextAwarenessEnabled: false,
    screenContextEnabled: true,
  })
  assert.equal(request.screenContextActive, false)

  assert.equal(buildMediaPermissionStatusRequest({
    ...voiceDraft,
    speechInputEnabled: true,
  }).microphoneEnabled, true)
  assert.equal(buildMediaPermissionStatusRequest({
    ...voiceDraft,
    speechInputEnabled: false,
    wakeWordEnabled: false,
    continuousVoiceModeEnabled: false,
    wakewordAlwaysOn: false,
  }).microphoneEnabled, false)
})

test('the screen recording line stays hidden when the context-awareness master is off', () => {
  const masterOff = {
    ...memoryDraft,
    contextAwarenessEnabled: false,
    screenContextEnabled: true,
  } as AppSettings
  const html = renderMemory(status('unknown', 'denied'), masterOff)
  assert.doesNotMatch(html, /屏幕录制没授权，去系统设置打开/)
})
