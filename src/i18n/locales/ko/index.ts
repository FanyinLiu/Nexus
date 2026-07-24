/**
 * ko translation dictionary — assembled from per-namespace modules.
 * Split so individual files stay under the source-size budget and can be
 * reviewed/edited without loading a 2600-line monolith.
 */
import type { TranslationDictionary } from '../../../types/i18n.ts'
import { koCore } from './core.ts'
import { koSettingsShell } from './settings-shell.ts'
import { koSettingsMemory } from './settings-memory.ts'
import { koSettingsConsole } from './settings-console.ts'
import { koSettingsHistory } from './settings-history.ts'
import { koSettingsChat } from './settings-chat.ts'
import { koSettingsIntegrations } from './settings-integrations.ts'
import { koSettingsVoice } from './settings-voice.ts'
import { koSettingsWindow } from './settings-window.ts'
import { koSettingsModel } from './settings-model.ts'
import { koProvider } from './provider.ts'
import { koVoice } from './voice.ts'
import { koChat } from './chat.ts'
import { koOnboarding } from './onboarding.ts'
import { koPanel } from './panel.ts'
import { koIntegration } from './integration.ts'

export const koMessages = {
  ...koCore,
  ...koSettingsShell,
  ...koSettingsMemory,
  ...koSettingsConsole,
  ...koSettingsHistory,
  ...koSettingsChat,
  ...koSettingsIntegrations,
  ...koSettingsVoice,
  ...koSettingsWindow,
  ...koSettingsModel,
  ...koProvider,
  ...koVoice,
  ...koChat,
  ...koOnboarding,
  ...koPanel,
  ...koIntegration,
} satisfies TranslationDictionary
