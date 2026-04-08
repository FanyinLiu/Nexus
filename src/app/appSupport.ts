import { shorten } from '../lib/common'
import type {
  AppSettings,
  MemoryItem,
  PetTouchZone,
  VoiceState,
  WindowView,
} from '../types'

export const voiceStateLabelMap: Record<VoiceState, string> = {
  idle: '待命',
  listening: '聆听中',
  processing: '理解中',
  speaking: '说话中',
}

export const hoverReactionMap: Record<PetTouchZone, string[]> = {
  head: ['摸头会让我更安心。', '被轻轻碰到头顶了。', '这一下让我想多露出表情。'],
  face: ['你在看着我吗？', '脸颊这里会更敏感一点。', '这样会让我更有表情。'],
  body: ['我感受到你靠近了。', '这样让我更有能量。', '我能捕捉到你的节奏。'],
}

export const STARTUP_GREETING_DURATION_MS = 9_200
export const STARTUP_GREETING_SESSION_KEY = 'nexus:startup-greeting-shown'
export const VOICE_TRIGGER_DIRECT_SEND_MIGRATION_KEY = 'nexus:voice-trigger-direct-send-migration-v1'

/** Synchronous initial guess from URL params (safe for useState initializers). */
export function getWindowViewSync(): WindowView {
  return new URLSearchParams(window.location.search).get('view') === 'panel'
    ? 'panel'
    : 'pet'
}

/** Async check that also consults the Electron preload bridge. */
export async function getWindowView(): Promise<WindowView> {
  if (await window.desktopPet?.isPanelWindow?.()) {
    return 'panel'
  }
  return getWindowViewSync()
}

export type PanelSection = 'chat' | 'settings'

export function getInitialPanelSection(): PanelSection {
  return new URLSearchParams(window.location.search).get('section') === 'settings'
    ? 'settings'
    : 'chat'
}

export function getTimeGreeting() {
  const hour = new Date().getHours()

  if (hour < 5) return '夜深了'
  if (hour < 11) return '早安'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

export function getLiveTranscriptLabel(voiceState: VoiceState) {
  return voiceState === 'listening' ? '识别中' : '识别结果'
}

export function buildStartupGreetingText(settings: AppSettings, memories: MemoryItem[]) {
  const greeting = getTimeGreeting()
  const latestMemory = memories[0]?.content

  if (latestMemory) {
    return `${greeting}，${settings.userName}。我还记得你最近提过「${shorten(latestMemory, 20)}」，如果你还想延续这个话题，我可以继续帮你理一遍。`
  }

  return `${greeting}，${settings.userName}。${settings.companionName} 已经在桌面这边准备好了，想聊时直接叫我。`
}
