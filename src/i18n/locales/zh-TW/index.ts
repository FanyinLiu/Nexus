/**
 * zh-TW translation dictionary — assembled from per-namespace modules.
 * Split so individual files stay under the source-size budget and can be
 * reviewed/edited without loading a 2600-line monolith.
 */
import type { TranslationDictionary } from '../../../types/i18n.ts'
import { zhTWCore } from './core.ts'
import { zhTWSettingsShell } from './settings-shell.ts'
import { zhTWSettingsMemory } from './settings-memory.ts'
import { zhTWSettingsConsole } from './settings-console.ts'
import { zhTWSettingsHistory } from './settings-history.ts'
import { zhTWSettingsChat } from './settings-chat.ts'
import { zhTWSettingsIntegrations } from './settings-integrations.ts'
import { zhTWSettingsVoice } from './settings-voice.ts'
import { zhTWSettingsWindow } from './settings-window.ts'
import { zhTWSettingsModel } from './settings-model.ts'
import { zhTWProvider } from './provider.ts'
import { zhTWVoice } from './voice.ts'
import { zhTWChat } from './chat.ts'
import { zhTWOnboarding } from './onboarding.ts'
import { zhTWPanel } from './panel.ts'
import { zhTWIntegration } from './integration.ts'

export const zhTWMessages = {
  ...zhTWCore,
  ...zhTWSettingsShell,
  ...zhTWSettingsMemory,
  ...zhTWSettingsConsole,
  ...zhTWSettingsHistory,
  ...zhTWSettingsChat,
  ...zhTWSettingsIntegrations,
  ...zhTWSettingsVoice,
  ...zhTWSettingsWindow,
  ...zhTWSettingsModel,
  ...zhTWProvider,
  ...zhTWVoice,
  ...zhTWChat,
  ...zhTWOnboarding,
  ...zhTWPanel,
  ...zhTWIntegration,
} satisfies TranslationDictionary
