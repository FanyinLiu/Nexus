/**
 * ja translation dictionary — assembled from per-namespace modules.
 * Split so individual files stay under the source-size budget and can be
 * reviewed/edited without loading a 2600-line monolith.
 */
import type { TranslationDictionary } from '../../../types/i18n.ts'
import { jaCore } from './core.ts'
import { jaSettingsShell } from './settings-shell.ts'
import { jaSettingsMemory } from './settings-memory.ts'
import { jaSettingsConsole } from './settings-console.ts'
import { jaSettingsHistory } from './settings-history.ts'
import { jaSettingsChat } from './settings-chat.ts'
import { jaSettingsIntegrations } from './settings-integrations.ts'
import { jaSettingsVoice } from './settings-voice.ts'
import { jaSettingsWindow } from './settings-window.ts'
import { jaSettingsModel } from './settings-model.ts'
import { jaProvider } from './provider.ts'
import { jaVoice } from './voice.ts'
import { jaChat } from './chat.ts'
import { jaOnboarding } from './onboarding.ts'
import { jaPanel } from './panel.ts'
import { jaIntegration } from './integration.ts'

export const jaMessages = {
  ...jaCore,
  ...jaSettingsShell,
  ...jaSettingsMemory,
  ...jaSettingsConsole,
  ...jaSettingsHistory,
  ...jaSettingsChat,
  ...jaSettingsIntegrations,
  ...jaSettingsVoice,
  ...jaSettingsWindow,
  ...jaSettingsModel,
  ...jaProvider,
  ...jaVoice,
  ...jaChat,
  ...jaOnboarding,
  ...jaPanel,
  ...jaIntegration,
} satisfies TranslationDictionary
