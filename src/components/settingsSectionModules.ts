import type { SettingsSectionId } from './settingsDrawerSupport.ts'

export const loadAutonomySection = () => import('./settingsSections/AutonomySection.tsx')
export const loadChatSection = () => import('./settingsSections/ChatSection.tsx')
export const loadConsoleSection = () => import('./settingsSections/ConsoleSection.tsx')
export const loadHistorySection = () => import('./settingsSections/HistorySection.tsx')
export const loadIntegrationsSection = () => import('./settingsSections/IntegrationsSection.tsx')
export const loadLettersSection = () => import('./settingsSections/LettersSection.tsx')
export const loadLorebooksSection = () => import('./settingsSections/LorebooksSection.tsx')
export const loadMemorySection = () => import('./settingsSections/MemorySection.tsx')
export const loadModelSection = () => import('./settingsSections/ModelSection.tsx')
export const loadSpeechInputSection = () => import('./settingsSections/SpeechInputSection.tsx')
export const loadSpeechOutputSection = () => import('./settingsSections/SpeechOutputSection.tsx')
export const loadToolsSection = () => import('./settingsSections/ToolsSection.tsx')
export const loadVoiceSection = () => import('./settingsSections/VoiceSection.tsx')
export const loadWindowSection = () => import('./settingsSections/WindowSection.tsx')

const SETTINGS_SECTION_PRELOADERS: Record<SettingsSectionId, () => Promise<unknown>> = {
  autonomy: loadAutonomySection,
  chat: loadChatSection,
  console: loadConsoleSection,
  history: loadHistorySection,
  integrations: loadIntegrationsSection,
  letters: loadLettersSection,
  lorebooks: loadLorebooksSection,
  memory: loadMemorySection,
  model: loadModelSection,
  tools: loadToolsSection,
  voice: () => Promise.all([
    loadVoiceSection(),
    loadSpeechInputSection(),
    loadSpeechOutputSection(),
  ]),
  window: loadWindowSection,
}

export function preloadSettingsSection(sectionId: SettingsSectionId) {
  void SETTINGS_SECTION_PRELOADERS[sectionId]().catch(() => undefined)
}
