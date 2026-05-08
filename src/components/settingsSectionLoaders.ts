import { lazy } from 'react'
import type { SettingsSectionId } from './settingsDrawerSupport'

const loadAutonomySection = () => import('./settingsSections/AutonomySection')
const loadChatSection = () => import('./settingsSections/ChatSection')
const loadConsoleSection = () => import('./settingsSections/ConsoleSection')
const loadContextSection = () => import('./settingsSections/ContextSection')
const loadHistorySection = () => import('./settingsSections/HistorySection')
const loadIntegrationsSection = () => import('./settingsSections/IntegrationsSection')
const loadLorebooksSection = () => import('./settingsSections/LorebooksSection')
const loadMemorySection = () => import('./settingsSections/MemorySection')
const loadModelSection = () => import('./settingsSections/ModelSection')
const loadSpeechInputSection = () => import('./settingsSections/SpeechInputSection')
const loadSpeechOutputSection = () => import('./settingsSections/SpeechOutputSection')
const loadToolsSection = () => import('./settingsSections/ToolsSection')
const loadVoiceSection = () => import('./settingsSections/VoiceSection')
const loadWindowSection = () => import('./settingsSections/WindowSection')

export const AutonomySection = lazy(async () => ({ default: (await loadAutonomySection()).AutonomySection }))
export const ChatSection = lazy(async () => ({ default: (await loadChatSection()).ChatSection }))
export const ConsoleSection = lazy(async () => ({ default: (await loadConsoleSection()).ConsoleSection }))
export const ContextSection = lazy(async () => ({ default: (await loadContextSection()).ContextSection }))
export const HistorySection = lazy(async () => ({ default: (await loadHistorySection()).HistorySection }))
export const IntegrationsSection = lazy(async () => ({ default: (await loadIntegrationsSection()).IntegrationsSection }))
export const LorebooksSection = lazy(async () => ({ default: (await loadLorebooksSection()).LorebooksSection }))
export const MemorySection = lazy(async () => ({ default: (await loadMemorySection()).MemorySection }))
export const ModelSection = lazy(async () => ({ default: (await loadModelSection()).ModelSection }))
export const SpeechInputSection = lazy(async () => ({ default: (await loadSpeechInputSection()).SpeechInputSection }))
export const SpeechOutputSection = lazy(async () => ({ default: (await loadSpeechOutputSection()).SpeechOutputSection }))
export const ToolsSection = lazy(async () => ({ default: (await loadToolsSection()).ToolsSection }))
export const VoiceSection = lazy(async () => ({ default: (await loadVoiceSection()).VoiceSection }))
export const WindowSection = lazy(async () => ({ default: (await loadWindowSection()).WindowSection }))

const sectionPreloaders: Record<SettingsSectionId, Array<() => Promise<unknown>>> = {
  autonomy: [loadAutonomySection],
  chat: [loadChatSection],
  console: [loadConsoleSection, loadContextSection],
  history: [loadHistorySection],
  integrations: [loadIntegrationsSection],
  lorebooks: [loadLorebooksSection],
  memory: [loadMemorySection],
  model: [loadModelSection],
  tools: [loadToolsSection],
  voice: [loadVoiceSection, loadSpeechInputSection, loadSpeechOutputSection],
  window: [loadWindowSection],
}

export function preloadSettingsSection(sectionId: SettingsSectionId) {
  void Promise.all(sectionPreloaders[sectionId].map((loadSection) => loadSection()))
    .catch(() => undefined)
}
