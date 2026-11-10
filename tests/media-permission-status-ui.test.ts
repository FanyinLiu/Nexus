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

function renderVoice(mediaPermissionStatus: MediaPermissionStatusSnapshot) {
  return renderToStaticMarkup(React.createElement(VoiceSimplePage, {
    draft: voiceDraft,
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
  }))
}

function renderMemory(mediaPermissionStatus: MediaPermissionStatusSnapshot) {
  return renderToStaticMarkup(React.createElement(MemorySimplePage, {
    draft: memoryDraft,
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

test('the screen recording permission line appears under the screen context toggle only while denied', () => {
  const denied = renderMemory(status('unknown', 'denied'))
  assert.match(denied, /屏幕录制没授权，去系统设置打开/)
  assert.match(denied, /role="status"/)

  const granted = renderMemory(status('unknown', 'granted'))
  assert.doesNotMatch(granted, /屏幕录制没授权，去系统设置打开/)
})
